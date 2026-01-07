import express from "express";
import cors from "cors";
import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

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
  namespace?: string;
};

/**
 * Active mirrord agent session information captured from the agent poller.
 */
type SessionStatus = {
  id: string;
  podName: string;
  namespace: string;
  targetWorkload?: string | undefined;
  lastUpdated: string;
};

/**
 * Normalize container IDs reported by Kubernetes so the runtime prefix
 * (docker://, containerd://, ...) does not impact equality checks.
 */
const normalizeContainerId = (rawId: string | undefined): string | null => {
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

/**
 * Aggregated snapshot shared with the frontend.
 */
type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
  sessions: SessionStatus[];
  namespace: string;
};

/**
 * Store that manages snapshots keyed by namespace.
 */
class SnapshotStore {
  private clusterName: string;
  // Map<Namespace, SnapshotData>
  private snapshots = new Map<string, {
    services: Map<string, ServiceStatus>;
    sessions: Map<string, SessionStatus>;
    lastUpdated: string;
  }>();

  constructor(clusterName: string) {
    this.clusterName = clusterName;
  }

  private getNamespaceStore(namespace: string) {
    let store = this.snapshots.get(namespace);
    if (!store) {
      store = {
        services: new Map(),
        sessions: new Map(),
        lastUpdated: new Date().toISOString()
      };
      this.snapshots.set(namespace, store);
    }
    return store;
  }

  public getSnapshot(namespace: string): ClusterSnapshot {
    const store = this.getNamespaceStore(namespace);
    return {
      clusterName: this.clusterName,
      namespace,
      updatedAt: store.lastUpdated,
      services: Array.from(store.services.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      sessions: Array.from(store.sessions.values()).sort((a, b) =>
        a.podName.localeCompare(b.podName),
      ),
    };
  }

  public updateServices(namespace: string, services: ServiceStatus[]) {
    const store = this.getNamespaceStore(namespace);
    store.services.clear(); // Replace current state for this namespace
    services.forEach(s => store.services.set(s.id, s));
    store.lastUpdated = new Date().toISOString();
  }

  public updateSessions(namespace: string, sessions: SessionStatus[]) {
    const store = this.getNamespaceStore(namespace);
    store.sessions.clear();
    sessions.forEach(s => store.sessions.set(s.id, s));
    store.lastUpdated = new Date().toISOString();
  }
}

const snapshotStore = new SnapshotStore(process.env.CLUSTER_NAME || "playground");

/**
 * Resolve (app, tier) to a Kubernetes Namespace.
 */
const resolveNamespace = (app: string, tier: string): string => {
  // Default fallback
  if (!app || !tier) return "default";

  // Convention:
  // tier=demo -> demo-{app}
  // tier=dev  -> demo-{app}-dev
  const cleanApp = app.toLowerCase();
  const cleanTier = tier.toLowerCase();

  if (cleanTier === "dev") {
    return `demo-${cleanApp}-dev`;
  }
  return `demo-${cleanApp}`;
};

const pollIntervalMs = Number(process.env.WATCH_INTERVAL_MS ?? "5000");

/**
 * Attempt to load Kubernetes credentials.
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
      console.warn("Kubernetes configuration not found; automatic snapshot updates disabled.");
      return null;
    }
  }
};

/**
 * Shared poller logic.
 * Note: To keep it simple and scalable, we will poll namespaces demand-driven or just poll known namespaces.
 * For this implementation, we will fetch ALL namespaces that look like `demo-*` to populate the cache proactively,
 * OR allows polling specific namespace on request.
 * 
 * Given we want a reactive "Target-Aware" system, polling active namespaces is better.
 */
const startPollers = (kubeConfig: KubeConfig) => {
  const appsApi = kubeConfig.makeApiClient(AppsV1Api);
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);

  const pollNamespaces = async () => {
    try {
      // List all namespaces to find targets
      const nsList = await coreApi.listNamespace();
      // @ts-ignore
      const nsItems = nsList.body ? nsList.body.items : (nsList.items || []);

      const demoNamespaces = nsItems
        .map((ns: any) => ns.metadata?.name || "")
        .filter((name: any) => typeof name === 'string' && name.startsWith("demo-"));

      // For each demo namespace, poll deployments
      await Promise.all(demoNamespaces.map(async (ns: string) => {
        try {
          // @ts-ignore - The types for this client library can be slightly misaligned with the actual method signature in some versions or usage contexts
          const deployList = await appsApi.listNamespacedDeployment(ns);
          // @ts-ignore
          const items = deployList.body ? deployList.body.items : (deployList.items || []);

          const services: ServiceStatus[] = items.map((d: any) => ({
            id: d.metadata?.name || "",
            name: d.metadata?.name || "",
            description: "Managed by ArgoCD",
            lastUpdated: new Date().toISOString(),
            status: (d.status?.availableReplicas ?? 0) > 0 ? "available" : "degraded",
            availableReplicas: d.status?.availableReplicas ?? 0,
            namespace: ns
          }));
          snapshotStore.updateServices(ns, services);
        } catch (e) {
          console.error(`Failed to poll deployments in ${ns}`, e);
        }
      }));

      // Poll mirrord sessions globally and partition by namespace
      const podsResponse = await coreApi.listPodForAllNamespaces();
      // @ts-ignore
      const allPods = podsResponse.body ? podsResponse.body.items : (podsResponse.items || []);

      const sessionsByNamespace = new Map<string, SessionStatus[]>();

      // Index container IDs (Global)
      const containerIdIndex = new Map<string, { namespace: string; workload: string }>();
      allPods.forEach((pod: any) => {
        const ns = pod.metadata?.namespace || "default";
        const podName = pod.metadata?.name || "";
        const owner = pod.metadata?.ownerReferences?.[0]?.name || podName;
        const workloadId = `${ns}/${owner}`; // Simplified workload ID

        pod.status?.containerStatuses?.forEach((status: any) => {
          const normId = normalizeContainerId(status.containerID);
          if (normId) containerIdIndex.set(normId, { namespace: ns, workload: workloadId });
        });
      });

      // Find Agents
      allPods.forEach((pod: any) => {
        // Check if it's a mirrord agent
        const agentContainer = pod.spec?.containers.find((c: any) => c.name.includes("mirrord-agent"));
        if (!agentContainer) return;

        const args = agentContainer.args || [];
        const idx = args.indexOf("--container-id");
        if (idx === -1) return;

        const targetId = normalizeContainerId(args[idx + 1]);
        if (!targetId || !containerIdIndex.has(targetId)) return;

        const targetInfo = containerIdIndex.get(targetId)!;
        const session: SessionStatus = {
          id: pod.metadata?.name || "",
          podName: pod.metadata?.name || "",
          namespace: targetInfo.namespace,
          targetWorkload: targetInfo.workload,
          lastUpdated: new Date().toISOString()
        };

        if (!sessionsByNamespace.has(targetInfo.namespace)) {
          sessionsByNamespace.set(targetInfo.namespace, []);
        }
        sessionsByNamespace.get(targetInfo.namespace)?.push(session);
      });

      // Update store for all namespaces (clearing those with no sessions if needed)
      demoNamespaces.forEach((ns: string) => {
        snapshotStore.updateSessions(ns, sessionsByNamespace.get(ns) || []);
      });

    } catch (e) {
      console.error("Poller error", e);
    }
  };

  const runPoll = async () => {
    await pollNamespaces();
  };

  setInterval(runPoll, pollIntervalMs);
  runPoll(); // Initial run

  return runPoll;
};

const kubeConfig = loadKubeConfiguration();
let forcePoll: (() => Promise<void>) | null = null;
if (kubeConfig) {
  forcePoll = startPollers(kubeConfig);
}

app.get(["/snapshot", "/visualization/api/snapshot"], async (req, res) => {
  const app = req.query.app as string;
  const tier = req.query.tier as string;

  if (!app || !tier) {
    res.status(400).json({ error: "Missing 'app' or 'tier' query parameters." });
    return;
  }

  const ns = resolveNamespace(app, tier);

  if (req.query.refresh === "true" && forcePoll) {
    await forcePoll();
  }

  res.json(snapshotStore.getSnapshot(ns));
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Visualization backend listening on port ${port}`);
});
