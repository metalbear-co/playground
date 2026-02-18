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
      "metal-mart-frontend",
      "inventory-service",
      "order-service",
      "payment-service",
      "delivery-service",
      "kafka",
      "postgres-inventory",
      "postgres-orders",
      "postgres-deliveries",
      // "temporal",
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
    description: "Initiates traffic through the storefront UI.",
    group: "entry",
    zone: "external",
  },
  {
    id: "ingress",
    label: "Ingress + Service",
    stack: "GKE",
    description: "Public entrypoint routing traffic to the Metal Mart frontend.",
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
    description: "Runs your binary with mirrord-layer injected.",
    group: "mirrord",
    zone: "local",
  },
  {
    id: "metal-mart-frontend",
    label: "metal-mart-frontend",
    stack: "Next.js / React",
    description: "E-commerce storefront with product catalog, cart, and checkout.",
    group: "service",
    repoPath: "shop/metal-mart-frontend/",
    zone: "cluster",
  },
  {
    id: "inventory-service",
    label: "inventory-service",
    stack: "Node.js / Express",
    description: "Product catalog and stock management.",
    group: "service",
    repoPath: "shop/inventory-service/",
    zone: "cluster",
  },
  {
    id: "order-service",
    label: "order-service",
    stack: "Node.js / Express / Temporal",
    description: "Order orchestration with optional durable workflows.",
    group: "service",
    repoPath: "shop/order-service/",
    zone: "cluster",
  },
  {
    id: "payment-service",
    label: "payment-service",
    stack: "Node.js / Express",
    description: "Mock payment processing (always succeeds).",
    group: "service",
    repoPath: "shop/payment-service/",
    zone: "cluster",
  },
  {
    id: "delivery-service",
    label: "delivery-service",
    stack: "Node.js / Express",
    description: "Kafka consumer that creates delivery records.",
    group: "service",
    repoPath: "shop/delivery-service/",
    zone: "cluster",
  },
  {
    id: "kafka",
    label: "Kafka topic",
    stack: "orders",
    description: "Receives order events from the order service.",
    group: "queue",
    zone: "cluster",
  },
  {
    id: "postgres-inventory",
    label: "PostgreSQL",
    stack: "Inventory DB",
    description: "Stores product catalog and stock levels.",
    group: "data",
    zone: "cluster",
  },
  {
    id: "postgres-orders",
    label: "PostgreSQL",
    stack: "Orders DB",
    description: "Stores order records and status.",
    group: "data",
    zone: "cluster",
  },
  {
    id: "postgres-deliveries",
    label: "PostgreSQL",
    stack: "Deliveries DB",
    description: "Stores delivery tracking records.",
    group: "data",
    zone: "cluster",
  },
  // {
  //   id: "temporal",
  //   label: "Temporal",
  //   stack: "Workflow engine",
  //   description: "Durable workflow orchestration for the checkout flow.",
  //   group: "infra",
  //   zone: "cluster",
  // },
];

export const architectureEdges: ArchitectureEdge[] = [
  {
    id: "user-to-ingress",
    source: "user",
    target: "ingress",
    label: "Browse store",
    intent: "request",
  },
  {
    id: "ingress-to-frontend",
    source: "ingress",
    target: "metal-mart-frontend",
    label: "Route to frontend",
    intent: "request",
  },
  {
    id: "frontend-to-inventory",
    source: "metal-mart-frontend",
    target: "inventory-service",
    label: "GET /products",
    intent: "request",
  },
  {
    id: "frontend-to-orders",
    source: "metal-mart-frontend",
    target: "order-service",
    label: "POST /orders",
    intent: "request",
  },
  {
    id: "frontend-to-deliveries",
    source: "metal-mart-frontend",
    target: "delivery-service",
    label: "GET /deliveries",
    intent: "request",
  },
  {
    id: "order-to-inventory",
    source: "order-service",
    target: "inventory-service",
    label: "Check stock",
    intent: "request",
  },
  {
    id: "order-to-payment",
    source: "order-service",
    target: "payment-service",
    label: "Process payment",
    intent: "request",
  },
  {
    id: "order-to-kafka",
    source: "order-service",
    target: "kafka",
    label: "Emit order event",
    intent: "data",
  },
  // {
  //   id: "order-to-temporal",
  //   source: "order-service",
  //   target: "temporal",
  //   label: "Checkout workflow",
  //   intent: "control",
  // },
  {
    id: "order-to-postgres",
    source: "order-service",
    target: "postgres-orders",
    label: "Store order",
    intent: "data",
  },
  {
    id: "inventory-to-postgres",
    source: "inventory-service",
    target: "postgres-inventory",
    label: "Product catalog",
    intent: "data",
  },
  {
    id: "kafka-to-delivery",
    source: "kafka",
    target: "delivery-service",
    label: "Process orders",
    intent: "data",
  },
  {
    id: "delivery-to-postgres",
    source: "delivery-service",
    target: "postgres-deliveries",
    label: "Create delivery",
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
    target: "order-service",
    label: "Impersonate target pod",
    intent: "mirrored",
  },
];

export const groupPalette: Record<
  ArchitectureNode["group"],
  { background: string; border: string; text: string }
> = {
  entry: { background: "#FFFFFF", border: "#0F172A", text: "#111827" },
  infra: { background: "#FFFFFF", border: "#6B7280", text: "#111827" },
  service: { background: "#FBF8F2", border: "#EA580C", text: "#111827" },
  data: { background: "#FFFFFF", border: "#DC2626", text: "#111827" },
  queue: { background: "#FFFFFF", border: "#CA8A04", text: "#111827" },
  mirrord: { background: "#EEF2FF", border: "#4F46E5", text: "#111827" },
};
