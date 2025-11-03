export type ArchitectureNode = {
  id: string;
  label: string;
  stack?: string;
  description: string;
  group:
    | "entry"
    | "infra"
    | "service"
    | "data"
    | "queue"
    | "mirrord";
  repoPath?: string;
  zone?: "cluster" | "external" | "local";
};

export type ArchitectureEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  intent?: "request" | "data" | "mirrored" | "control";
};

export type ArchitectureZone = {
  id: string;
  label: string;
  description: string;
  nodes: string[];
  border: string;
  background: string;
  accent: string;
};

export const architectureZones: ArchitectureZone[] = [
  {
    id: "local",
    label: "Local Machine",
    description: "Developer laptop running the binary with mirrord-layer inserted.",
    nodes: ["local-process", "mirrord-layer"],
    border: "#60A5FA",
    background: "rgba(191, 219, 254, 0.4)",
    accent: "#3B82F6",
  },
  {
    id: "cluster",
    label: "GKE Cluster",
    description: "Ingress, services, data stores, and mirrord operator running in-cluster.",
    nodes: [
      "ingress",
      "ip-visit-counter",
      "redis",
      "kafka",
      "ip-info-http",
      "ip-visit-consumer",
      "mirrord-operator",
      "mirrord-agent",
    ],
    border: "#4F46E5",
    background: "rgba(233, 228, 255, 0.4)",
    accent: "#4F46E5",
  },
];

export const architectureNodes: ArchitectureNode[] = [
  {
    id: "user",
    label: "External user",
    stack: "Browser / curl",
    description: "Initiates traffic through the UI or direct HTTP calls.",
    group: "entry",
    zone: "external",
  },
  {
    id: "ingress",
    label: "Ingress + Service",
    stack: "GKE",
    description: "Public entrypoint routing traffic to ip-visit-counter pods.",
    group: "infra",
    zone: "cluster",
  },
  {
    id: "mirrord-operator",
    label: "mirrord Operator",
    stack: "Kubernetes controller",
    description: "Injects the mirrord agent when a developer session is attached.",
    group: "mirrord",
    zone: "cluster",
  },
  {
    id: "mirrord-agent",
    label: "mirrord Agent",
    stack: "Injected sidecar",
    description: "Appears in pods when mirrord sessions run.",
    group: "mirrord",
    zone: "cluster",
  },
  {
    id: "mirrord-layer",
    label: "mirrord-layer",
    stack: "LD_PRELOAD",
    description: "Intercepts libc calls from the local process.",
    group: "mirrord",
    zone: "local",
  },
  {
    id: "local-process",
    label: "Local process",
    stack: "Developer machine",
    description: "Runs your binary with mirrord-layer inserted.",
    group: "mirrord",
    zone: "local",
  },
  {
    id: "ip-visit-counter",
    label: "ip-visit-counter",
    stack: "Go / Gin",
    description: "Counts visits, enriches IP data, and fans out events.",
    group: "service",
    repoPath: "ip-visit-counter/",
    zone: "cluster",
  },
  {
    id: "redis",
    label: "Redis",
    stack: "Cache",
    description: "Per-IP visit counters with TTL.",
    group: "data",
    zone: "cluster",
  },
  {
    id: "kafka",
    label: "Kafka topic",
    stack: "ip-visits",
    description: "Receives visit events from the counter service.",
    group: "queue",
    zone: "cluster",
  },
  {
    id: "ip-info-http",
    label: "ip-info",
    stack: "Go / REST",
    description: "HTTP service returning friendly text for IPs.",
    group: "service",
    repoPath: "ip-info/",
    zone: "cluster",
  },
  {
    id: "ip-visit-consumer",
    label: "ip-visit-consumer",
    stack: "Python / Kafka",
    description: "Reads Kafka events and logs multi-tenant visits.",
    group: "service",
    repoPath: "ip-visit-consumer/",
    zone: "cluster",
  },
];

export const architectureEdges: ArchitectureEdge[] = [
  {
    id: "user-direct-to-ingress",
    source: "user",
    target: "ingress",
    label: "curl playground.metalbear.dev/count",
    intent: "request",
  },
  {
    id: "ingress-to-counter",
    source: "ingress",
    target: "ip-visit-counter",
    label: "Route to service",
    intent: "request",
  },
  {
    id: "operator-to-agent",
    source: "mirrord-operator",
    target: "mirrord-agent",
    label: "Inject & manage",
    intent: "control",
  },
  {
    id: "counter-to-redis",
    source: "ip-visit-counter",
    target: "redis",
    label: "INCR per IP",
    intent: "data",
  },
  {
    id: "counter-to-kafka",
    source: "ip-visit-counter",
    target: "kafka",
    label: "Emit visit event",
    intent: "data",
  },
  {
    id: "counter-to-ipinfo-http",
    source: "ip-visit-counter",
    target: "ip-info-http",
    label: "HTTP lookup",
    intent: "request",
  },
  {
    id: "kafka-to-consumer",
    source: "kafka",
    target: "ip-visit-consumer",
    label: "Process events",
    intent: "data",
  },
  {
    id: "layer-to-agent",
    source: "mirrord-layer",
    target: "mirrord-operator",
    intent: "mirrored",
  },
  {
    id: "operator-to-agent-mirrored",
    source: "mirrord-operator",
    target: "mirrord-agent",
    label: "Launch agent",
    intent: "mirrored",
  },
  {
    id: "local-to-layer",
    source: "local-process",
    target: "mirrord-layer",
    label: "LD_PRELOAD hook",
    intent: "mirrored",
  },
  {
    id: "agent-to-target",
    source: "mirrord-agent",
    target: "ip-visit-counter",
    label: "Impersonate target pod",
    intent: "mirrored",
  },
];

export const groupPalette: Record<
  ArchitectureNode["group"],
  { background: string; border: string; text: string }
> = {
  entry: { background: "#F5F5F5", border: "#0F172A", text: "#111827" },
  infra: { background: "#FFFFFF", border: "#D1D5DB", text: "#111827" },
  service: { background: "#FFF6E6", border: "#F5B42A", text: "#7C2D12" },
  data: { background: "#FDF0F2", border: "#E66479", text: "#7F1D1D" },
  queue: { background: "#FFF8E8", border: "#F5B42A", text: "#7C2D12" },
  mirrord: { background: "#E3E8FF", border: "#4F46E5", text: "#111827" },
};
