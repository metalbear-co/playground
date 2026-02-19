"use client";

import "@xyflow/react/dist/style.css";

import dagre from "dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  architectureEdges,
  architectureNodes,
  architectureZones,
  groupPalette,
  type ArchitectureEdge,
  type ArchitectureNode,
} from "@/data/architecture";

/**
 * Custom data payload carried by each React Flow node rendered in the visualization.
 */
type NodeData = {
  label: string | React.ReactNode;
  group: ArchitectureNode["group"];
  stack?: string;
  description?: string;
  repoPath?: string;
  highlight?: boolean;
};

const nodeWidth = 260;
const nodeHeight = 130;

type EdgeIntent = NonNullable<ArchitectureEdge["intent"]>;

/**
 * Visual styles keyed by edge intent (request, data, mirrored, etc.).
 */
const intentStyles: Record<
  EdgeIntent | "default",
  { color: string; dash?: string; animated?: boolean }
> = {
  request: { color: "#4F46E5" },
  data: { color: "#F5B42A" },
  mirrored: { color: "#E66479", dash: "6 4", animated: true },
  control: { color: "#0F172A", dash: "2 4" },
  default: { color: "#94A3B8" },
};

/**
 * Transform the static architecture node definitions into React Flow nodes with layout metadata.
 */
const buildFlowNodes = (): Node<NodeData>[] =>
  architectureNodes.map((node) => {
    const isMirrordNode =
      node.id === "mirrord-layer" || node.id === "mirrord-agent" || node.id === "mirrord-operator";
    const palette = groupPalette[node.group];

    return {
      id: node.id,
      data: {
        group: node.group,
        label: node.label,
        stack: node.stack,
        description: node.description,
        repoPath: node.repoPath,
      },
      style: {
        borderRadius: 18,
        backgroundColor: "transparent",
        color: palette.text,
        width: nodeWidth,
        zIndex: 10,
      },
      sourcePosition: isMirrordNode ? Position.Right : Position.Right,
      targetPosition:
        node.id === "mirrord-layer"
          ? Position.Left
          : node.id === "mirrord-agent"
            ? Position.Left
            : Position.Left,
      connectable: false,
      draggable: true,
      selectable: true,
      position: { x: 0, y: 0 },
      type: isMirrordNode ? "mirrord" : "architecture",
    };
  });

/**
 * Transform the static architecture edges into React Flow edges with styling and handle placement.
 */
const buildFlowEdges = (): Edge[] =>
  architectureEdges.map((edge) => {
    const intent = edge.intent ?? "default";
    const style = intentStyles[intent];
    let edgeType: Edge["type"] = "bezier";
    let sourceHandle: string | undefined;
    let targetHandle: string | undefined;

    switch (edge.id) {
      case "layer-to-agent":
        sourceHandle = "layer-source-top";
        targetHandle = "operator-target-bottom";
        break;
      case "local-to-layer":
        targetHandle = "layer-target-left";
        break;
      case "agent-to-target":
        sourceHandle = "agent-source-right";
        break;
      case "operator-to-agent":
      case "operator-to-agent-mirrored":
        sourceHandle = "operator-source-right";
        targetHandle = "agent-target-left";
        break;
      default:
        break;
    }

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edgeType,
      sourceHandle,
      targetHandle,
      animated: Boolean(style.animated),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 24,
        height: 24,
      },
      markerStart: undefined,
      style: {
        stroke: style.color,
        strokeWidth: intent === "mirrored" ? 2.75 : 1.75,
        strokeDasharray: style.dash,
      },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: {
        fontSize: 12,
        fontWeight: 600,
        fill: "#0F172A",
      },
    };
  });

/**
 * Use dagre to compute an initial left-to-right layout for the architecture graph.
 */
const getLayoutedElements = (nodes: Node<NodeData>[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 120, ranksep: 240 });

  nodes.forEach((node) =>
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }),
  );
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));

  dagre.layout(dagreGraph);

  return {
    nodes: nodes.map((node) => {
      const { x, y } = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: x - nodeWidth / 2,
          y: y - nodeHeight / 2,
        },
      };
    }),
    edges,
  };
};

const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
  buildFlowNodes(),
  buildFlowEdges(),
);

/**
 * Convenience type used when rendering zone overlays (cluster/local backgrounds).
 */
type ZoneNodeData = {
  label: string;
  description: string;
  background: string;
  border: string;
  accent: string;
  zoneWidth: number;
  zoneHeight: number;
};

type ClusterZoneNode = Node<ZoneNodeData, "zone">;

type ServiceStatus = {
  id: string;
  name: string;
  description: string;
  lastUpdated: string;
  status?: string;
  availableReplicas?: number;
  message?: string;
};

type ClusterSnapshot = {
  clusterName: string;
  updatedAt: string;
  services: ServiceStatus[];
};

/**
 * Rich operator session from the MirrordClusterSession CRD.
 */
type OperatorSession = {
  sessionId: string;
  target: { kind: string; name: string; container?: string; apiVersion?: string };
  namespace: string;
  owner: { username: string; k8sUsername: string; hostname: string };
  branchName?: string;
  createdAt: string;
  connectedAt?: string;
  durationSeconds?: number;
};

/**
 * Kafka ephemeral topic from the MirrordKafkaEphemeralTopic CRD.
 */
type KafkaEphemeralTopic = {
  topicName: string;
  sessionId: string;
  clientConfig: string;
};

/**
 * Postgres branch database from the PgBranchDatabase CRD.
 */
type PgBranchDatabase = {
  name: string;
  namespace: string;
  branchId: string;
  targetDeployment: string;
  copyMode: string;
  postgresVersion: string;
  phase: string;
  expireTime?: string;
  owners: { username: string; hostname: string }[];
};

type OperatorStatusResponse = {
  sessions: OperatorSession[];
  sessionCount: number;
  kafkaTopics: KafkaEphemeralTopic[];
  pgBranches: PgBranchDatabase[];
  fetchedAt: string;
};

type AgentGroup = {
  targetName: string;
  owners: { username: string; hostname: string }[];
  sessions: OperatorSession[];
};

/**
 * Build non-interactive zone nodes that visually group parts of the architecture.
 */
const buildZoneNodes = (nodes: Node<NodeData>[]): ClusterZoneNode[] => {
  const defaultPadding = 80;
  const zoneNodes: ClusterZoneNode[] = [];

  architectureZones.forEach((zone) => {
    const padding = zone.id === "cluster" ? 48 : defaultPadding;
    const memberNodes = nodes.filter((node) => zone.nodes.includes(node.id));
    if (!memberNodes.length) {
      return;
    }

    const xs = memberNodes.map((node) => node.position.x);
    const ys = memberNodes.map((node) => node.position.y);
    const maxX = memberNodes.map((node) => node.position.x + nodeWidth);
    const maxY = memberNodes.map((node) => node.position.y + nodeHeight);

    const computedWidth = Math.max(...maxX) - Math.min(...xs) + padding * 2;
    const computedHeight = Math.max(...maxY) - Math.min(...ys) + padding * 2;

    zoneNodes.push({
      id: `zone-${zone.id}`,
      type: "zone",
      position: {
        x: Math.min(...xs) - padding,
        y: Math.min(...ys) - padding,
      },
      data: {
        label: zone.label,
        description: zone.description,
        background: zone.background,
        border: zone.border,
        accent: zone.accent,
        zoneWidth: computedWidth,
        zoneHeight: computedHeight,
      },
      style: {
        width: computedWidth,
        height: computedHeight,
        zIndex: 1,
        pointerEvents: "none",
      },
      draggable: false,
      selectable: false,
    });
  });

  return zoneNodes;
};

type ZoneId = ArchitectureNode["zone"] | "cluster";

const nodeZoneIndex = new Map<string, ZoneId>(
  architectureNodes.map((node) => [node.id, (node.zone ?? "cluster") as ZoneId]),
);

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Helper used to compute bounding boxes for groups of nodes (e.g. cluster/local zones).
 */
const computeBounds = (
  nodes: Node<NodeData>[],
  predicate: (node: Node<NodeData>) => boolean,
): Bounds | null => {
  const filtered = nodes.filter(predicate);
  if (filtered.length === 0) {
    return null;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  filtered.forEach((node) => {
    const x = node.position.x;
    const y = node.position.y;
    const right = x + nodeWidth;
    const bottom = y + nodeHeight;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, bottom);
  });
  return { minX, maxX, minY, maxY };
};

const LOCAL_ZONE_DEFAULT_OFFSET = { x: 520, y: 520 };
const LOCAL_ZONE_ADJUSTMENT = { x: -400, y: 0 };
const LOCAL_ZONE_GAP_Y = 220;

const EXTERNAL_USER_OFFSET_X = 240;
const INGRESS_LEFT_SHIFT_X = 90;
const EXTERNAL_USER_SHIFT_Y = 100;
const INGRESS_SHIFT_Y = 100;
const MIRRORD_OPERATOR_SHIFT_X = 180;
const MIRRORD_OPERATOR_SHIFT_Y = 100;
const MIRRORD_AGENT_SHIFT_X = 380;
const MIRRORD_AGENT_SHIFT_Y = 100;

/**
 * Apply per-node position shifts to non-local nodes first so that cluster bounds
 * reflect the actual rendered positions (e.g. mirrord-operator / agent shifts).
 */
const clusterAdjustedNodes = layoutedNodes.map((node) => {
  let position = { ...node.position };

  if (node.id === "user") {
    position = {
      ...position,
      x: position.x - EXTERNAL_USER_OFFSET_X,
      y: position.y + EXTERNAL_USER_SHIFT_Y,
    };
  }

  if (node.id === "ingress") {
    position = {
      ...position,
      x: position.x - INGRESS_LEFT_SHIFT_X,
      y: position.y + INGRESS_SHIFT_Y,
    };
  }

  if (node.id === "mirrord-operator") {
    position = {
      ...position,
      x: position.x + MIRRORD_OPERATOR_SHIFT_X,
      y: position.y + MIRRORD_OPERATOR_SHIFT_Y,
    };
  }

  if (node.id === "mirrord-agent") {
    position = {
      ...position,
      x: position.x + MIRRORD_AGENT_SHIFT_X,
      y: position.y + MIRRORD_AGENT_SHIFT_Y,
    };
  }

  return { ...node, position };
});

const clusterBounds = computeBounds(clusterAdjustedNodes, (node) => {
  const zone = nodeZoneIndex.get(node.id);
  return zone === "cluster";
});

const localBounds = computeBounds(layoutedNodes, (node) => {
  const zone = nodeZoneIndex.get(node.id);
  return zone === "local";
});

/**
 * Final offset applied to local nodes, taking into account cluster bounds and desired gaps.
 */
const LOCAL_ZONE_OFFSET = (() => {
  if (!clusterBounds || !localBounds) {
    return LOCAL_ZONE_DEFAULT_OFFSET;
  }
  const offsetX = clusterBounds.minX - localBounds.minX;
  const offsetY = clusterBounds.maxY + LOCAL_ZONE_GAP_Y - localBounds.minY;
  return {
    x: offsetX,
    y: offsetY + LOCAL_ZONE_ADJUSTMENT.y,
  };
})();

/**
 * Apply local-zone offsets now that we have correct bounds from the cluster-adjusted nodes.
 */
const adjustedNodes = clusterAdjustedNodes.map((node) => {
  const zone = nodeZoneIndex.get(node.id);
  if (zone === "local") {
    return {
      ...node,
      position: {
        x: node.position.x + LOCAL_ZONE_OFFSET.x,
        y: node.position.y + LOCAL_ZONE_OFFSET.y,
      },
    };
  }
  return node;
});

const SESSION_NODE_IDS = new Set([
  "mirrord-layer",
  "local-process",
  "mirrord-agent",
]);

const initialZoneNodes = buildZoneNodes(adjustedNodes);
const clusterZoneNode = initialZoneNodes.find((node) => node.id === "zone-cluster");
const localZoneNode = initialZoneNodes.find((node) => node.id === "zone-local");

const dynamicAgentBasePosition =
  adjustedNodes.find((n) => n.id === "mirrord-agent")?.position ?? { x: 0, y: 0 };
const DYNAMIC_AGENT_SPACING_Y = 220;

const localProcessBasePos =
  adjustedNodes.find((n) => n.id === "local-process")?.position ?? { x: 0, y: 0 };
const mirrordLayerBasePos =
  adjustedNodes.find((n) => n.id === "mirrord-layer")?.position ?? { x: 0, y: 0 };
const DYNAMIC_LOCAL_SPACING_X =
  mirrordLayerBasePos.x - localProcessBasePos.x + nodeWidth + 280;

const sanitizeHostname = (hostname: string) =>
  hostname.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

/**
 * Build an index of possible string aliases for each architecture node so snapshot targets can be
 * matched regardless of naming conventions (k8s resource vs repo path, etc.).
 */
const buildAliasIndex = () => {
  const aliasIndex = new Map<string, string>();
  architectureNodes.forEach((node) => {
    const aliases = new Set<string>();
    const lowerId = node.id.toLowerCase();
    aliases.add(lowerId);
    aliases.add(lowerId.replace(/_/g, "-"));
    aliases.add(lowerId.replace(/-/g, ""));
    if (node.repoPath) {
      const repo = node.repoPath.toLowerCase().replace(/\/$/, "");
      aliases.add(repo);
      aliases.add(repo.replace(/[\/]/g, ""));
    }
    if (typeof node.label === "string") {
      const label = node.label.toLowerCase();
      aliases.add(label);
      aliases.add(label.replace(/\s+/g, "-"));
      aliases.add(label.replace(/\s+/g, ""));
    }
    aliases.forEach((alias) => {
      if (alias) {
        aliasIndex.set(alias, node.id);
      }
    });
  });
  return aliasIndex;
};

// Only hide mirrord-agent (replaced by dynamic agents when sessions exist).
// Local-process and mirrord-layer are always visible as the "Local Machine" setup.
const initialArchitectureNodes: Node<NodeData>[] = adjustedNodes.map((node) =>
  node.id === "mirrord-agent" ? { ...node, hidden: true } : node,
);

const originalNodeStyles = new Map<string, Node<NodeData>["style"]>();
adjustedNodes.forEach((node) => {
  if (!originalNodeStyles.has(node.id)) {
    originalNodeStyles.set(node.id, node.style ? { ...node.style } : undefined);
  }
});

/**
 * Architecture node with explicit colored border and background by group (Entry, Core, Data, Queue, mirrord).
 */
const ArchitectureNode = ({ data }: NodeProps<Node<NodeData>>) => {
  const palette = groupPalette[data.group];
  const label = typeof data.label === "string" ? data.label : "";
  const isService = data.group === "service";
  return (
    <div
      className="flex h-full w-full flex-col justify-between text-left"
      style={{
        border: `2px solid ${palette.border}`,
        borderRadius: 18,
        backgroundColor: palette.background,
        color: palette.text,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        padding: isService ? 16 : 14,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Bottom} id="source-bottom" style={{ visibility: "hidden" }} />
      <Handle type="target" position={Position.Bottom} id="target-bottom" style={{ visibility: "hidden" }} />
      <div className="flex flex-col gap-1.5">
        <span
          className="font-bold leading-tight text-[#111827]"
          style={{ fontSize: isService ? 18 : 15 }}
        >
          {label}
        </span>
        {data.stack && (
          <span
            className="font-normal uppercase tracking-wider"
            style={{
              fontSize: isService ? 14 : 11,
              color: isService ? "#607D8B" : "#6B7280",
            }}
          >
            {data.stack}
          </span>
        )}
        {data.description && (
          <p
            className="font-normal leading-snug text-[#111827]"
            style={{ fontSize: isService ? 14 : 13 }}
          >
            {data.description}
          </p>
        )}
        {data.repoPath && (
          <span
            className="font-normal"
            style={{
              fontSize: isService ? 14 : 11,
              color: isService ? "#607D8B" : "#9CA3AF",
            }}
          >
            {data.repoPath}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Presentational node used for cluster/local zones. Rendered as a non-interactive background card.
 */
const ZoneNode = ({ data }: NodeProps<ClusterZoneNode>) => (
  <div
    className="flex flex-col justify-between rounded-[40px] border border-dashed px-8 py-6"
    style={{
      width: data.zoneWidth,
      height: data.zoneHeight,
      borderColor: data.border,
      background: data.background,
      color: "#0F172A",
      boxSizing: "border-box",
    }}
  >
    <div>
      <p
        className="text-xs font-bold uppercase tracking-[0.2em]"
        style={{ color: data.border }}
      >
        {data.label}
      </p>
      <p className="mt-1 text-[13px] text-[#374151]">{data.description}</p>
    </div>
    <span
      className="h-1 w-12 rounded-full"
      style={{ backgroundColor: data.accent }}
    />
  </div>
);

const handleStyle = { background: "#E66479", width: 8, height: 8 };

type MirrordNodeType = Node<NodeData, "mirrord">;

/**
 * Custom renderer for mirrord-specific nodes (layer, agent, operator, dynamic agents, kafka topics).
 */
const MirrordNode = ({ id, data }: NodeProps<MirrordNodeType>) => {
  const info = architectureNodes.find((node) => node.id === id);
  const palette = groupPalette.mirrord;
  const isLayer = id === "mirrord-layer";
  const isStaticAgent = id === "mirrord-agent";
  const isDynamicAgent = id.startsWith("agent-");
  const isDynamicKafkaTopic = id.startsWith("kafka-topic-") || id.startsWith("kafka-deployed-topic-");
  const isDynamicLocal = id.startsWith("dynamic-local-");
  const isDynamicLayer = id.startsWith("dynamic-layer-");
  const isDynamicPgBranch = id.startsWith("pg-branch-");
  const useHighlightBorder = data.highlight || isDynamicAgent || isDynamicKafkaTopic || isDynamicLocal || isDynamicLayer || isDynamicPgBranch;
  const isOperator = id === "mirrord-operator";
  const borderColor = isOperator ? "#16A34A" : isDynamicKafkaTopic ? "#7C3AED" : isDynamicPgBranch ? "#DC2626" : useHighlightBorder ? "#E66479" : palette.border;
  const borderWidth = useHighlightBorder ? 3 : 2;
  const label = info?.label ?? id;
  const stack = info?.stack;
  const description = info?.description;

  return (
    <div
      className="flex h-full w-full flex-col justify-between whitespace-normal rounded-[18px] border border-solid px-4 py-4 text-left shadow-md"
      style={{
        border: `${borderWidth}px solid ${borderColor}`,
        background: palette.background,
        color: palette.text,
      }}
    >
      {isLayer && (
        <>
          <Handle type="target" position={Position.Left} id="layer-target-left" style={handleStyle} />
          <Handle type="target" position={Position.Top} id="layer-target-top" style={handleStyle} />
          <Handle type="source" position={Position.Top} id="layer-source-top" style={handleStyle} />
          <Handle type="source" position={Position.Right} id="layer-source-right" style={handleStyle} />
        </>
      )}
      {isStaticAgent && (
        <>
          <Handle type="target" position={Position.Left} id="agent-target-left" style={handleStyle} />
          <Handle type="target" position={Position.Bottom} id="agent-target-bottom" style={handleStyle} />
          <Handle type="source" position={Position.Right} id="agent-source-right" style={handleStyle} />
        </>
      )}
      {id === "mirrord-operator" && (
        <>
          <Handle type="target" position={Position.Left} id="operator-target-left" style={handleStyle} />
          <Handle type="target" position={Position.Top} id="operator-target-top" style={handleStyle} />
          <Handle type="target" position={Position.Bottom} id="operator-target-bottom" style={handleStyle} />
          <Handle type="source" position={Position.Right} id="operator-source-right" style={handleStyle} />
          <Handle type="source" position={Position.Bottom} id="operator-source-bottom" style={handleStyle} />
        </>
      )}
      {isDynamicAgent && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {isDynamicKafkaTopic && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="target" position={Position.Right} id={`${id}-target-right`} style={handleStyle} />
          <Handle type="target" position={Position.Top} id={`${id}-target-top`} style={handleStyle} />
          <Handle type="source" position={Position.Left} id={`${id}-source-left`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
          <Handle type="source" position={Position.Top} id={`${id}-source-top`} style={handleStyle} />
          <Handle type="source" position={Position.Bottom} id={`${id}-source-bottom`} style={handleStyle} />
        </>
      )}
      {isDynamicLayer && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="target" position={Position.Top} id={`${id}-target-top`} style={handleStyle} />
          <Handle type="source" position={Position.Top} id={`${id}-source-top`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {isDynamicLocal && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {isDynamicPgBranch && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {(isDynamicAgent || isDynamicKafkaTopic || isDynamicLocal || isDynamicLayer || isDynamicPgBranch) ? (
        data.label
      ) : (
        <div className="flex flex-col gap-0.5 text-left">
          <span className="font-bold text-[15px] leading-tight text-[#111827]">
            {label}
          </span>
          {stack && (
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280]">
              {stack}
            </span>
          )}
          {description && (
            <p className="text-[13px] leading-snug text-[#374151]">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// Legend entries rendered in the top-left panel.
const legendItems = [
  { label: "Entry / Client", color: groupPalette.entry.border },
  { label: "Infrastructure", color: groupPalette.infra.border },
  { label: "Core services", color: groupPalette.service.border },
  { label: "Data stores", color: groupPalette.data.border },
  { label: "Queues & Streams", color: groupPalette.queue.border },
  { label: "mirrord control plane", color: groupPalette.mirrord.border },
];

const SHOW_SNAPSHOT_PANEL = false;

/**
 * Main visualization page. Builds the React Flow graph, keeps snapshot state in sync with the backend,
 * and wires up UI panels for the demo.
 */
export default function Home() {
  const nodeTypes = useMemo(
    () => ({ zone: ZoneNode, architecture: ArchitectureNode, mirrord: MirrordNode }),
    [],
  );
  const [architectureNodesState, setArchitectureNodesState] = useState<
    Node<NodeData>[]
  >(() => initialArchitectureNodes);
  const isMountedRef = useRef(true);
  const visibleArchitectureNodes = useMemo(
    () => architectureNodesState.filter((node) => !node.hidden),
    [architectureNodesState],
  );
  const baseEdges = useMemo(() => layoutedEdges, []);
  const [snapshot, setSnapshot] = useState<ClusterSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [operatorSessions, setOperatorSessions] = useState<OperatorSession[]>([]);
  const [kafkaTopics, setKafkaTopics] = useState<KafkaEphemeralTopic[]>([]);
  const [pgBranches, setPgBranches] = useState<PgBranchDatabase[]>([]);
  const aliasIndex = useMemo(() => buildAliasIndex(), []);
  const [dynamicNodePositions, setDynamicNodePositions] = useState<
    Map<string, { x: number; y: number }>
  >(() => new Map());

  // Group operator sessions by target.name, filtering to namespace "shop".
  // Multiple owners targeting the same service share one agent node.
  const agentGroups = useMemo((): AgentGroup[] => {
    const shopSessions = operatorSessions.filter(
      (s) => s.namespace === "shop",
    );
    const map = new Map<string, AgentGroup>();
    for (const session of shopSessions) {
      const key = session.target.name;
      if (!map.has(key)) {
        map.set(key, {
          targetName: key,
          owners: [],
          sessions: [],
        });
      }
      const group = map.get(key)!;
      group.sessions.push(session);
      if (!group.owners.some((o) => o.hostname === session.owner.hostname)) {
        group.owners.push({
          username: session.owner.username,
          hostname: session.owner.hostname,
        });
      }
    }
    return Array.from(map.values());
  }, [operatorSessions]);

  // Create one React Flow node per unique target (agent).
  const dynamicAgentNodes = useMemo((): Node<NodeData>[] => {
    const palette = groupPalette.mirrord;
    return agentGroups.map((group, index) => {
      const agentId = `agent-${sanitizeHostname(group.targetName)}`;
      return {
        id: agentId,
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">
                mirrord Agent
              </span>
              {group.owners.map((owner) => (
                <div key={owner.hostname} className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {owner.username}
                  </span>
                  <p className="text-xs leading-snug text-slate-600">
                    {owner.hostname}
                  </p>
                </div>
              ))}
            </div>
          ),
        },
        type: "mirrord",
        style: {
          borderRadius: 18,
          backgroundColor: "transparent",
          color: palette.text,
          boxShadow: "0px 30px 60px rgba(124,58,237,0.35)",
          width: nodeWidth,
          zIndex: 10,
        },
        position: dynamicNodePositions.get(agentId) ?? {
          x: dynamicAgentBasePosition.x,
          y: dynamicAgentBasePosition.y + index * DYNAMIC_AGENT_SPACING_Y,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      };
    });
  }, [agentGroups, dynamicNodePositions]);

  // Targets that have a kafka split topic acting as middleman (skip direct agent→target edge).
  // Note: delivery-service agent node comes from OperatorSession, not KafkaEphemeralTopic.
  const kafkaSplitTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const topic of kafkaTopics) {
      const session = operatorSessions.find((s) => s.sessionId === topic.sessionId);
      if (session && session.target.name !== "delivery-service") {
        targets.add(session.target.name);
      }
    }
    return targets;
  }, [kafkaTopics, operatorSessions]);

  // Build dynamic edges: operator -> agent and agent -> target per session.
  const dynamicEdges = useMemo((): Edge[] => {
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;
    for (const group of agentGroups) {
      const agentId = `agent-${sanitizeHostname(group.targetName)}`;

      // Operator -> Agent
      edges.push({
        id: `operator-to-${agentId}`,
        source: "mirrord-operator",
        target: agentId,
        label: "Launch agent",
        type: "smoothstep",
        sourceHandle: "operator-source-right",
        targetHandle: `${agentId}-target-left`,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 24,
          height: 24,
        },
        style: {
          stroke: mirroredStyle.color,
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 10,
        labelShowBg: true,
        labelBgStyle: { fill: "#FFFFFF" },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
      });

      // Agent -> Target (skip if a kafka split topic replaces this direct path)
      if (!kafkaSplitTargets.has(group.targetName)) {
        const sessionLabel = group.sessions
          .map((s) => s.sessionId.substring(0, 8))
          .join(", ");
        edges.push({
          id: `${agentId}-to-${group.targetName}`,
          source: agentId,
          target: group.targetName,
          label: sessionLabel,
          type: "bezier",
          sourceHandle: `${agentId}-source-right`,
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 24,
            height: 24,
          },
          style: {
            stroke: mirroredStyle.color,
            strokeWidth: 2.75,
            strokeDasharray: mirroredStyle.dash,
          },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 10,
          labelShowBg: true,
          labelBgStyle: { fill: "#FFFFFF" },
          labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        });
      }
    }

    return edges;
  }, [agentGroups, kafkaSplitTargets]);

  // Build dynamic Kafka topic nodes from operator status data.
  // When KafkaEphemeralTopics exist, we create:
  //   1. A node per KafkaEphemeralTopic named after its topicName
  //   2. A "Temporary Topic for Deployed App" node per target service
  const kafkaTopicNodes = useMemo((): Node<NodeData>[] => {
    if (kafkaTopics.length === 0) return [];
    const palette = groupPalette.mirrord;
    const nodes: Node<NodeData>[] = [];
    const sharedStyle = {
      borderRadius: 18,
      backgroundColor: "transparent",
      color: palette.text,
      boxShadow: "0px 30px 60px rgba(124,58,237,0.35)",
      width: nodeWidth,
      zIndex: 10,
    };

    // Per-KafkaEphemeralTopic nodes (named by topicName, one per session)
    kafkaTopics.forEach((topic, index) => {
      const nodeId = `kafka-topic-${topic.topicName}`;
      nodes.push({
        id: nodeId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">{topic.topicName}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                session: {topic.sessionId}
              </span>
            </div>
          ),
        },
        position: dynamicNodePositions.get(nodeId) ?? (() => {
          // Place at the bottom-left of the cluster zone, below all other cluster nodes.
          const clusterNodes = adjustedNodes.filter((n) => {
            const zone = nodeZoneIndex.get(n.id);
            return zone === "cluster" && !SESSION_NODE_IDS.has(n.id);
          });
          const maxY = Math.max(...clusterNodes.map((n) => n.position.y + nodeHeight));
          const minX = Math.min(...clusterNodes.map((n) => n.position.x));
          return { x: minX + index * (nodeWidth + 40), y: maxY + 220 };
        })(),
        style: sharedStyle,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      });
    });

    // 3. "Temporary Topic for Deployed App" node – positioned to the right of delivery-service
    const deployedNodeId = "kafka-deployed-topic-delivery";
    const deliveryPos = adjustedNodes.find((n) => n.id === "delivery-service")?.position ?? { x: 0, y: 0 };
    nodes.push({
      id: deployedNodeId,
      type: "mirrord",
      data: {
        group: "mirrord" as const,
        label: (
          <div className="flex flex-col gap-1 text-left">
            <span className="text-sm font-semibold text-slate-900">
              Temporary Queue for Deployed Application 
            </span>
          </div>
        ),
      },
      position: dynamicNodePositions.get(deployedNodeId) ?? {
        x: deliveryPos.x + nodeWidth - 300,
        y: deliveryPos.y + 500,
      },
      style: sharedStyle,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      connectable: false,
      draggable: true,
      selectable: true,
    });

    return nodes;
  }, [kafkaTopics, operatorSessions, dynamicNodePositions]);

  // Build dynamic edges for Kafka topic nodes.
  // Edges created:
  //   - Kafka producer → Operator (arrow from bottom of kafka to top of operator)
  //   - Operator → each session topic node ("send messages matching filter")
  //   - Operator → Temporary Topic for Deployed App ("send messages not matching any filter")
  //   - Temporary Topic for Deployed App → target service ("consume messages")
  const kafkaTopicEdges = useMemo((): Edge[] => {
    if (kafkaTopics.length === 0) return [];
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;

    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };

    // Kafka producer → Operator (arrow from bottom of kafka to top of operator)
    edges.push({
      id: "kafka-to-operator",
      source: "kafka",
      target: "mirrord-operator",
      label: "consume messages",
      type: "bezier",
      sourceHandle: "source-bottom",
      targetHandle: "operator-target-top",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      style: {
        stroke: mirroredStyle.color,
        strokeWidth: 2.75,
        strokeDasharray: mirroredStyle.dash,
      },
      ...edgeLabelDefaults,
    });

    // Operator → each session topic node (per KafkaEphemeralTopic)
    for (const topic of kafkaTopics) {
      const nodeId = `kafka-topic-${topic.topicName}`;
      edges.push({
        id: `operator-to-${nodeId}`,
        source: "mirrord-operator",
        target: nodeId,
        label: "matching filter",
        type: "bezier",
        sourceHandle: "operator-source-bottom",
        targetHandle: `${nodeId}-target-top`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: {
          stroke: mirroredStyle.color,
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        ...edgeLabelDefaults,
      });
    }

    // KafkaEphemeralTopic → mirrord-layer (arrow from bottom of topic to layer)
    // When multiple topics exist, each points to its own dynamic layer.
    kafkaTopics.forEach((topic, index) => {
      const nodeId = `kafka-topic-${topic.topicName}`;
      const usesDynamicLocal = kafkaTopics.length > 1;
      const targetLayer = usesDynamicLocal ? `dynamic-layer-${index}` : "mirrord-layer";
      const targetHandle = usesDynamicLocal ? `dynamic-layer-${index}-target-top` : "layer-target-top";
      edges.push({
        id: `${nodeId}-to-layer`,
        source: nodeId,
        target: targetLayer,
        label: "consume messages",
        type: "bezier",
        sourceHandle: `${nodeId}-source-bottom`,
        targetHandle,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: {
          stroke: mirroredStyle.color,
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        ...edgeLabelDefaults,
      });
    });

    // Operator → Temporary Topic for Deployed App
    edges.push({
      id: "operator-to-kafka-deployed-topic-delivery",
      source: "mirrord-operator",
      target: "kafka-deployed-topic-delivery",
      label: "send messages not matching any filter",
      type: "bezier",
      sourceHandle: "operator-source-bottom",
      targetHandle: "kafka-deployed-topic-delivery-target-left",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      style: {
        stroke: mirroredStyle.color,
        strokeWidth: 2.75,
        strokeDasharray: mirroredStyle.dash,
      },
      ...edgeLabelDefaults,
    });

    // Temporary Topic for Deployed App → delivery-service (right to left)
    edges.push({
      id: "kafka-deployed-topic-delivery-to-delivery",
      source: "kafka-deployed-topic-delivery",
      target: "delivery-service",
      label: "consume messages",
      type: "bezier",
      sourceHandle: "kafka-deployed-topic-delivery-source-top",
      targetHandle: "target-bottom",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      style: {
        stroke: mirroredStyle.color,
        strokeWidth: 2.75,
        strokeDasharray: mirroredStyle.dash,
      },
      ...edgeLabelDefaults,
    });

    return edges;
  }, [kafkaTopics, operatorSessions, aliasIndex]);

  const hasOperatorSessions = operatorSessions.length > 0;

  // Build a set of static edges to hide when a kafka split topic replaces the direct path.
  // e.g. if a split topic sits between "kafka" and "delivery-service", hide "kafka-to-delivery".
  const kafkaReplacedEdges = useMemo(() => {
    const replaced = new Set<string>();
    for (const topic of kafkaTopics) {
      const session = operatorSessions.find((s) => s.sessionId === topic.sessionId);
      const targetName = session?.target.name;
      const targetArchNodeId = targetName ? aliasIndex.get(targetName.toLowerCase()) : undefined;
      if (targetArchNodeId) {
        // Find any static edge going from "kafka" to the target service and suppress it.
        for (const edge of baseEdges) {
          if (edge.source === "kafka" && edge.target === targetArchNodeId) {
            replaced.add(edge.id);
          }
        }
      }
    }
    return replaced;
  }, [kafkaTopics, operatorSessions, aliasIndex, baseEdges]);

  // When there are multiple kafka topics, create per-topic local machine nodes
  // (each with its own local-process and mirrord-layer).
  const hasMultipleKafkaTopics = kafkaTopics.length > 1;

  const dynamicLocalMachineNodes = useMemo((): Node<NodeData>[] => {
    if (!hasMultipleKafkaTopics) return [];
    const palette = groupPalette.mirrord;
    const nodes: Node<NodeData>[] = [];
    const sharedStyle = {
      borderRadius: 18,
      backgroundColor: "transparent",
      color: palette.text,
      boxShadow: "0px 30px 60px rgba(124,58,237,0.35)",
      width: nodeWidth,
      zIndex: 10,
    };

    kafkaTopics.forEach((topic, index) => {
      const session = operatorSessions.find((s) => s.sessionId === topic.sessionId);
      const ownerName = session?.owner.username ?? "Unknown";
      const hostname = session?.owner.hostname ?? "";
      const localId = `dynamic-local-${index}`;
      const layerId = `dynamic-layer-${index}`;

      nodes.push({
        id: localId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">Local process</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Developer machine
              </span>
              <p className="text-xs leading-snug text-slate-600">
                {ownerName} ({hostname})
              </p>
            </div>
          ),
        },
        position: dynamicNodePositions.get(localId) ?? {
          x: localProcessBasePos.x + index * DYNAMIC_LOCAL_SPACING_X,
          y: localProcessBasePos.y,
        },
        style: sharedStyle,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      });

      nodes.push({
        id: layerId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">mirrord-layer</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                LD_PRELOAD
              </span>
              <p className="text-xs leading-snug text-slate-600">
                Intercepts libc calls.
              </p>
            </div>
          ),
        },
        position: dynamicNodePositions.get(layerId) ?? {
          x: mirrordLayerBasePos.x + index * DYNAMIC_LOCAL_SPACING_X,
          y: mirrordLayerBasePos.y,
        },
        style: sharedStyle,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      });
    });

    return nodes;
  }, [kafkaTopics, operatorSessions, hasMultipleKafkaTopics, dynamicNodePositions]);

  // Edges for dynamic local machines: local→layer (LD_PRELOAD) and layer→operator.
  const dynamicLocalEdges = useMemo((): Edge[] => {
    if (!hasMultipleKafkaTopics) return [];
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };

    kafkaTopics.forEach((_, index) => {
      const localId = `dynamic-local-${index}`;
      const layerId = `dynamic-layer-${index}`;

      // local-process → mirrord-layer (LD_PRELOAD hook)
      edges.push({
        id: `${localId}-to-${layerId}`,
        source: localId,
        target: layerId,
        label: "LD_PRELOAD hook",
        type: "bezier",
        sourceHandle: `${localId}-source-right`,
        targetHandle: `${layerId}-target-left`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: {
          stroke: mirroredStyle.color,
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        ...edgeLabelDefaults,
      });

      // mirrord-layer → operator
      edges.push({
        id: `${layerId}-to-operator`,
        source: layerId,
        target: "mirrord-operator",
        type: "bezier",
        sourceHandle: `${layerId}-source-top`,
        targetHandle: "operator-target-bottom",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: {
          stroke: mirroredStyle.color,
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        ...edgeLabelDefaults,
      });
    });

    return edges;
  }, [kafkaTopics, hasMultipleKafkaTopics]);

  // Zone overlays for each dynamic local machine pair.
  const dynamicLocalZoneNodes = useMemo((): ClusterZoneNode[] => {
    if (!hasMultipleKafkaTopics) return [];
    const zones: ClusterZoneNode[] = [];
    const padding = 80;

    kafkaTopics.forEach((topic, index) => {
      const localId = `dynamic-local-${index}`;
      const layerId = `dynamic-layer-${index}`;
      const localNode = dynamicLocalMachineNodes.find((n) => n.id === localId);
      const layerNode = dynamicLocalMachineNodes.find((n) => n.id === layerId);
      if (!localNode || !layerNode) return;

      const session = operatorSessions.find((s) => s.sessionId === topic.sessionId);
      const ownerName = session?.owner.username ?? "Unknown";

      const minX = Math.min(localNode.position.x, layerNode.position.x);
      const minY = Math.min(localNode.position.y, layerNode.position.y);
      const maxX = Math.max(localNode.position.x + nodeWidth, layerNode.position.x + nodeWidth);
      const maxY = Math.max(localNode.position.y + nodeHeight, layerNode.position.y + nodeHeight);
      const zoneWidth = maxX - minX + padding * 2;
      const zoneHeight = maxY - minY + padding * 2;

      zones.push({
        id: `zone-dynamic-local-${index}`,
        type: "zone",
        position: {
          x: minX - padding,
          y: minY - padding,
        },
        data: {
          label: `Local Machine – ${ownerName}`,
          description: "Developer laptop running the binary with mirrord-layer inserted.",
          background: "rgba(191, 219, 254, 0.4)",
          border: "#60A5FA",
          accent: "#3B82F6",
          zoneWidth,
          zoneHeight,
        },
        style: {
          width: zoneWidth,
          height: zoneHeight,
          zIndex: 1,
          pointerEvents: "none",
        },
        draggable: false,
        selectable: false,
      });
    });

    return zones;
  }, [kafkaTopics, operatorSessions, dynamicLocalMachineNodes, hasMultipleKafkaTopics]);

  // Build dynamic nodes for PgBranchDatabase resources.
  // Each branch is positioned to the right of its target deployment's postgres data node.
  const pgBranchNodes = useMemo((): Node<NodeData>[] => {
    if (pgBranches.length === 0) return [];
    const palette = groupPalette.mirrord;
    const sharedStyle = {
      borderRadius: 18,
      backgroundColor: "transparent",
      color: palette.text,
      boxShadow: "0px 30px 60px rgba(220,38,38,0.25)",
      width: nodeWidth,
      zIndex: 10,
    };

    return pgBranches.map((branch, index) => {
      const nodeId = `pg-branch-${sanitizeHostname(branch.name)}`;
      // Position near the target deployment's postgres node
      const postgresNodeId = `postgres-orders`;
      const postgresPos = adjustedNodes.find((n) => n.id === postgresNodeId)?.position ?? { x: 0, y: 0 };

      return {
        id: nodeId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">
                DB Branch: {branch.branchId}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {branch.targetDeployment} / PG {branch.postgresVersion}
              </span>
              <p className="text-xs leading-snug text-slate-600">
                Copy mode: {branch.copyMode} | Phase: {branch.phase}
              </p>
              {branch.owners.map((owner) => (
                <p key={owner.hostname} className="text-[11px] text-slate-500">
                  {owner.username} ({owner.hostname})
                </p>
              ))}
            </div>
          ),
        },
        position: dynamicNodePositions.get(nodeId) ?? {
          x: postgresPos.x - nodeWidth - 60,
          y: postgresPos.y + index * (nodeHeight + 40),
        },
        style: sharedStyle,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      };
    });
  }, [pgBranches, dynamicNodePositions]);

  // Build dynamic edges for PgBranchDatabase nodes.
  // Each branch connects from its target postgres node.
  const pgBranchEdges = useMemo((): Edge[] => {
    if (pgBranches.length === 0) return [];
    const mirroredStyle = intentStyles.mirrored;
    const edges: Edge[] = [];
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };
    const edgeStyle = {
      stroke: mirroredStyle.color,
      strokeWidth: 2.75,
      strokeDasharray: mirroredStyle.dash,
    };

    for (const branch of pgBranches) {
      const nodeId = `pg-branch-${sanitizeHostname(branch.name)}`;
      const postgresNodeId = `postgres-orders`;
      const agentId = `agent-${sanitizeHostname(branch.targetDeployment)}`;

      // PgBranch → Postgres
      edges.push({
        id: `${nodeId}-to-${postgresNodeId}`,
        source: nodeId,
        target: postgresNodeId,
        label: "branch copy",
        type: "bezier",
        sourceHandle: `${nodeId}-source-right`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: edgeStyle,
        ...edgeLabelDefaults,
      });

      // Agent → PgBranch
      edges.push({
        id: `${agentId}-to-${nodeId}`,
        source: agentId,
        target: nodeId,
        label: "use branch DB",
        type: "bezier",
        sourceHandle: `${agentId}-source-right`,
        targetHandle: `${nodeId}-target-left`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: edgeStyle,
        ...edgeLabelDefaults,
      });
    }

    return edges;
  }, [pgBranches]);

  // Combine static edges with dynamic agent edges and kafka edges.
  // When multiple kafka topics exist, static local-to-layer and layer-to-agent are replaced
  // by per-topic dynamic local edges.
  const flowEdges = useMemo(() => {
    const staticEdges = baseEdges.filter((edge) => {
      if (kafkaReplacedEdges.has(edge.id)) return false;
      // Hide static local edges when dynamic local machines replace them
      if (hasMultipleKafkaTopics && (edge.id === "local-to-layer" || edge.id === "layer-to-agent")) return false;
      if (edge.id === "local-to-layer") return true;
      if (edge.id === "layer-to-agent") return hasOperatorSessions;
      if (
        SESSION_NODE_IDS.has(edge.source) ||
        SESSION_NODE_IDS.has(edge.target)
      ) {
        return false;
      }
      return true;
    });
    return [...staticEdges, ...dynamicEdges, ...kafkaTopicEdges, ...dynamicLocalEdges, ...pgBranchEdges];
  }, [baseEdges, dynamicEdges, kafkaTopicEdges, dynamicLocalEdges, pgBranchEdges, hasOperatorSessions, kafkaReplacedEdges, hasMultipleKafkaTopics]);

  // Recompute the cluster zone overlay to encompass dynamic agent nodes.
  const dynamicClusterZoneNode = useMemo(() => {
    if (!clusterZoneNode) return null;
    if (dynamicAgentNodes.length === 0 && kafkaTopicNodes.length === 0 && pgBranchNodes.length === 0) return clusterZoneNode;

    const clusterStaticNodes = adjustedNodes.filter((n) => {
      const zone = nodeZoneIndex.get(n.id);
      return zone === "cluster" && !SESSION_NODE_IDS.has(n.id);
    });
    const allClusterNodes = [...clusterStaticNodes, ...dynamicAgentNodes, ...kafkaTopicNodes, ...pgBranchNodes];
    const padding = 48;
    const xs = allClusterNodes.map((n) => n.position.x);
    const ys = allClusterNodes.map((n) => n.position.y);
    const maxXs = allClusterNodes.map((n) => n.position.x + nodeWidth);
    const maxYs = allClusterNodes.map((n) => n.position.y + nodeHeight);

    const newWidth = Math.max(...maxXs) - Math.min(...xs) + padding * 2;
    const newHeight = Math.max(...maxYs) - Math.min(...ys) + padding * 2;
    return {
      ...clusterZoneNode,
      position: {
        x: Math.min(...xs) - padding,
        y: Math.min(...ys) - padding,
      },
      data: {
        ...clusterZoneNode.data,
        zoneWidth: newWidth,
        zoneHeight: newHeight,
      },
      style: {
        ...clusterZoneNode.style,
        width: newWidth,
        height: newHeight,
      },
    };
  }, [dynamicAgentNodes, kafkaTopicNodes, pgBranchNodes]);

  // Compute how much the dynamic cluster zone grew compared to the static one,
  // then shift local nodes/zone down by the same amount to maintain the gap.
  const localYShift = useMemo(() => {
    if (!dynamicClusterZoneNode || !clusterZoneNode) return 0;
    const staticBottom =
      clusterZoneNode.position.y + (clusterZoneNode.data as ZoneNodeData).zoneHeight;
    const dynamicBottom =
      dynamicClusterZoneNode.position.y +
      (dynamicClusterZoneNode.data as ZoneNodeData).zoneHeight;
    return Math.max(0, dynamicBottom - staticBottom);
  }, [dynamicClusterZoneNode]);

  // Merge zone overlays, static architecture nodes, dynamic agent nodes, and kafka topic nodes.
  // When multiple kafka topics exist, replace the static local zone with per-topic dynamic local zones.
  const flowNodes = useMemo(() => {
    const nodes: Node<NodeData | ZoneNodeData>[] = [];
    if (dynamicClusterZoneNode) {
      nodes.push(dynamicClusterZoneNode);
    }
    if (hasMultipleKafkaTopics) {
      // Use dynamic local zone overlays instead of the static one
      const shiftedDynamicLocalZones = dynamicLocalZoneNodes.map((zone) => ({
        ...zone,
        position: {
          ...zone.position,
          y: zone.position.y + localYShift,
        },
      }));
      nodes.push(...shiftedDynamicLocalZones);
    } else if (localZoneNode) {
      const shifted = {
        ...localZoneNode,
        position: {
          ...localZoneNode.position,
          y: localZoneNode.position.y + localYShift,
        },
      };
      nodes.push(shifted);
    }
    // Shift local architecture nodes down by the same amount
    // When multiple kafka topics exist, hide static local nodes (replaced by dynamic ones)
    const shiftedArchNodes = visibleArchitectureNodes
      .filter((node) => {
        if (hasMultipleKafkaTopics && (node.id === "local-process" || node.id === "mirrord-layer")) {
          return false;
        }
        return true;
      })
      .map((node) => {
        const zone = nodeZoneIndex.get(node.id);
        if (zone === "local" && localYShift > 0) {
          return {
            ...node,
            position: { ...node.position, y: node.position.y + localYShift },
          };
        }
        return node;
      });
    nodes.push(...shiftedArchNodes);
    nodes.push(...dynamicAgentNodes);
    nodes.push(...kafkaTopicNodes);
    nodes.push(...pgBranchNodes);
    // Add dynamic local machine nodes with localYShift applied
    if (hasMultipleKafkaTopics) {
      const shiftedDynamicLocalNodes = dynamicLocalMachineNodes.map((node) => ({
        ...node,
        position: {
          ...node.position,
          y: node.position.y + localYShift,
        },
      }));
      nodes.push(...shiftedDynamicLocalNodes);
    }
    return nodes;
  }, [visibleArchitectureNodes, dynamicAgentNodes, dynamicClusterZoneNode, localYShift, kafkaTopicNodes, pgBranchNodes, hasMultipleKafkaTopics, dynamicLocalMachineNodes, dynamicLocalZoneNodes]);

  const snapshotBaseUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ?? "http://localhost:8080";
    return base.replace(/\/$/, "");
  }, []);

  const [useQueueSplittingMock, setUseQueueSplittingMock] = useState(false);
  const [useDbBranchMock, setUseDbBranchMock] = useState(false);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    fetch(`${basePath}/api/mock-config`)
      .then((res) => res.json())
      .then((data: { queueSplittingMock: boolean; dbBranchMock: boolean }) => {
        setUseQueueSplittingMock(data.queueSplittingMock);
        setUseDbBranchMock(data.dbBranchMock);
      })
      .catch((err) => console.warn("Failed to fetch mock config:", err));
  }, []);

  const mockQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (useQueueSplittingMock) params.set("queueSplittingMock", "true");
    if (useDbBranchMock) params.set("dbBranchMock", "true");
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [useQueueSplittingMock, useDbBranchMock]);

  const snapshotUrl = useMemo(
    () => `${snapshotBaseUrl}/snapshot`,
    [snapshotBaseUrl],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch the latest backend snapshot; supports optional spinner and forced refresh.
  const fetchSnapshot = useCallback(
    async (options?: { showSpinner?: boolean; forceRefresh?: boolean }) => {
      const shouldShowSpinner = options?.showSpinner ?? false;
      if (shouldShowSpinner) {
        setSnapshotLoading(true);
      }
      try {
        const targetUrl = options?.forceRefresh
          ? `${snapshotUrl}?refresh=1`
          : snapshotUrl;
        const response = await fetch(targetUrl, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Snapshot request failed (${response.status})`);
        }
        const body = (await response.json()) as Partial<ClusterSnapshot>;
        if (!isMountedRef.current) {
          return;
        }
        const normalizedSnapshot: ClusterSnapshot = {
          clusterName: body.clusterName ?? "unknown-cluster",
          updatedAt: body.updatedAt ?? new Date().toISOString(),
          services: body.services ?? [],
        };
        setSnapshot(normalizedSnapshot);
        setSnapshotError(null);
        setSnapshotLoading(false);
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        setSnapshotError((error as Error).message);
        setSnapshotLoading(false);
      }
    },
    [snapshotUrl],
  );

  // Periodically refresh the snapshot (in addition to manual refresh requests).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await fetchSnapshot();
      }
    };

    run();
    const interval = setInterval(() => {
      void fetchSnapshot();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchSnapshot]);

  // Fetch operator status (sessions + kafka topics) from the backend when not using mock data.
  const operatorStatusUrl = useMemo(
    () => `${snapshotBaseUrl}/operator-status`,
    [snapshotBaseUrl],
  );

  const fetchOperatorStatus = useCallback(async () => {
    try {
      const fullOperatorUrl = mockQueryString ? `${operatorStatusUrl}${mockQueryString}` : operatorStatusUrl;
      const response = await fetch(fullOperatorUrl, { cache: "no-store" });
      if (!response.ok) {
        console.warn(`Operator status request failed (${response.status})`);
        return;
      }
      const body = (await response.json()) as Partial<OperatorStatusResponse>;
      if (isMountedRef.current) {
        setOperatorSessions(body.sessions ?? []);
        setKafkaTopics(body.kafkaTopics ?? []);
        setPgBranches(body.pgBranches ?? []);
      }
    } catch (error) {
      console.warn("Failed to fetch operator status:", (error as Error).message);
    }
  }, [operatorStatusUrl, mockQueryString]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await fetchOperatorStatus();
      }
    };
    run();
    const interval = setInterval(() => {
      void fetchOperatorStatus();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchOperatorStatus]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Capture position changes for dynamic nodes (agents + kafka topics).
      const dynamicPositionUpdates: { id: string; x: number; y: number }[] = [];
      const archChanges: NodeChange[] = [];

      for (const change of changes) {
        if ("id" in change && change.id.startsWith("zone-")) continue;
        const isDynamic =
          "id" in change &&
          (change.id.startsWith("agent-") || change.id.startsWith("kafka-topic-") || change.id.startsWith("kafka-deployed-topic-") || change.id.startsWith("dynamic-local-") || change.id.startsWith("dynamic-layer-") || change.id.startsWith("pg-branch-"));
        if (
          isDynamic &&
          change.type === "position" &&
          change.position
        ) {
          dynamicPositionUpdates.push({
            id: change.id,
            x: change.position.x,
            y: change.position.y,
          });
        } else if (!isDynamic) {
          archChanges.push(change);
        }
      }

      if (dynamicPositionUpdates.length > 0) {
        setDynamicNodePositions((prev) => {
          const next = new Map(prev);
          for (const update of dynamicPositionUpdates) {
            next.set(update.id, { x: update.x, y: update.y });
          }
          return next;
        });
      }

      if (archChanges.length > 0) {
        setArchitectureNodesState((nodes) =>
          applyNodeChanges<Node<NodeData>>(
            archChanges as NodeChange<Node<NodeData>>[],
            nodes,
          ),
        );
      }
    },
    [],
  );

  // Bound to the Refresh button so operators can trigger an immediate backend poll.
  const handleSnapshotRefresh = useCallback(() => {
    void fetchSnapshot({ showSpinner: true, forceRefresh: true });
  }, [fetchSnapshot]);

  // On mount: hide only mirrord-agent (replaced by dynamic agents when sessions exist).
  // Local-process and mirrord-layer stay visible as the Local Machine setup.
  useEffect(() => {
    setArchitectureNodesState((nodes) =>
      nodes.map((node) => {
        const baseStyle = { ...(originalNodeStyles.get(node.id) ?? {}) };
        if (node.id === "mirrord-agent") {
          return { ...node, hidden: true, style: baseStyle };
        }
        return {
          ...node,
          hidden: false,
          style: { ...baseStyle, opacity: 1 },
        };
      }),
    );
  }, []);

  // When operator sessions are active, add highlight (glow) to local-process and mirrord-layer.
  useEffect(() => {
    setArchitectureNodesState((nodes) =>
      nodes.map((node) => {
        if (node.id === "local-process" || node.id === "mirrord-layer") {
          const baseStyle = { ...(originalNodeStyles.get(node.id) ?? {}) };
          const styleWithGlow = hasOperatorSessions
            ? {
                ...baseStyle,
                opacity: 1,
                boxShadow: "0px 30px 60px rgba(124,58,237,0.35)",
              }
            : { ...baseStyle, opacity: 1 };
          const dataWithHighlight = hasOperatorSessions
            ? { ...node.data, highlight: true as const }
            : { ...node.data, highlight: undefined };
          return {
            ...node,
            hidden: false,
            style: styleWithGlow,
            data: dataWithHighlight,
          };
        }
        return node;
      }),
    );
  }, [hasOperatorSessions]);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#F5F5F5", color: "#111827" }}>
      <ReactFlow
        style={{ width: "100%", height: "100%" }}
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        elevateEdgesOnSelect={false}
        panOnScroll
        className="bg-transparent"
        proOptions={{ hideAttribution: true }}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        defaultMarkerColor="#374151"
      >
        <Background color="#E9E4FF" gap={24} size={2} />
        <Controls
          position="bottom-right"
          showInteractive={false}
          showZoom
          showFitView
          className="border border-[#E5E7EB] bg-white/90 text-[#4F46E5] shadow-lg"
        />
        <Panel position="top-left" className="rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-lg">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
            Legend
          </p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Panel>
        {!SHOW_SNAPSHOT_PANEL && (
          <Panel position="bottom-left" className="rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 text-sm text-[#111827] shadow-xl">
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4F46E5]">
                Live snapshot
              </p>
              <button
                type="button"
                onClick={handleSnapshotRefresh}
                disabled={snapshotLoading}
                className="rounded-md border border-[#4F46E5] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#4F46E5] transition-colors hover:bg-[#4F46E5] hover:text-white disabled:cursor-not-allowed disabled:border-[#A5B4FC] disabled:text-[#A5B4FC]"
              >
                {snapshotLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {snapshotError && (
              <p className="mt-2 text-xs text-red-500">Last error: {snapshotError}</p>
            )}
          </Panel>
        )}
        {SHOW_SNAPSHOT_PANEL && (
          <Panel position="bottom-left" className="rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 text-sm text-[#111827] shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4F46E5]">
                Live snapshot
              </p>
              <button
                type="button"
                onClick={handleSnapshotRefresh}
                disabled={snapshotLoading}
                className="rounded-md border border-[#4F46E5] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#4F46E5] transition-colors hover:bg-[#4F46E5] hover:text-white disabled:cursor-not-allowed disabled:border-[#A5B4FC] disabled:text-[#A5B4FC]"
              >
                {snapshotLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {snapshotLoading && <p className="mt-2 text-xs text-[#6B7280]">Contacting backend…</p>}
            {snapshotError && (
              <p className="mt-2 text-xs text-red-500">
                Failed to fetch snapshot: {snapshotError}
              </p>
            )}
            {snapshot && !snapshotError && (
              <div className="mt-2 space-y-1">
                <p className="text-base font-semibold">{snapshot.clusterName}</p>
                <p className="text-xs text-[#6B7280]">
                  Updated {new Date(snapshot.updatedAt).toLocaleTimeString()}
                </p>
                <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-2">
                  {snapshot.services.length === 0 && (
                    <p className="text-xs text-[#94A3B8]">No active services reported yet.</p>
                  )}
                  {snapshot.services.map((service) => (
                    <div key={service.id} className="mb-2 last:mb-0">
                      <p className="text-xs font-semibold text-[#111827]">{service.name}</p>
                      <p className="text-[11px] text-[#6B7280]">{service.description}</p>
                      <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                        Seen {new Date(service.lastUpdated).toLocaleTimeString()}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-[#6B7280]">
                        <span className="font-semibold text-[#4F46E5]">
                          {(service.status ?? "unknown").toUpperCase()}
                        </span>
                        {service.availableReplicas !== undefined && (
                          <span>{service.availableReplicas} ready</span>
                        )}
                      </div>
                      {service.message && (
                        <p className="mt-1 text-[10px] text-red-500">{service.message}</p>
                      )}
                    </div>
                  ))}
                </div>
                {operatorSessions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                      Active mirrord sessions ({operatorSessions.length})
                    </p>
                    <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#F5F3FF] p-2">
                      {operatorSessions.map((session) => (
                        <div key={session.sessionId} className="mb-2 last:mb-0">
                          <p className="text-xs font-semibold text-[#E66479]">
                            Target • {session.target.name ?? "Unknown workload"}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {session.owner.username} ({session.owner.hostname}) in {session.namespace}
                          </p>
                          <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                            Started {new Date(session.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
