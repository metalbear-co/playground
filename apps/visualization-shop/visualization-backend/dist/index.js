import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pg from "pg";
import { AppsV1Api, CoreV1Api, CustomObjectsApi, KubeConfig, } from "@kubernetes/client-node";
/**
 * Express application that exposes the cluster snapshot consumed by the React visualization.
 */
const app = express();
const port = process.env.PORT || 8080;
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
/**
 * In-memory store that keeps the latest cluster snapshot. All pollers and API handlers interact with
 * this store so the frontend can always pull a single coherent object.
 */
class SnapshotStore {
    constructor(clusterName) {
        this.services = new Map();
        this.clusterName = clusterName;
    }
    setClusterName(name) {
        this.clusterName = name;
    }
    getSnapshot() {
        return {
            clusterName: this.clusterName,
            updatedAt: new Date().toISOString(),
            services: Array.from(this.services.values()).sort((a, b) => a.name.localeCompare(b.name)),
        };
    }
    replaceSnapshot(partial) {
        if (partial.clusterName) {
            this.clusterName = partial.clusterName;
        }
        this.services.clear();
        partial.services?.forEach((service) => {
            const status = {
                ...service,
                lastUpdated: service.lastUpdated ?? new Date().toISOString(),
            };
            this.services.set(status.id, status);
        });
    }
    upsertService(service) {
        this.services.set(service.id, service);
    }
    removeService(id) {
        this.services.delete(id);
    }
}
const snapshotStore = new SnapshotStore(process.env.CLUSTER_NAME || "playground");
let triggerDeploymentPoll = null;
let kubeConfigRef = null;
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
        const wantsRefresh = req.query.refresh === "1" || req.query.refresh === "true";
        if (wantsRefresh) {
            await runRefreshPollers();
        }
        res.json(snapshotStore.getSnapshot());
    }
    catch (error) {
        console.error("Snapshot retrieval failed", error instanceof Error ? error.message : error);
        res.status(500).json({
            error: error instanceof Error
                ? error.message
                : "Failed to retrieve snapshot. See server logs for details.",
        });
    }
});
/**
 * Replace the snapshot with user-provided data (handy for demos without a real cluster).
 */
app.post(snapshotPostPaths, (req, res) => {
    const body = req.body;
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
    }
    catch (error) {
        console.error("Snapshot refresh failed", error instanceof Error ? error.message : error);
        res.status(500).json({
            error: error instanceof Error
                ? error.message
                : "Failed to refresh snapshot. See server logs for details.",
        });
    }
});
/**
 * Query MirrordClusterSession custom resources from the operator CRD.
 * Returns structured session data including user, target, and timing info.
 */
const fetchOperatorSessions = async (kubeConfig) => {
    const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const result = await customApi.listClusterCustomObject({
        group: "mirrord.metalbear.co",
        version: "v1alpha",
        plural: "mirrordclustersessions",
    });
    const body = result;
    const items = body.items ?? [];
    const now = Date.now();
    return items.map((item) => {
        const metadata = (item.metadata ?? {});
        const spec = (item.spec ?? {});
        const status = (item.status ?? {});
        const target = (spec.target ?? {});
        const owner = (spec.owner ?? {});
        const jiraMetrics = (spec.jiraMetrics ?? {});
        const createdAt = metadata.creationTimestamp ?? new Date().toISOString();
        const connectedAt = status.connectedTimestamp;
        const createdMs = new Date(createdAt).getTime();
        const durationSeconds = Math.floor((now - createdMs) / 1000);
        return {
            sessionId: metadata.name ?? "unknown",
            target: {
                kind: target.kind ?? "Unknown",
                name: target.name ?? "unknown",
                container: target.container,
                apiVersion: target.apiVersion,
            },
            namespace: spec.namespace ?? "default",
            owner: {
                username: owner.username ?? "unknown",
                k8sUsername: owner.k8sUsername ?? "unknown",
                hostname: owner.hostname ?? "unknown",
            },
            branchName: jiraMetrics.branchName,
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
const fetchKafkaEphemeralTopics = async (kubeConfig) => {
    const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const result = await customApi.listClusterCustomObject({
        group: "queues.mirrord.metalbear.co",
        version: "v1alpha",
        plural: "mirrordkafkaephemeraltopics",
    });
    const body = result;
    const items = body.items ?? [];
    return items.map((item) => {
        const metadata = (item.metadata ?? {});
        const spec = (item.spec ?? {});
        const labels = (metadata.labels ?? {});
        const topicName = spec.name ?? "unknown";
        return {
            topicName,
            sessionId: labels["operator.metalbear.co/session-id"] ?? "unknown",
            clientConfig: spec.clientConfig ?? "unknown",
            topicType: topicName.includes("-fallback-") ? "Fallback" : "Filtered",
        };
    });
};
/**
 * Query MirrordSqsSession custom resources from the operator CRD.
 * Returns ephemeral SQS queues linked to active splitting sessions.
 */
const fetchSqsEphemeralQueues = async (kubeConfig) => {
    const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const result = await customApi.listClusterCustomObject({
        group: "queues.mirrord.metalbear.co",
        version: "v1alpha",
        plural: "mirrordsqssessions",
    });
    const body = result;
    const items = body.items ?? [];
    const queues = [];
    for (const item of items) {
        const metadata = (item.metadata ?? {});
        const spec = (item.spec ?? {});
        const status = (item.status ?? {});
        const labels = (metadata.labels ?? {});
        const sessionId = labels["mirrord-session"] ?? spec.sessionId ?? "unknown";
        const consumer = spec.queueConsumer?.name ?? "unknown";
        const jqFilters = (spec.queueJqFilters ?? {});
        const ready = (status["Ready"] ?? {});
        const envUpdates = (ready.envUpdates ?? {});
        for (const [, mapping] of Object.entries(envUpdates)) {
            const outputUrl = mapping.outputName ?? "";
            const originalUrl = mapping.originalName ?? "";
            const queueName = outputUrl.split("/").pop() ?? outputUrl;
            const originalQueueName = originalUrl.split("/").pop() ?? originalUrl;
            const jqFilter = Object.values(jqFilters)[0];
            const entry = { queueName, originalQueueName, sessionId, consumer };
            if (jqFilter !== undefined)
                entry.jqFilter = jqFilter;
            queues.push(entry);
        }
    }
    return queues;
};
/**
 * Query PgBranchDatabase custom resources from the operator CRD.
 * Returns branch data including target deployment, phase, and owner info.
 */
const fetchPgBranchDatabases = async (kubeConfig) => {
    const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const result = await customApi.listNamespacedCustomObject({
        group: "dbs.mirrord.metalbear.co",
        version: "v1alpha1",
        namespace: defaultNamespace,
        plural: "pgbranchdatabases",
    });
    const body = result;
    const items = body.items ?? [];
    return items.map((item) => {
        const metadata = (item.metadata ?? {});
        const spec = (item.spec ?? {});
        const status = (item.status ?? {});
        const target = (spec.target ?? {});
        const sessionInfo = (status.sessionInfo ?? {});
        const owners = Object.values(sessionInfo).map((session) => {
            const owner = (session.owner ?? {});
            return {
                username: owner.username ?? "unknown",
                hostname: owner.hostname ?? "unknown",
            };
        });
        const connectionUrl = status.connectionUrl ??
            status.connectionString ??
            undefined;
        return {
            name: metadata.name ?? "unknown",
            namespace: metadata.namespace ?? defaultNamespace,
            branchId: spec.id ?? "unknown",
            targetDeployment: target.deployment ?? "unknown",
            copyMode: spec.copy?.mode ?? "unknown",
            postgresVersion: spec.postgresVersion ?? "unknown",
            phase: status.phase ?? "unknown",
            expireTime: status.expireTime ?? undefined,
            connectionUrl,
            owners,
        };
    });
};
/**
 * Query PreviewSession custom resources from the operator CRD.
 * Returns preview session data including target, key, phase, and pod info.
 */
const fetchPreviewSessions = async (kubeConfig) => {
    const customApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const result = await customApi.listNamespacedCustomObject({
        group: "preview.mirrord.metalbear.co",
        version: "v1alpha",
        namespace: defaultNamespace,
        plural: "previewsessions",
    });
    const body = result;
    const items = body.items ?? [];
    return items.map((item) => {
        const metadata = (item.metadata ?? {});
        const spec = (item.spec ?? {});
        const status = (item.status ?? {});
        const target = (spec.target ?? {});
        return {
            name: metadata.name ?? "unknown",
            namespace: metadata.namespace ?? defaultNamespace,
            key: spec.key ?? "unknown",
            target: {
                kind: target.kind ?? "Deployment",
                name: target.name ?? "unknown",
                container: target.container ?? "main",
            },
            image: spec.image ?? "unknown",
            ttlSecs: spec.ttlSecs ?? 0,
            phase: status.phase ?? "unknown",
            podName: status.podName ?? undefined,
            failureMessage: status.failureMessage ?? undefined,
            startedAt: status.startedAt ?? undefined,
        };
    });
};
const dynamicPgConnections = new Map();
const sanitizeHostname = (raw) => raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
const refreshDynamicPgConnections = (branches) => {
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
        const response = {
            ...mockMultipleSessionsOperatorStatus,
            pgBranches: requestUseDbBranchMock ? mockPgBranches : [],
            previewSessions: mockMultipleSessionsOperatorStatus.previewSessions,
            fetchedAt: new Date().toISOString(),
        };
        res.json(response);
        return;
    }
    if (requestUseMock) {
        const response = {
            ...mockOperatorStatus,
            pgBranches: requestUseDbBranchMock ? mockPgBranches : [],
            previewSessions: mockOperatorStatus.previewSessions,
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
        const [sessions, kafkaTopics, sqsQueues, pgBranches, previewSessions] = await Promise.all([
            fetchOperatorSessions(kubeConfigRef).catch((err) => {
                console.warn("Failed to fetch operator sessions:", err instanceof Error ? err.message : err);
                return [];
            }),
            fetchKafkaEphemeralTopics(kubeConfigRef).catch((err) => {
                console.warn("Failed to fetch kafka topics:", err instanceof Error ? err.message : err);
                return [];
            }),
            fetchSqsEphemeralQueues(kubeConfigRef).catch((err) => {
                console.warn("Failed to fetch SQS sessions:", err instanceof Error ? err.message : err);
                return [];
            }),
            requestUseDbBranchMock
                ? Promise.resolve(mockPgBranches)
                : fetchPgBranchDatabases(kubeConfigRef).catch((err) => {
                    console.warn("Failed to fetch pg branches:", err instanceof Error ? err.message : err);
                    return [];
                }),
            fetchPreviewSessions(kubeConfigRef).catch((err) => {
                console.warn("Failed to fetch preview sessions:", err instanceof Error ? err.message : err);
                return [];
            }),
        ]);
        const allSessions = requestUseDbBranchMock
            ? [...sessions, mockDbBranchSession]
            : sessions;
        refreshDynamicPgConnections(pgBranches);
        const response = {
            sessions: allSessions,
            sessionCount: allSessions.length,
            kafkaTopics,
            sqsQueues,
            pgBranches,
            previewSessions,
            fetchedAt: new Date().toISOString(),
        };
        res.json(response);
    }
    catch (error) {
        console.error("Operator status fetch failed", error instanceof Error ? error.message : error);
        res.status(500).json({
            error: error instanceof Error
                ? error.message
                : "Failed to fetch operator sessions. See server logs for details.",
        });
    }
});
/**
 * Deployments we poll for status information. Each entry becomes a service node in the snapshot.
 */
const knownDeployments = [
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
const mockSnapshot = {
    clusterName: "mock-playground",
    updatedAt: new Date().toISOString(),
    services: knownDeployments.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        lastUpdated: new Date().toISOString(),
        status: "available",
        availableReplicas: 2,
    })),
};
const mockSqsQueues = [
    {
        queueName: "mirrord-phxgypecfv-payments",
        originalQueueName: "payments",
        sessionId: "DC190DEE9C7F8651",
        consumer: "payment-service",
        jqFilter: ".Body | fromjson | .customer_email | test(\"metalbear\\\\.com\")",
    },
];
const mockOperatorStatus = {
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
            topicType: "Filtered",
        },
        {
            topicName: "mirrord-tmp-kmhkbbzgki-fallback-orders",
            sessionId: "504d016ef5980f1a",
            clientConfig: "shop-kafka-config",
            topicType: "Fallback",
        },
    ],
    sqsQueues: mockSqsQueues,
    pgBranches: [],
    previewSessions: [],
    fetchedAt: new Date().toISOString(),
};
const mockPgBranches = [
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
const mockMultipleSessionsOperatorStatus = {
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
    sqsQueues: [],
    pgBranches: [],
    previewSessions: [
        {
            name: "preview-session-deployment-metal-mart-frontend-11cf356f",
            namespace: "shop",
            key: "redesign",
            target: { kind: "Deployment", name: "metal-mart-frontend", container: "main" },
            image: "ghcr.io/metalbear-co/metalmart-redesign:latest",
            ttlSecs: 300,
            phase: "Ready",
            podName: "preview-pod-deployment-metal-mart-frontend-11cf356f",
            startedAt: "2026-02-25T12:17:31.405462Z",
        },
    ],
    fetchedAt: new Date().toISOString(),
};
const mockDbBranchSession = {
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
const loadKubeConfiguration = () => {
    const kubeConfig = new KubeConfig();
    try {
        kubeConfig.loadFromCluster();
        console.log("Loaded in-cluster Kubernetes configuration");
        return kubeConfig;
    }
    catch (clusterError) {
        try {
            kubeConfig.loadFromDefault();
            console.log("Loaded local kubeconfig");
            return kubeConfig;
        }
        catch (localError) {
            console.warn("Kubernetes configuration not found; automatic snapshot updates disabled.");
            return null;
        }
    }
};
const startDeploymentPoller = (kubeConfig) => {
    const appsApi = kubeConfig.makeApiClient(AppsV1Api);
    /**
     * Poll Kubernetes Deployments listed in `knownDeployments` and update the snapshot with their status.
     */
    const poll = async () => {
        await Promise.all(knownDeployments.map(async (service) => {
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
                }
                else {
                    snapshotStore.removeService(service.id);
                }
            }
            catch (error) {
                console.warn(`Failed to read deployment ${service.deployment} in namespace ${namespace}`, error instanceof Error ? error.message : error);
                snapshotStore.upsertService({
                    id: service.id,
                    name: service.name,
                    description: service.description,
                    lastUpdated: new Date().toISOString(),
                    status: "degraded",
                    message: error instanceof Error ? error.message : "Unknown Kubernetes error",
                });
            }
        })).then(() => {
            const snapshot = snapshotStore.getSnapshot();
            console.log(`[deployment-poller] ${new Date().toISOString()} - ` +
                `${snapshot.services.length} services tracked`);
        });
    };
    const runPoll = async () => {
        try {
            await poll();
        }
        catch (error) {
            console.error("Deployment poll failed", error instanceof Error ? error.message : error);
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
}
else {
    console.warn("Kubernetes configuration unavailable; snapshot watchers are disabled.");
}
// ---------------------------------------------------------------------------
// Database viewer endpoints
// ---------------------------------------------------------------------------
const staticDbConnections = {
    "postgres-inventory": process.env.PG_INVENTORY_URL,
    "postgres-orders": process.env.PG_ORDERS_URL,
    "postgres-deliveries": process.env.PG_DELIVERIES_URL,
};
/**
 * Resolve a pg-branch connection on demand by querying the cluster for the
 * branch pod (via label selector) and the target deployment's DATABASE_URL.
 */
const resolvePgBranchConnection = async (dbId) => {
    if (!kubeConfigRef || !dbId.startsWith("pg-branch-"))
        return undefined;
    const coreApi = kubeConfigRef.makeApiClient(CoreV1Api);
    const customApi = kubeConfigRef.makeApiClient(CustomObjectsApi);
    // Find the PgBranchDatabase CR whose sanitized name matches dbId
    const result = await customApi.listNamespacedCustomObject({
        group: "dbs.mirrord.metalbear.co",
        version: "v1alpha1",
        namespace: defaultNamespace,
        plural: "pgbranchdatabases",
    });
    const body = result;
    const items = body.items ?? [];
    const branch = items.find((item) => {
        const name = item.metadata?.name ?? "";
        return `pg-branch-${sanitizeHostname(name)}` === dbId;
    });
    if (!branch)
        return undefined;
    const metadata = (branch.metadata ?? {});
    const branchName = metadata.name;
    // Find the branch pod via owner label
    const podList = await coreApi.listNamespacedPod({
        namespace: defaultNamespace,
        labelSelector: `db-owner-name=${branchName}`,
    });
    const pod = podList.items?.[0];
    if (!pod?.status?.podIP)
        return undefined;
    const podIp = pod.status.podIP;
    const container = pod.spec?.containers?.[0];
    const envVars = container?.env ?? [];
    const password = envVars.find((e) => e.name === "POSTGRES_PASSWORD")?.value ??
        "postgres";
    const user = envVars.find((e) => e.name === "POSTGRES_USER")?.value ?? "postgres";
    // Get the database name from the branch pod's POSTGRES_DB env.
    // If not set, connect to the default "postgres" database and discover
    // the actual user database (mirrord copies data using the original DB name).
    let dbName = envVars.find((e) => e.name === "POSTGRES_DB")?.value ?? undefined;
    if (!dbName) {
        const discoverUrl = `postgresql://${user}:${password}@${podIp}:5432/postgres`;
        const discoverPool = new pg.Pool({
            connectionString: discoverUrl,
            max: 1,
            connectionTimeoutMillis: 10000,
        });
        try {
            const result = await discoverPool.query(`SELECT datname FROM pg_database
         WHERE datistemplate = false AND datname != 'postgres'
         ORDER BY datname LIMIT 1`);
            dbName = result.rows[0]?.datname ?? "postgres";
        }
        catch {
            dbName = "postgres";
        }
        finally {
            discoverPool.end().catch(() => { });
        }
    }
    const connectionUrl = `postgresql://${user}:${password}@${podIp}:5432/${dbName}`;
    dynamicPgConnections.set(dbId, connectionUrl);
    return connectionUrl;
};
const resolveDbConnection = async (dbId) => {
    if (staticDbConnections[dbId])
        return staticDbConnections[dbId];
    if (dynamicPgConnections.has(dbId))
        return dynamicPgConnections.get(dbId);
    return resolvePgBranchConnection(dbId);
};
const pgPools = new Map();
const getPool = (connectionString) => {
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
    windowMs: 60000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
});
app.get(dbTablesPaths, dbRateLimiter, async (req, res) => {
    const dbId = req.params.dbId ?? "";
    let connectionString = await resolveDbConnection(dbId);
    if (!connectionString) {
        res.status(404).json({ error: "No connection configured for the requested database" });
        return;
    }
    try {
        const pool = getPool(connectionString);
        const result = await pool.query(`SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`);
        res.json({
            dbId,
            tables: result.rows.map((r) => r.table_name),
        });
    }
    catch (error) {
        // If the connection failed and this was a cached dynamic connection, invalidate and retry once
        if (dynamicPgConnections.has(dbId)) {
            console.warn("Connection failed for cached db:", dbId, "— retrying with fresh resolution");
            const oldConn = dynamicPgConnections.get(dbId);
            dynamicPgConnections.delete(dbId);
            const oldPool = pgPools.get(oldConn);
            if (oldPool) {
                pgPools.delete(oldConn);
                oldPool.end().catch(() => { });
            }
            connectionString = await resolvePgBranchConnection(dbId);
            if (connectionString) {
                try {
                    const pool = getPool(connectionString);
                    const result = await pool.query(`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public'
             ORDER BY table_name`);
                    res.json({
                        dbId,
                        tables: result.rows.map((r) => r.table_name),
                    });
                    return;
                }
                catch (retryError) {
                    console.error("Retry also failed for db:", dbId, retryError instanceof Error ? retryError.message : retryError);
                    res.status(500).json({
                        error: retryError instanceof Error ? retryError.message : "Failed to list tables",
                    });
                    return;
                }
            }
        }
        console.error("Failed to list tables for db:", dbId, error instanceof Error ? error.message : error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to list tables",
        });
    }
});
const queryTableData = async (pool, dbId, tableName, page, pageSize) => {
    const tableCheck = await pool.query(`SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`, [tableName]);
    if (tableCheck.rows.length === 0)
        return null;
    const validatedTable = tableCheck.rows[0].table_name;
    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM "${validatedTable}"`);
    const totalRows = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRows / pageSize);
    const offset = (page - 1) * pageSize;
    const dataResult = await pool.query(`SELECT * FROM "${validatedTable}" ORDER BY ctid DESC LIMIT $1 OFFSET $2`, [pageSize, offset]);
    return {
        dbId,
        tableName: validatedTable,
        columns: dataResult.fields.map((f) => f.name),
        rows: dataResult.rows,
        totalRows,
        page,
        pageSize,
        totalPages,
    };
};
app.get(dbTableDataPaths, dbRateLimiter, async (req, res) => {
    const dbId = req.params.dbId ?? "";
    const tableName = req.params.tableName ?? "";
    let connectionString = await resolveDbConnection(dbId);
    if (!connectionString) {
        res.status(404).json({ error: "No connection configured for the requested database" });
        return;
    }
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
    try {
        const pool = getPool(connectionString);
        const result = await queryTableData(pool, dbId, tableName, page, pageSize);
        if (!result) {
            res.status(404).json({ error: "Table not found" });
            return;
        }
        res.json(result);
    }
    catch (error) {
        if (dynamicPgConnections.has(dbId)) {
            console.warn("Connection failed for cached db:", dbId, "— retrying with fresh resolution");
            const oldConn = dynamicPgConnections.get(dbId);
            dynamicPgConnections.delete(dbId);
            const oldPool = pgPools.get(oldConn);
            if (oldPool) {
                pgPools.delete(oldConn);
                oldPool.end().catch(() => { });
            }
            connectionString = await resolvePgBranchConnection(dbId);
            if (connectionString) {
                try {
                    const pool = getPool(connectionString);
                    const result = await queryTableData(pool, dbId, tableName, page, pageSize);
                    if (!result) {
                        res.status(404).json({ error: "Table not found" });
                        return;
                    }
                    res.json(result);
                    return;
                }
                catch (retryError) {
                    console.error("Retry also failed for db:", dbId, retryError instanceof Error ? retryError.message : retryError);
                    res.status(500).json({
                        error: retryError instanceof Error ? retryError.message : "Failed to query table",
                    });
                    return;
                }
            }
        }
        console.error("Failed to query table for db:", dbId, error instanceof Error ? error.message : error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to query table",
        });
    }
});
app.listen(port, () => {
    console.log(`Shop visualization backend listening on port ${port}`);
});
//# sourceMappingURL=index.js.map