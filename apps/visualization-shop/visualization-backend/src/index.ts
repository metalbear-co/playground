import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pg from "pg";
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

app.set("trust proxy", 1);
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
  if (req.query.queueSplittingMock === "true") {
    res.json(mockSnapshot);
    return;
  }
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

type KafkaEphemeralTopic = {
  topicName: string;
  sessionId: string;
  clientConfig: string;
};

type PgBranchDatabase = {
  name: string;
  namespace: string;
  branchId: string;
  targetDeployment: string;
  copyMode: string;
  postgresVersion: string;
  phase: string;
  expireTime?: string;
  connectionUrl?: string;
  owners: { username: string; hostname: string }[];
};

type OperatorStatusResponse = {
  sessions: OperatorSession[];
  sessionCount: number;
  kafkaTopics: KafkaEphemeralTopic[];
  pgBranches: PgBranchDatabase[];
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
 * Query MirrordKafkaEphemeralTopic custom resources from the operator CRD.
 * Returns topic names linked to sessions via the session-id label.
 */
const fetchKafkaEphemeralTopics = async (
  kubeConfig: KubeConfig,
): Promise<KafkaEphemeralTopic[]> => {
  const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
  const result = await customApi.listClusterCustomObject({
    group: "queues.mirrord.metalbear.co",
    version: "v1alpha",
    plural: "mirrordkafkaephemeraltopics",
  });

  const body = result as { items?: Array<Record<string, unknown>> };
  const items = body.items ?? [];

  return items.map((item) => {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const spec = (item.spec ?? {}) as Record<string, unknown>;
    const labels = (metadata.labels ?? {}) as Record<string, string>;

    return {
      topicName: (spec.name as string) ?? "unknown",
      sessionId: labels["operator.metalbear.co/session-id"] ?? "unknown",
      clientConfig: (spec.clientConfig as string) ?? "unknown",
    };
  });
};

/**
 * Query PgBranchDatabase custom resources from the operator CRD.
 * Returns branch data including target deployment, phase, and owner info.
 */
const fetchPgBranchDatabases = async (
  kubeConfig: KubeConfig,
): Promise<PgBranchDatabase[]> => {
  const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
  const result = await customApi.listNamespacedCustomObject({
    group: "dbs.mirrord.metalbear.co",
    version: "v1alpha1",
    namespace: defaultNamespace,
    plural: "pgbranchdatabases",
  });

  const body = result as { items?: Array<Record<string, unknown>> };
  const items = body.items ?? [];

  return items.map((item) => {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const spec = (item.spec ?? {}) as Record<string, unknown>;
    const status = (item.status ?? {}) as Record<string, unknown>;
    const target = (spec.target ?? {}) as Record<string, unknown>;
    const sessionInfo = (status.sessionInfo ?? {}) as Record<string, Record<string, unknown>>;

    const owners = Object.values(sessionInfo).map((session) => {
      const owner = (session.owner ?? {}) as Record<string, unknown>;
      return {
        username: (owner.username as string) ?? "unknown",
        hostname: (owner.hostname as string) ?? "unknown",
      };
    });

    const connectionUrl =
      (status.connectionUrl as string) ??
      (status.connectionString as string) ??
      undefined;

    return {
      name: (metadata.name as string) ?? "unknown",
      namespace: (metadata.namespace as string) ?? defaultNamespace,
      branchId: (spec.id as string) ?? "unknown",
      targetDeployment: (target.deployment as string) ?? "unknown",
      copyMode: ((spec.copy as Record<string, unknown>)?.mode as string) ?? "unknown",
      postgresVersion: (spec.postgresVersion as string) ?? "unknown",
      phase: (status.phase as string) ?? "unknown",
      expireTime: (status.expireTime as string) ?? undefined,
      connectionUrl,
      owners,
    };
  });
};

const dynamicPgConnections = new Map<string, string>();

const sanitizeHostname = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const refreshDynamicPgConnections = (branches: PgBranchDatabase[]) => {
  dynamicPgConnections.clear();
  for (const branch of branches) {
    if (branch.connectionUrl) {
      const nodeId = `pg-branch-${sanitizeHostname(branch.name)}`;
      dynamicPgConnections.set(nodeId, branch.connectionUrl);
    }
  }
};

/**
 * Return active mirrord operator sessions and Kafka ephemeral topics.
 */
app.get(operatorStatusPaths, async (req, res) => {
  const requestUseMock = req.query.queueSplittingMock === "true";
  const requestUseDbBranchMock = req.query.dbBranchMock === "true";
  const requestUseMultipleSessionMock = req.query.multipleSessionMock === "true";
  if (requestUseMultipleSessionMock) {
    const response: OperatorStatusResponse = {
      ...mockMultipleSessionsOperatorStatus,
      pgBranches: requestUseDbBranchMock ? mockPgBranches : [],
      fetchedAt: new Date().toISOString(),
    };
    res.json(response);
    return;
  }
  if (requestUseMock) {
    const response: OperatorStatusResponse = {
      ...mockOperatorStatus,
      pgBranches: requestUseDbBranchMock ? mockPgBranches : [],
      sessions: requestUseDbBranchMock
        ? [...mockOperatorStatus.sessions, mockDbBranchSession]
        : mockOperatorStatus.sessions,
      sessionCount: requestUseDbBranchMock
        ? mockOperatorStatus.sessions.length + 1
        : mockOperatorStatus.sessions.length,
      fetchedAt: new Date().toISOString(),
    };
    res.json(response);
    return;
  }
  if (!kubeConfigRef) {
    res.status(503).json({
      error: "Kubernetes configuration unavailable; cannot query operator sessions.",
    });
    return;
  }
  try {
    const [sessions, kafkaTopics, pgBranches] = await Promise.all([
      fetchOperatorSessions(kubeConfigRef).catch((err) => {
        console.warn("Failed to fetch operator sessions:", err instanceof Error ? err.message : err);
        return [] as OperatorSession[];
      }),
      fetchKafkaEphemeralTopics(kubeConfigRef).catch((err) => {
        console.warn("Failed to fetch kafka topics:", err instanceof Error ? err.message : err);
        return [] as KafkaEphemeralTopic[];
      }),
      requestUseDbBranchMock
        ? Promise.resolve(mockPgBranches)
        : fetchPgBranchDatabases(kubeConfigRef).catch((err) => {
            console.warn("Failed to fetch pg branches:", err instanceof Error ? err.message : err);
            return [] as PgBranchDatabase[];
          }),
    ]);
    const allSessions = requestUseDbBranchMock
      ? [...sessions, mockDbBranchSession]
      : sessions;
    refreshDynamicPgConnections(pgBranches);
    const response: OperatorStatusResponse = {
      sessions: allSessions,
      sessionCount: allSessions.length,
      kafkaTopics,
      pgBranches,
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

/**
 * Mock data used when QUEUE_SPLITTING_MOCK_DATA=true, so the backend can run without a real cluster.
 */
const mockSnapshot: ClusterSnapshot = {
  clusterName: "mock-playground",
  updatedAt: new Date().toISOString(),
  services: knownDeployments.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    lastUpdated: new Date().toISOString(),
    status: "available" as const,
    availableReplicas: 2,
  })),
};

const mockOperatorStatus: OperatorStatusResponse = {
  sessions: [
    {
      sessionId: "2f585742d0784ac0",
      target: { kind: "Deployment", name: "ip-visit-counter", container: "main", apiVersion: "apps/v1" },
      namespace: "ip-visit-counter",
      owner: { username: "Aviram Hassan", k8sUsername: "aviram@metalbear.com", hostname: "Avirams-MacBook-Pro-2.local" },
      createdAt: "2026-02-18T07:36:04Z",
      connectedAt: "2026-02-18T07:56:13.864240Z",
      durationSeconds: 1211,
    },
    {
      sessionId: "504d016ef5980f1a",
      target: { kind: "Deployment", name: "delivery-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:27:49Z",
      connectedAt: "2026-02-18T07:56:14.217820Z",
      durationSeconds: 1706,
    },
    {
      sessionId: "786f862af51aa05f",
      target: { kind: "Deployment", name: "order-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:27:27Z",
      connectedAt: "2026-02-18T07:56:13.244857Z",
      durationSeconds: 1728,
    },
    {
      sessionId: "923b94707a8b122e",
      target: { kind: "Deployment", name: "delivery-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Aviram Hassan", k8sUsername: "aviram@metalbear.com", hostname: "Avirams-MacBook-Pro-2.local" },
      createdAt: "2026-02-18T07:51:48Z",
      connectedAt: "2026-02-18T07:56:15.195898Z",
      durationSeconds: 267,
    },
    {
      sessionId: "bf386eb54ddcb9a1",
      target: { kind: "Deployment", name: "visualization-shop-frontend", container: "frontend", apiVersion: "apps/v1" },
      namespace: "visualization-shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:48:51Z",
      connectedAt: "2026-02-18T07:56:15.322586Z",
      durationSeconds: 444,
    },
    {
      sessionId: "ed62c28e08c05a4b",
      target: { kind: "Deployment", name: "visualization-shop-backend", container: "backend", apiVersion: "apps/v1" },
      namespace: "visualization-shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:46:51Z",
      connectedAt: "2026-02-18T07:56:15.398127Z",
      durationSeconds: 564,
    },
  ],
  sessionCount: 6,
  kafkaTopics: [
    {
      topicName: "mirrord-tmp-kmhkbbzgki-orders",
      sessionId: "504d016ef5980f1a",
      clientConfig: "shop-kafka-config",
    },
    {
      topicName: "mirrord-tmp-fferfrefrfdd-orders",
      sessionId: "923b94707a8b122e",
      clientConfig: "shop-kafka-config",
    },
  ],
  pgBranches: [],
  fetchedAt: new Date().toISOString(),
};

const mockPgBranches: PgBranchDatabase[] = [
  {
    name: "order-service-pg-branch-255bc",
    namespace: "shop",
    branchId: "ari-branch-db",
    targetDeployment: "order-service",
    copyMode: "schema",
    postgresVersion: "16.0",
    phase: "Ready",
    expireTime: "2026-02-19T08:50:57.701063Z",
    owners: [
      { username: "Ari Sprung", hostname: "Aris-MacBook-Pro.local" },
    ],
  },
];

const mockMultipleSessionsOperatorStatus: OperatorStatusResponse = {
  sessions: [
    {
      sessionId: "2f585742d0784ac0",
      target: { kind: "Deployment", name: "ip-visit-counter", container: "main", apiVersion: "apps/v1" },
      namespace: "ip-visit-counter",
      owner: { username: "Aviram Hassan", k8sUsername: "aviram@metalbear.com", hostname: "Avirams-MacBook-Pro-2.local" },
      createdAt: "2026-02-18T07:36:04Z",
      connectedAt: "2026-02-18T07:56:13.864240Z",
      durationSeconds: 1211,
    },
    {
      sessionId: "504d016ef5980f1a",
      target: { kind: "Deployment", name: "delivery-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:27:49Z",
      connectedAt: "2026-02-18T07:56:14.217820Z",
      durationSeconds: 1706,
    },
    {
      sessionId: "786f862af51aa05f",
      target: { kind: "Deployment", name: "order-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:27:27Z",
      connectedAt: "2026-02-18T07:56:13.244857Z",
      durationSeconds: 1728,
    },
    {
      sessionId: "923b94707a8b122e",
      target: { kind: "Deployment", name: "delivery-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Aviram Hassan", k8sUsername: "aviram@metalbear.com", hostname: "Avirams-MacBook-Pro-2.local" },
      createdAt: "2026-02-18T07:51:48Z",
      connectedAt: "2026-02-18T07:56:15.195898Z",
      durationSeconds: 267,
    },
    {
      sessionId: "bf386eb54ddcb9a1",
      target: { kind: "Deployment", name: "visualization-shop-frontend", container: "frontend", apiVersion: "apps/v1" },
      namespace: "visualization-shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:48:51Z",
      connectedAt: "2026-02-18T07:56:15.322586Z",
      durationSeconds: 444,
    },
    {
      sessionId: "ed62c28e08c05a4b",
      target: { kind: "Deployment", name: "visualization-shop-backend", container: "backend", apiVersion: "apps/v1" },
      namespace: "visualization-shop",
      owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:46:51Z",
      connectedAt: "2026-02-18T07:56:15.398127Z",
      durationSeconds: 564,
    },
    {
      sessionId: "fd5532528u664b",
      target: { kind: "Deployment", name: "metal-mart-frontend", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Adna Lokisic", k8sUsername: "adna@metalbear.com", hostname: "Adna-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:46:51Z",
      connectedAt: "2026-02-18T07:56:15.398127Z",
      durationSeconds: 233,
    },
    {
      sessionId: "ed62c2528u664b",
      target: { kind: "Deployment", name: "payment-service", container: "main", apiVersion: "apps/v1" },
      namespace: "shop",
      owner: { username: "Karlo Dabrovic", k8sUsername: "karlo@metalbear.com", hostname: "Karlo-MacBook-Pro.local" },
      branchName: "shop-visual",
      createdAt: "2026-02-18T07:46:51Z",
      connectedAt: "2026-02-18T07:56:15.398127Z",
      durationSeconds: 233,
    },
  ],
  sessionCount: 8,
  kafkaTopics: [],
  pgBranches: [],
  fetchedAt: new Date().toISOString(),
};

const mockDbBranchSession: OperatorSession = {
  sessionId: "786f862af51aa05f",
  target: { kind: "Deployment", name: "order-service", container: "main", apiVersion: "apps/v1" },
  namespace: "shop",
  owner: { username: "Ari Sprung", k8sUsername: "aris@metalbear.com", hostname: "Aris-MacBook-Pro.local" },
  branchName: "shop-visual",
  createdAt: "2026-02-18T07:27:27Z",
  connectedAt: "2026-02-18T07:56:13.244857Z",
  durationSeconds: 1728,
};

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

// ---------------------------------------------------------------------------
// Database viewer endpoints
// ---------------------------------------------------------------------------

const staticDbConnections: Record<string, string | undefined> = {
  "postgres-inventory": process.env.PG_INVENTORY_URL,
  "postgres-orders": process.env.PG_ORDERS_URL,
  "postgres-deliveries": process.env.PG_DELIVERIES_URL,
};

const resolveDbConnection = (dbId: string): string | undefined => {
  if (staticDbConnections[dbId]) return staticDbConnections[dbId];
  if (dynamicPgConnections.has(dbId)) return dynamicPgConnections.get(dbId);
  return undefined;
};

const pgPools = new Map<string, pg.Pool>();

const getPool = (connectionString: string): pg.Pool => {
  let pool = pgPools.get(connectionString);
  if (!pool) {
    console.log(`Creating pg pool for: ${connectionString.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@")}`);
    pool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    });
    pgPools.set(connectionString, pool);
  }
  return pool;
};

const dbTablesPaths = ["/db/:dbId/tables", "/visualization-shop/api/db/:dbId/tables"];
const dbTableDataPaths = ["/db/:dbId/tables/:tableName", "/visualization-shop/api/db/:dbId/tables/:tableName"];

const dbRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get(dbTablesPaths, dbRateLimiter, async (req, res) => {
  const dbId = req.params.dbId ?? "";
  const connectionString = resolveDbConnection(dbId);
  if (!connectionString) {
    res.status(404).json({ error: "No connection configured for the requested database" });
    return;
  }

  try {
    const pool = getPool(connectionString);
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    res.json({
      dbId,
      tables: result.rows.map((r: { table_name: string }) => r.table_name),
    });
  } catch (error) {
    console.error("Failed to list tables for db:", dbId, error instanceof Error ? error.message : error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list tables",
    });
  }
});

app.get(dbTableDataPaths, dbRateLimiter, async (req, res) => {
  const dbId = req.params.dbId ?? "";
  const tableName = req.params.tableName ?? "";
  const connectionString = resolveDbConnection(dbId);
  if (!connectionString) {
    res.status(404).json({ error: "No connection configured for the requested database" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));

  try {
    const pool = getPool(connectionString);

    // Validate table name exists and retrieve the canonical name to prevent SQL injection
    const tableCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName],
    );
    if (tableCheck.rows.length === 0) {
      res.status(404).json({ error: "Table not found" });
      return;
    }

    // Use the validated table name from the database catalog
    const validatedTable: string = tableCheck.rows[0].table_name;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM "${validatedTable}"`,
    );
    const totalRows = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRows / pageSize);
    const offset = (page - 1) * pageSize;

    const dataResult = await pool.query(
      `SELECT * FROM "${validatedTable}" LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    res.json({
      dbId,
      tableName: validatedTable,
      columns: dataResult.fields.map((f) => f.name),
      rows: dataResult.rows,
      totalRows,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error("Failed to query table for db:", dbId, error instanceof Error ? error.message : error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to query table",
    });
  }
});

app.listen(port, () => {
  console.log(`Shop visualization backend listening on port ${port}`);
});
