export type ArchitectureNode = {
  id: string;
  label: string;
  stack?: string;
  description: string;
  group:
    | "entry"
    | "frontend"
    | "infra"
    | "service"
    | "data"
    | "queue"
    | "mirrord";
  repoPath?: string;
};

export type ArchitectureEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  intent?: "request" | "data" | "mirrored" | "control";
};

export const architectureNodes: ArchitectureNode[] = [
  {
    id: "user",
    label: "External user",
    stack: "Browser / curl",
    description: "Initiates traffic through the UI or direct HTTP calls.",
    group: "entry",
  },
  {
    id: "frontend",
    label: "ip-visit-frontend",
    stack: "Next.js",
    description: "Serves the demo UI and fetches the visit counter API.",
    group: "frontend",
    repoPath: "ip-visit-frontend/",
  },
  {
    id: "ingress",
    label: "Ingress + Service",
    stack: "GKE",
    description: "Public entrypoint routing traffic to ip-visit-counter pods.",
    group: "infra",
  },
  {
    id: "mirrord-operator",
    label: "mirrord Operator",
    stack: "Kubernetes controller",
    description: "Injects the mirrord agent when a developer session is attached.",
    group: "mirrord",
  },
  {
    id: "mirrord-agent",
    label: "mirrord Agent",
    stack: "Sidecar",
    description: "Hooks networking for ip-visit-counter to mirror or reroute requests.",
    group: "mirrord",
  },
  {
    id: "developer",
    label: "Developer workload",
    stack: "mirrord session",
    description: "Local ip-visit-counter process receiving mirrored traffic.",
    group: "mirrord",
  },
  {
    id: "ip-visit-counter",
    label: "ip-visit-counter",
    stack: "Go / Gin",
    description: "Counts visits, enriches IP data, and fans out events.",
    group: "service",
    repoPath: "ip-visit-counter/",
  },
  {
    id: "redis",
    label: "Redis",
    stack: "Cache",
    description: "Per-IP visit counters with TTL.",
    group: "data",
  },
  {
    id: "kafka",
    label: "Kafka topic",
    stack: "ip-visits",
    description: "Receives visit events from the counter service.",
    group: "queue",
  },
  {
    id: "sqs",
    label: "SQS queue",
    stack: "IpCount",
    description: "Optional queue splitting target managed via mirrord.",
    group: "queue",
  },
  {
    id: "ip-info-http",
    label: "ip-info",
    stack: "Go / REST",
    description: "HTTP service returning friendly text for IPs.",
    group: "service",
    repoPath: "ip-info/",
  },
  {
    id: "ip-info-grpc",
    label: "ip-info-grpc",
    stack: "Go / gRPC",
    description: "gRPC variant for IP info lookup.",
    group: "service",
    repoPath: "ip-info-grpc/",
  },
  {
    id: "ip-visit-consumer",
    label: "ip-visit-consumer",
    stack: "Python / Kafka",
    description: "Reads Kafka events and logs multi-tenant visits.",
    group: "service",
    repoPath: "ip-visit-consumer/",
  },
  {
    id: "ip-visit-sqs-consumer",
    label: "ip-visit-sqs-consumer",
    stack: "Go / SQS",
    description: "Consumes the mirrored SQS queue for queue splitting demos.",
    group: "service",
    repoPath: "ip-visit-sqs-consumer/",
  },
];

export const architectureEdges: ArchitectureEdge[] = [
  {
    id: "user-to-frontend",
    source: "user",
    target: "frontend",
    label: "Open playground UI",
    intent: "request",
  },
  {
    id: "frontend-to-ingress",
    source: "frontend",
    target: "ingress",
    label: "Fetch /count",
    intent: "request",
  },
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
    id: "agent-to-counter",
    source: "mirrord-agent",
    target: "ip-visit-counter",
    label: "Hook traffic",
    intent: "mirrored",
  },
  {
    id: "agent-to-developer",
    source: "mirrord-agent",
    target: "developer",
    label: "Forward intercepted requests",
    intent: "mirrored",
  },
  {
    id: "developer-to-redis",
    source: "developer",
    target: "redis",
    label: "Use cluster Redis",
    intent: "mirrored",
  },
  {
    id: "developer-to-kafka",
    source: "developer",
    target: "kafka",
    label: "Publish debug events",
    intent: "mirrored",
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
    id: "counter-to-sqs",
    source: "ip-visit-counter",
    target: "sqs",
    label: "Queue split",
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
    id: "counter-to-ipinfo-grpc",
    source: "ip-visit-counter",
    target: "ip-info-grpc",
    label: "gRPC lookup",
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
    id: "sqs-to-consumer",
    source: "sqs",
    target: "ip-visit-sqs-consumer",
    label: "Process queue",
    intent: "data",
  },
];

export const groupPalette: Record<
  ArchitectureNode["group"],
  { background: string; border: string; text: string }
> = {
  entry: { background: "#F5F5F5", border: "#0F172A", text: "#111827" },
  frontend: { background: "#E9E4FF", border: "#4F46E5", text: "#1E1B4B" },
  infra: { background: "#FFFFFF", border: "#D1D5DB", text: "#111827" },
  service: { background: "#FFF6E6", border: "#F5B42A", text: "#7C2D12" },
  data: { background: "#FDF0F2", border: "#E66479", text: "#7F1D1D" },
  queue: { background: "#FFF8E8", border: "#F5B42A", text: "#7C2D12" },
  mirrord: { background: "#E3E8FF", border: "#4F46E5", text: "#111827" },
};
