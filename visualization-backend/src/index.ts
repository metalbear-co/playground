import express from "express";
import cors from "cors";
import { AppsV1Api, KubeConfig } from "@kubernetes/client-node";

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

type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
};

class SnapshotStore {
  private clusterName: string;
  private services = new Map<string, ServiceStatus>();

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
  }

  public upsertService(service: ServiceStatus) {
    this.services.set(service.id, service);
  }

  public removeService(id: string) {
    this.services.delete(id);
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

const startDeploymentPoller = () => {
  const kubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
    console.log("Loaded in-cluster Kubernetes configuration");
  } catch (clusterError) {
    try {
      kubeConfig.loadFromDefault();
      console.log("Loaded local kubeconfig");
    } catch (localError) {
      console.warn(
        "Kubernetes configuration not found; automatic snapshot updates disabled.",
      );
      return;
    }
  }

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
            error,
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
    );
  };

  poll().catch((error) =>
    console.error("Initial deployment poll failed", error),
  );
  setInterval(() => {
    poll().catch((error) => console.error("Deployment poll failed", error));
  }, pollIntervalMs);
};

startDeploymentPoller();

app.listen(port, () => {
  console.log(`Visualization backend listening on port ${port}`);
});
