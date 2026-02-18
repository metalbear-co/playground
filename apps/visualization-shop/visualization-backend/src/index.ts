import express from "express";
import cors from "cors";
import {
  AppsV1Api,
  CustomObjectsApi,
  KubeConfig,
} from "@kubernetes/client-node";

/**
 * Express application that exposes the cluster snapshot consumed by the React visualization.
 */
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

/**
 * Service information tracked in the snapshot. Derived from known deployments or manual POSTs.
 */
type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  lastUpdated: string;
  status?: "available" | "degraded" | "unavailable";
  availableReplicas?: number;
  message?: string;
};

/**
 * Aggregated snapshot shared with the frontend.
 */
type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
};

/**
 * In-memory store that keeps the latest cluster snapshot. All pollers and API handlers interact with
 * this store so the frontend can always pull a single coherent object.
 */
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

let triggerDeploymentPoll: (() => Promise<void>) | null = null;
let kubeConfigRef: KubeConfig | null = null;

/**
 * Helper used by refresh endpoints/query params to run the deployment poller synchronously on demand.
 */
const runRefreshPollers = async () => {
  if (triggerDeploymentPoll) {
    await triggerDeploymentPoll();
  }
};

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Route helper that allows us to serve the visualization backend under multiple URL prefixes
 * (e.g. /snapshot locally and /visualization/api/snapshot behind the public ingress).
 */
const snapshotPaths = ["/snapshot", "/visualization-shop/api/snapshot"];
const snapshotPostPaths = ["/snapshot", "/visualization-shop/api/snapshot"];
const snapshotRefreshPaths = [
  "/snapshot/refresh",
  "/visualization-shop/api/snapshot/refresh",
];

const operatorStatusPaths = [
  "/operator-status",
  "/visualization-shop/api/operator-status",
];

/**
 * Return the current snapshot. Optional `?refresh=1` forces pollers to run before responding.
 */
app.get(snapshotPaths, async (req, res) => {
  try {
    const wantsRefresh =
      req.query.refresh === "1" || req.query.refresh === "true";
    if (wantsRefresh) {
      await runRefreshPollers();
    }
    res.json(snapshotStore.getSnapshot());
  } catch (error) {
    console.error(
      "Snapshot retrieval failed",
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to retrieve snapshot. See server logs for details.",
    });
  }
});

/**
 * Replace the snapshot with user-provided data (handy for demos without a real cluster).
 */
app.post(snapshotPostPaths, (req, res) => {
  const body = req.body as Partial<ClusterSnapshot>;
  snapshotStore.replaceSnapshot(body);
  res.json(snapshotStore.getSnapshot());
});

/**
 * Force both pollers to run and return the updated snapshot.
 */
app.post(snapshotRefreshPaths, async (_req, res) => {
  try {
    await runRefreshPollers();
    res.json(snapshotStore.getSnapshot());
  } catch (error) {
    console.error(
      "Snapshot refresh failed",
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to refresh snapshot. See server logs for details.",
    });
  }
});

/**
 * Rich session data from the mirrord operator's MirrordClusterSession CRD.
 */
type OperatorSession = {
  sessionId: string;
  target: {
    kind: string;
    name: string;
    container?: string | undefined;
    apiVersion?: string | undefined;
  };
  namespace: string;
  owner: {
    username: string;
    k8sUsername: string;
    hostname: string;
  };
  branchName?: string | undefined;
  createdAt: string;
  connectedAt?: string | undefined;
  durationSeconds?: number | undefined;
};

type OperatorStatusResponse = {
  sessions: OperatorSession[];
  sessionCount: number;
  fetchedAt: string;
};

/**
 * Query MirrordClusterSession custom resources from the operator CRD.
 * Returns structured session data including user, target, and timing info.
 */
const fetchOperatorSessions = async (
  kubeConfig: KubeConfig,
): Promise<OperatorSession[]> => {
  const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
  const result = await customApi.listClusterCustomObject({
    group: "mirrord.metalbear.co",
    version: "v1alpha",
    plural: "mirrordclustersessions",
  });

  const body = result as { items?: Array<Record<string, unknown>> };
  const items = body.items ?? [];
  const now = Date.now();

  return items.map((item) => {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const spec = (item.spec ?? {}) as Record<string, unknown>;
    const status = (item.status ?? {}) as Record<string, unknown>;
    const target = (spec.target ?? {}) as Record<string, unknown>;
    const owner = (spec.owner ?? {}) as Record<string, unknown>;
    const jiraMetrics = (spec.jiraMetrics ?? {}) as Record<string, unknown>;

    const createdAt =
      (metadata.creationTimestamp as string) ?? new Date().toISOString();
    const connectedAt = status.connectedTimestamp as string | undefined;

    const createdMs = new Date(createdAt).getTime();
    const durationSeconds = Math.floor((now - createdMs) / 1000);

    return {
      sessionId: (metadata.name as string) ?? "unknown",
      target: {
        kind: (target.kind as string) ?? "Unknown",
        name: (target.name as string) ?? "unknown",
        container: target.container as string | undefined,
        apiVersion: target.apiVersion as string | undefined,
      },
      namespace: (spec.namespace as string) ?? "default",
      owner: {
        username: (owner.username as string) ?? "unknown",
        k8sUsername: (owner.k8sUsername as string) ?? "unknown",
        hostname: (owner.hostname as string) ?? "unknown",
      },
      branchName: jiraMetrics.branchName as string | undefined,
      createdAt,
      connectedAt,
      durationSeconds: Number.isFinite(durationSeconds)
        ? durationSeconds
        : undefined,
    };
  });
};

/**
 * Return active mirrord operator sessions queried from the MirrordClusterSession CRD.
 */
app.get(operatorStatusPaths, async (_req, res) => {
  if (!kubeConfigRef) {
    res.status(503).json({
      error: "Kubernetes configuration unavailable; cannot query operator sessions.",
    });
    return;
  }
  try {
    const sessions = await fetchOperatorSessions(kubeConfigRef);
    const response: OperatorStatusResponse = {
      sessions,
      sessionCount: sessions.length,
      fetchedAt: new Date().toISOString(),
    };
    res.json(response);
  } catch (error) {
    console.error(
      "Operator status fetch failed",
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch operator sessions. See server logs for details.",
    });
  }
});

type KnownDeployment = {
  id: string;
  name: string;
  description: string;
  deployment: string;
  namespace?: string;
};

/**
 * Deployments we poll for status information. Each entry becomes a service node in the snapshot.
 */
const knownDeployments: KnownDeployment[] = [
  {
    id: "mirrord-operator",
    name: "mirrord operator",
    description: "Injects mirrord sessions",
    deployment: "mirrord-operator",
    namespace: "mirrord",
  },
  {
    id: "metal-mart-frontend",
    name: "metal-mart-frontend",
    description: "Next.js storefront",
    deployment: "metal-mart-frontend",
  },
  {
    id: "inventory-service",
    name: "inventory-service",
    description: "Product catalog & stock management",
    deployment: "inventory-service",
  },
  {
    id: "order-service",
    name: "order-service",
    description: "Order orchestration",
    deployment: "order-service",
  },
  {
    id: "payment-service",
    name: "payment-service",
    description: "Mock payment processor",
    deployment: "payment-service",
  },
  {
    id: "delivery-service",
    name: "delivery-service",
    description: "Kafka consumer & delivery tracking",
    deployment: "delivery-service",
  },
];

const defaultNamespace = process.env.WATCH_NAMESPACE || "shop";
const pollIntervalMs = Number(process.env.WATCH_INTERVAL_MS ?? "10000");

/**
 * Attempt to load Kubernetes credentials (preferring in-cluster config, falling back to local kubeconfig).
 */
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

  /**
   * Poll Kubernetes Deployments listed in `knownDeployments` and update the snapshot with their status.
   */
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

  const runPoll = async () => {
    try {
      await poll();
    } catch (error) {
      console.error(
        "Deployment poll failed",
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  };

  runPoll().catch(() => {
    /* error logged above */
  });
  setInterval(() => {
    runPoll().catch(() => {
      /* error logged above */
    });
  }, pollIntervalMs);

  return runPoll;
};

kubeConfigRef = loadKubeConfiguration();
if (kubeConfigRef) {
  triggerDeploymentPoll = startDeploymentPoller(kubeConfigRef);
} else {
  console.warn(
    "Kubernetes configuration unavailable; snapshot watchers are disabled.",
  );
}

app.listen(port, () => {
  console.log(`Shop visualization backend listening on port ${port}`);
});
