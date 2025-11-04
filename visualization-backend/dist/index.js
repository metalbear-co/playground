import express from "express";
import cors from "cors";
import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
const app = express();
const port = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());
const normalizeContainerId = (rawId) => {
    if (!rawId) {
        return null;
    }
    const trimmed = rawId.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const delimiterIndex = trimmed.indexOf("//");
    if (delimiterIndex !== -1) {
        return trimmed.slice(delimiterIndex + 2);
    }
    return trimmed;
};
class SnapshotStore {
    constructor(clusterName) {
        this.services = new Map();
        this.sessions = new Map();
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
            sessions: Array.from(this.sessions.values()).sort((a, b) => a.podName.localeCompare(b.podName)),
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
        if (partial.sessions) {
            this.sessions.clear();
            partial.sessions.forEach((session) => {
                const status = {
                    ...session,
                    lastUpdated: session.lastUpdated ?? new Date().toISOString(),
                };
                this.sessions.set(status.id, status);
            });
        }
    }
    upsertService(service) {
        this.services.set(service.id, service);
    }
    removeService(id) {
        this.services.delete(id);
    }
    setSessions(nextSessions) {
        this.sessions.clear();
        nextSessions.forEach((session) => {
            this.sessions.set(session.id, session);
        });
    }
}
const snapshotStore = new SnapshotStore(process.env.CLUSTER_NAME || "playground");
let triggerDeploymentPoll = null;
let triggerAgentPoll = null;
const runRefreshPollers = async () => {
    if (triggerDeploymentPoll) {
        await triggerDeploymentPoll();
    }
    if (triggerAgentPoll) {
        await triggerAgentPoll();
    }
};
app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
});
app.get("/snapshot", async (req, res) => {
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
app.post("/snapshot", (req, res) => {
    const body = req.body;
    snapshotStore.replaceSnapshot(body);
    res.json(snapshotStore.getSnapshot());
});
app.post("/snapshot/refresh", async (_req, res) => {
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
const knownDeployments = [
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
const startMirrordAgentPoller = (kubeConfig) => {
    const coreApi = kubeConfig.makeApiClient(CoreV1Api);
    const poll = async () => {
        try {
            const pods = await coreApi.listPodForAllNamespaces();
            const containerIdIndex = new Map();
            pods.items?.forEach((pod) => {
                const namespace = pod.metadata?.namespace ?? "default";
                const podName = pod.metadata?.name ?? "unknown-pod";
                const ownerReferences = pod.metadata?.ownerReferences ?? [];
                const ownerWorkload = ownerReferences.find((owner) => [
                    "Deployment",
                    "StatefulSet",
                    "DaemonSet",
                    "Job",
                    "CronJob",
                ].includes(owner.kind ?? ""))?.name;
                const replicaSetOwner = ownerReferences.find((owner) => owner.kind === "ReplicaSet")?.name;
                const inferredWorkload = ownerWorkload ?? replicaSetOwner ?? podName;
                const workloadId = `${namespace}/${inferredWorkload}`;
                const containerStatuses = [
                    ...(pod.status?.containerStatuses ?? []),
                    ...(pod.status?.initContainerStatuses ?? []),
                ];
                containerStatuses.forEach((status) => {
                    const normalizedId = normalizeContainerId(status.containerID);
                    if (!normalizedId) {
                        return;
                    }
                    containerIdIndex.set(normalizedId, {
                        namespace,
                        podName,
                        workload: workloadId,
                    });
                });
            });
            const sessions = [];
            pods.items?.forEach((pod) => {
                const containers = [
                    ...(pod.spec?.containers ?? []),
                    ...(pod.spec?.initContainers ?? []),
                ];
                const agentContainer = containers.find((container) => container.name.includes("mirrord-agent"));
                if (!agentContainer) {
                    return;
                }
                const namespace = pod.metadata?.namespace ?? "default";
                const podName = pod.metadata?.name ?? "unknown-pod";
                const agentArgs = [
                    ...(agentContainer.command ?? []),
                    ...(agentContainer.args ?? []),
                ];
                const containerIdFlagIndex = agentArgs.findIndex((arg) => arg === "--container-id");
                if (containerIdFlagIndex === -1) {
                    return;
                }
                const targetContainerId = agentArgs[containerIdFlagIndex + 1];
                const normalizedTargetId = normalizeContainerId(targetContainerId);
                if (!normalizedTargetId) {
                    return;
                }
                const targetInfo = containerIdIndex.get(normalizedTargetId);
                if (!targetInfo) {
                    return;
                }
                const targetWorkload = targetInfo.workload;
                sessions.push({
                    id: `${namespace}/${podName}`,
                    podName,
                    namespace,
                    targetWorkload,
                    lastUpdated: new Date().toISOString(),
                });
            });
            snapshotStore.setSessions(sessions);
            console.log(`[agent-poller] ${new Date().toISOString()} - ${sessions.length} mirrord agents detected`);
        }
        catch (error) {
            console.warn("Failed to poll mirrord agent pods", error instanceof Error ? error.message : error);
            throw error;
        }
    };
    const runPoll = async () => {
        try {
            await poll();
        }
        catch (error) {
            console.error("Mirrord agent poll failed", error instanceof Error ? error.message : error);
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
const kubeConfig = loadKubeConfiguration();
if (kubeConfig) {
    triggerDeploymentPoll = startDeploymentPoller(kubeConfig);
    triggerAgentPoll = startMirrordAgentPoller(kubeConfig);
}
else {
    console.warn("Kubernetes configuration unavailable; snapshot watchers are disabled.");
}
app.listen(port, () => {
    console.log(`Visualization backend listening on port ${port}`);
});
//# sourceMappingURL=index.js.map