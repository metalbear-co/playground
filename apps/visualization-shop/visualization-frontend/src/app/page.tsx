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
  type ReactNode,
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
      node.id === "mirrord-layer" || node.id === "mirrord-agent";
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
        padding: 14,
        borderRadius: 18,
        backgroundColor: "transparent",
        color: palette.text,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
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
        targetHandle = undefined;
        break;
      case "local-to-layer":
        targetHandle = "layer-target-left";
        break;
      case "agent-to-target":
        sourceHandle = "agent-source-right";
        break;
      case "operator-to-agent":
      case "operator-to-agent-mirrored":
        sourceHandle = undefined;
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
 * Rich operator session returned by the /operator-status endpoint.
 */
type OperatorSession = {
  sessionId: string;
  target: {
    kind: string;
    name: string;
    container?: string;
    apiVersion?: string;
  };
  namespace: string;
  owner: {
    username: string;
    k8sUsername: string;
    hostname: string;
  };
  branchName?: string;
  createdAt: string;
  connectedAt?: string;
  durationSeconds?: number;
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

const sanitizeHostname = (hostname: string) =>
  hostname.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

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
 * Renders clean sans-serif typography: bold title, regular description.
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
 * Custom renderer for mirrord-specific nodes (layer, agent, operator, dynamic agents).
 * Adds XYFlow handles and styling. Dynamic agent nodes (id starting with "agent-")
 * render their label from node data instead of the static architecture definitions.
 */
const MirrordNode = ({ id, data }: NodeProps<MirrordNodeType>) => {
  const info = architectureNodes.find((node) => node.id === id);
  const palette = groupPalette.mirrord;
  const isLayer = id === "mirrord-layer";
  const isStaticAgent = id === "mirrord-agent";
  const isDynamicAgent = id.startsWith("agent-");
  const useHighlightBorder = data.highlight || isDynamicAgent;
  const borderColor = useHighlightBorder ? "#E66479" : palette.border;
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
      {isDynamicAgent && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {isDynamicAgent ? (
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

// Legend entries (match apps/visualization/).
const legendItems = [
  { label: "Entry / Client", color: groupPalette.entry.border },
  { label: "Core services", color: groupPalette.service.border },
  { label: "Data services", color: groupPalette.data.border },
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
          padding: 14,
          borderRadius: 18,
          backgroundColor: "transparent",
          color: palette.text,
          boxShadow: "0px 30px 60px rgba(230,100,121,0.35)",
          width: nodeWidth,
          zIndex: 10,
        },
        position: {
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
  }, [agentGroups]);

  // Build dynamic edges: operator -> agent and agent -> target per session.
  const dynamicEdges = useMemo((): Edge[] => {
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;
    const controlStyle = intentStyles.control;

    for (const group of agentGroups) {
      const agentId = `agent-${sanitizeHostname(group.targetName)}`;

      // Operator -> Agent
      edges.push({
        id: `operator-to-${agentId}`,
        source: "mirrord-operator",
        target: agentId,
        label: "Launch agent",
        type: "smoothstep",
        targetHandle: `${agentId}-target-left`,
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 24,
          height: 24,
        },
        style: {
          stroke: controlStyle.color,
          strokeWidth: 1.75,
          strokeDasharray: controlStyle.dash,
        },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 10,
        labelShowBg: true,
        labelBgStyle: { fill: "#FFFFFF" },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
      });

      // Agent -> Target (single edge with all session IDs as label)
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

    return edges;
  }, [agentGroups]);

  const hasOperatorSessions = operatorSessions.length > 0;

  // Combine static edges with dynamic agent edges.
  // Always include "local-to-layer" (LD_PRELOAD hook); exclude other session-only edges.
  const flowEdges = useMemo(() => {
    const staticEdges = baseEdges.filter((edge) => {
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
    return [...staticEdges, ...dynamicEdges];
  }, [baseEdges, dynamicEdges, hasOperatorSessions]);

  // Recompute the cluster zone overlay to encompass dynamic agent nodes.
  const dynamicClusterZoneNode = useMemo(() => {
    if (!clusterZoneNode) return null;
    if (dynamicAgentNodes.length === 0) return clusterZoneNode;

    const clusterStaticNodes = adjustedNodes.filter((n) => {
      const zone = nodeZoneIndex.get(n.id);
      return zone === "cluster" && !SESSION_NODE_IDS.has(n.id);
    });
    const allClusterNodes = [...clusterStaticNodes, ...dynamicAgentNodes];
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
  }, [dynamicAgentNodes]);

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

  // Merge zone overlays, static architecture nodes, and dynamic agent nodes.
  const flowNodes = useMemo(() => {
    const nodes: Node<NodeData | ZoneNodeData>[] = [];
    if (dynamicClusterZoneNode) {
      nodes.push(dynamicClusterZoneNode);
    }
    if (localZoneNode) {
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
    const shiftedArchNodes = visibleArchitectureNodes.map((node) => {
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
    return nodes;
  }, [visibleArchitectureNodes, dynamicAgentNodes, dynamicClusterZoneNode, localYShift]);

  const snapshotBaseUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ?? "http://localhost:8080";
    return base.replace(/\/$/, "");
  }, []);

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

  // Fetch operator sessions from the backend /operator-status endpoint.
  const operatorStatusUrl = useMemo(
    () => `${snapshotBaseUrl}/operator-status`,
    [snapshotBaseUrl],
  );

  const fetchOperatorStatus = useCallback(async () => {
    try {
      const response = await fetch(operatorStatusUrl, { cache: "no-store" });
      if (!response.ok) {
        console.warn(`Operator status request failed (${response.status})`);
        return;
      }
      const body = (await response.json()) as { sessions?: OperatorSession[] };
      if (isMountedRef.current) {
        setOperatorSessions(body.sessions ?? []);
      }
    } catch (error) {
      console.warn("Failed to fetch operator status:", (error as Error).message);
    }
  }, [operatorStatusUrl]);

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
    /**
     * React Flow change handler that ignores updates for static zone nodes while allowing user drags.
     */
    (changes: NodeChange[]) =>
      setArchitectureNodesState((nodes) => {
        const filteredChanges = changes.filter(
          (change) => !("id" in change && change.id.startsWith("zone-")),
        );
        if (filteredChanges.length === 0) {
          return nodes;
        }
        return applyNodeChanges<Node<NodeData>>(
          filteredChanges as NodeChange<Node<NodeData>>[],
          nodes,
        );
      }),
    [],
  );

  // Bound to the Refresh button so operators can trigger an immediate backend poll.
  const handleSnapshotRefresh = useCallback(() => {
    // Allow the operator to force an immediate backend poll instead of waiting for the interval tick.
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

  // When operator sessions are active, add highlight (glow) and pass highlight to MirrordNode for single border.
  useEffect(() => {
    setArchitectureNodesState((nodes) =>
      nodes.map((node) => {
        if (node.id === "local-process" || node.id === "mirrord-layer") {
          const baseStyle = { ...(originalNodeStyles.get(node.id) ?? {}) };
          const styleWithGlow = hasOperatorSessions
            ? {
                ...baseStyle,
                opacity: 1,
                boxShadow: "0px 30px 60px rgba(230,100,121,0.35)",
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
