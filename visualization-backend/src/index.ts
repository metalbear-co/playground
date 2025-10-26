import express from "express";
import cors from "cors";
import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  lastUpdated: string;
  status?: "available" | "degraded" | "unavailable";
  availableReplicas?: number;
  message?: string;
};

type SessionStatus = {
  id: string;
  podName: string;
  namespace: string;
  targetWorkload?: string | undefined;
  lastUpdated: string;
};

type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
  sessions: SessionStatus[];
};

class SnapshotStore {
  private clusterName: string;
  private services = new Map<string, ServiceStatus>();
  private sessions = new Map<string, SessionStatus>();

  constructor(clusterName: string) {
    this.clusterName = clusterName;
  }

  public setClusterName(name: string) {
    this.clusterName = name;
  }

  public getSnapshot(): ClusterSnapshot {
    return {
      clusterName: this.clusterName,
      updatedAt: new Date().toISOString(),
      services: Array.from(this.services.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      sessions: Array.from(this.sessions.values()).sort((a, b) =>
        a.podName.localeCompare(b.podName),
      ),
    };
  }

  public replaceSnapshot(partial: Partial<ClusterSnapshot>) {
    if (partial.clusterName) {
      this.clusterName = partial.clusterName;
    }

    this.services.clear();
    partial.services?.forEach((service) => {
      const status: ServiceStatus = {
        ...service,
        lastUpdated: service.lastUpdated ?? new Date().toISOString(),
      };
      this.services.set(status.id, status);
    });

    if (partial.sessions) {
      this.sessions.clear();
      partial.sessions.forEach((session) => {
        const status: SessionStatus = {
          ...session,
          lastUpdated: session.lastUpdated ?? new Date().toISOString(),
        };
        this.sessions.set(status.id, status);
      });
    }
  }

  public upsertService(service: ServiceStatus) {
    this.services.set(service.id, service);
  }

  public removeService(id: string) {
    this.services.delete(id);
  }

  public setSessions(nextSessions: SessionStatus[]) {
    this.sessions.clear();
    nextSessions.forEach((session) => {
      this.sessions.set(session.id, session);
    });
  }
}

const snapshotStore = new SnapshotStore(process.env.CLUSTER_NAME || "playground");

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/snapshot", (_req, res) => {
  res.json(snapshotStore.getSnapshot());
});

app.post("/snapshot", (req, res) => {
  const body = req.body as Partial<ClusterSnapshot>;
  snapshotStore.replaceSnapshot(body);
  res.json(snapshotStore.getSnapshot());
});

type KnownDeployment = {
  id: string;
  name: string;
  description: string;
  deployment: string;
  namespace?: string;
};

const knownDeployments: KnownDeployment[] = [
  {
    id: "mirrord-operator",
    name: "mirrord operator",
    description: "Injects mirrord sessions",
    deployment: "mirrord-operator",
    namespace: "mirrord",
  },
  {
    id: "ip-visit-counter",
    name: "ip-visit-counter",
    description: "Counts visits and emits events",
    deployment: "ip-visit-counter",
  },
  {
    id: "ip-visit-consumer",
    name: "ip-visit-consumer",
    description: "Kafka consumer printing visit events",
    deployment: "ip-visit-consumer",
  },
  {
    id: "ip-info",
    name: "ip-info",
    description: "HTTP IP info service",
    deployment: "ip-info",
  },
  {
    id: "ip-info-grpc",
    name: "ip-info-grpc",
    description: "gRPC IP info service",
    deployment: "ip-info-grpc",
  },
  {
    id: "redis",
    name: "redis",
    description: "Caching layer",
    deployment: "redis-main",
  },
];

const defaultNamespace = process.env.WATCH_NAMESPACE || "default";
const pollIntervalMs = Number(process.env.WATCH_INTERVAL_MS ?? "10000");

const loadKubeConfiguration = (): KubeConfig | null => {
  const kubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
    console.log("Loaded in-cluster Kubernetes configuration");
    return kubeConfig;
  } catch (clusterError) {
    try {
      kubeConfig.loadFromDefault();
      console.log("Loaded local kubeconfig");
      return kubeConfig;
    } catch (localError) {
      console.warn(
        "Kubernetes configuration not found; automatic snapshot updates disabled.",
      );
      return null;
    }
  }
};

const startDeploymentPoller = (kubeConfig: KubeConfig) => {
  const appsApi = kubeConfig.makeApiClient(AppsV1Api);

  const poll = async () => {
    await Promise.all(
      knownDeployments.map(async (service) => {
        const namespace = service.namespace ?? defaultNamespace;

        try {
          const deployment = await appsApi.readNamespacedDeploymentStatus({
            name: service.deployment,
            namespace,
          });
          const available = deployment.status?.availableReplicas ?? 0;

          if (available > 0) {
            snapshotStore.upsertService({
              id: service.id,
              name: service.name,
              description: service.description,
              lastUpdated: new Date().toISOString(),
              status: "available",
              availableReplicas: available,
            });
          } else {
            snapshotStore.removeService(service.id);
          }
        } catch (error) {
        console.warn(
          `Failed to read deployment ${service.deployment} in namespace ${namespace}`,
          error instanceof Error ? error.message : error,
        );
        snapshotStore.upsertService({
            id: service.id,
            name: service.name,
            description: service.description,
            lastUpdated: new Date().toISOString(),
            status: "degraded",
            message:
              error instanceof Error ? error.message : "Unknown Kubernetes error",
          });
        }
      }),
    ).then(() => {
      const snapshot = snapshotStore.getSnapshot();
      console.log(
        `[deployment-poller] ${new Date().toISOString()} - ` +
          `${snapshot.services.length} services tracked`,
      );
    });
  };

  poll().catch((error) =>
    console.error("Initial deployment poll failed", error),
  );
  setInterval(() => {
    poll().catch((error) => console.error("Deployment poll failed", error));
  }, pollIntervalMs);
};

const startMirrordAgentPoller = (kubeConfig: KubeConfig) => {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);

  const poll = async () => {
    try {
      const pods = await coreApi.listPodForAllNamespaces();
      const sessions: SessionStatus[] = [];
      pods.items?.forEach((pod) => {
        const containers = [
          ...(pod.spec?.containers ?? []),
          ...(pod.spec?.initContainers ?? []),
        ];
        const hasAgent = containers.some((container) =>
          container.name.includes("mirrord-agent"),
        );
        if (!hasAgent) {
          return;
        }

        const namespace = pod.metadata?.namespace ?? "default";
        const podName = pod.metadata?.name ?? "unknown-pod";
        const targetName =
          pod.metadata?.annotations?.["mirrord.io/target-name"] ??
          pod.metadata?.ownerReferences?.[0]?.name;
        sessions.push({
          id: `${namespace}/${podName}`,
          podName,
          namespace,
          targetWorkload: targetName,
          lastUpdated: new Date().toISOString(),
        });
      });
      snapshotStore.setSessions(sessions);
      console.log(
        `[agent-poller] ${new Date().toISOString()} - ${sessions.length} mirrord agents detected`,
      );
    } catch (error) {
      console.warn(
        "Failed to poll mirrord agent pods",
        error instanceof Error ? error.message : error,
      );
    }
  };

  poll().catch((error) =>
    console.error("Initial mirrord agent poll failed", error),
  );
  setInterval(() => {
    poll().catch((error) => console.error("Mirrord agent poll failed", error));
  }, pollIntervalMs);
};

const kubeConfig = loadKubeConfiguration();
if (kubeConfig) {
  startDeploymentPoller(kubeConfig);
  startMirrordAgentPoller(kubeConfig);
} else {
  console.warn(
    "Kubernetes configuration unavailable; snapshot watchers are disabled.",
  );
}

app.listen(port, () => {
  console.log(`Visualization backend listening on port ${port}`);
});
