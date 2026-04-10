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
  useReactFlow,
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
import DatabaseViewerDialog from "./DatabaseViewerDialog";

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
  ciRunner?: boolean;
  /** When true, render data.label directly instead of looking up static architectureNodes info */
  focusedCombined?: boolean;
  /** When true, DB branch matches a preview session key — use blue styling */
  matchesPreview?: boolean;
};

/** Module-level ref so ArchitectureNode (defined outside the component) can open the DB dialog. */
let openDbDialog: ((dbId: string) => void) | null = null;

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
  copyTarget?: {
    scaleDown: boolean;
    copyPodName?: string;
    originalTargetDeployment?: string;
  };
};

/**
 * Kafka ephemeral topic from the MirrordKafkaEphemeralTopic CRD.
 */
type KafkaEphemeralTopic = {
  topicName: string;
  sessionId: string;
  clientConfig: string;
  topicType: "Filtered" | "Fallback";
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

/**
 * Preview session from the PreviewSession CRD.
 */
type PreviewSession = {
  name: string;
  namespace: string;
  key: string;
  target: {
    kind: string;
    name: string;
    container: string;
  };
  image: string;
  ttlSecs: number;
  phase: string;
  podName?: string;
  failureMessage?: string;
  startedAt?: string;
};

type SqsEphemeralQueue = {
  queueName: string;
  originalQueueName: string;
  sessionId: string;
  consumer: string;
  jqFilter?: string;
};

type OperatorStatusResponse = {
  sessions: OperatorSession[];
  sessionCount: number;
  kafkaTopics: KafkaEphemeralTopic[];
  sqsQueues: SqsEphemeralQueue[];
  pgBranches: PgBranchDatabase[];
  previewSessions: PreviewSession[];
  fetchedAt: string;
};

type AgentGroup = {
  targetName: string;
  owners: { username: string; hostname: string }[];
  sessions: OperatorSession[];
  isCopyTarget: boolean;
  scaleDown: boolean;
  originalDeployment?: string;
  previewEnvKeys: { key: string; podName?: string }[];
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
const ArchitectureNode = ({ id, data }: NodeProps<Node<NodeData>>) => {
  const palette = groupPalette[data.group];
  const label = typeof data.label === "string" ? data.label : "";
  const isService = data.group === "service";
  const isDataNode = data.group === "data";
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
        {isDataNode && (
          <button
            className="mt-1 inline-flex items-center gap-1 self-start rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: `${palette.border}15`,
              color: palette.border,
              border: `1px solid ${palette.border}40`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              openDbDialog?.(id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            View Data
          </button>
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
      backgroundColor: data.background,
      color: "#0F172A",
      boxSizing: "border-box",
    }}
  >
    <div className={data.description ? "" : "text-center"}>
      <p
        className="text-xs font-bold uppercase tracking-[0.2em]"
        style={{ color: data.border }}
      >
        {data.label}
      </p>
      {data.description && <p className="mt-1 text-[13px] text-[#374151]">{data.description}</p>}
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
  const isDynamicSqsQueue = id.startsWith("sqs-queue-") || id.startsWith("sqs-deployed-queue-");
  const isDynamicLocal = id.startsWith("dynamic-local-");
  const isDynamicLayer = id.startsWith("dynamic-layer-");
  const isDynamicPgBranch = id.startsWith("pg-branch-");
  const isDynamicPreview = id.startsWith("preview-");
  const useHighlightBorder = data.highlight || isDynamicAgent || isDynamicKafkaTopic || isDynamicSqsQueue || isDynamicLocal || isDynamicLayer || isDynamicPgBranch || isDynamicPreview;
  const isOperator = id === "mirrord-operator";
  const isCiRunnerAgent = isDynamicAgent && data.ciRunner === true;
  const borderColor = isCiRunnerAgent ? "#0D9488" : isOperator ? "#16A34A" : isDynamicKafkaTopic ? "#7C3AED" : isDynamicSqsQueue ? "#CA8A04" : (isDynamicPgBranch && data.matchesPreview) ? "#0EA5E9" : isDynamicPgBranch ? "#DC2626" : isDynamicPreview ? "#0EA5E9" : useHighlightBorder ? "#E66479" : palette.border;
  const borderWidth = useHighlightBorder ? 3 : 2;
  const label = info?.label ?? id;
  const stack = info?.stack;
  const description = info?.description;

  return (
    <div
      className="flex h-full w-full flex-col justify-between whitespace-normal rounded-[18px] border border-solid px-4 py-4 text-left shadow-md"
      style={{
        border: `${borderWidth}px solid ${borderColor}`,
        backgroundColor: palette.background,
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
          <Handle type="source" position={Position.Top} id="operator-source-top" style={handleStyle} />
          <Handle type="source" position={Position.Bottom} id="operator-source-bottom" style={handleStyle} />
        </>
      )}
      {isDynamicAgent && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="target" position={Position.Top} id={`${id}-target-top`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
          <Handle type="source" position={Position.Top} id={`${id}-source-top`} style={handleStyle} />
          <Handle type="source" position={Position.Bottom} id={`${id}-source-bottom`} style={handleStyle} />
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
      {isDynamicSqsQueue && (
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
          <Handle type="target" position={Position.Top} id={`${id}-target-top`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
        </>
      )}
      {isDynamicPreview && (
        <>
          <Handle type="target" position={Position.Left} id={`${id}-target-left`} style={handleStyle} />
          <Handle type="target" position={Position.Bottom} id={`${id}-target-bottom`} style={handleStyle} />
          <Handle type="source" position={Position.Right} id={`${id}-source-right`} style={handleStyle} />
          <Handle type="source" position={Position.Top} id={`${id}-source-top`} style={handleStyle} />
        </>
      )}
      {(isDynamicAgent || isDynamicKafkaTopic || isDynamicSqsQueue || isDynamicLocal || isDynamicLayer || isDynamicPgBranch || isDynamicPreview || data.focusedCombined) ? (
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

/**
 * Type representing an active focused session in the visualization.
 */
type FocusedSession = {
  targetName: string;
  agentId: string;
  ownerUsername: string;
  ownerHostname: string;
};

/**
 * Inner component rendered inside <ReactFlow> to programmatically fit the view
 * to the focused node set whenever the focused session changes.
 */
function FocusedFitView({ visibleNodeIds }: { visibleNodeIds: string[] | null }) {
  const { fitView } = useReactFlow();
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visibleNodeIds || visibleNodeIds.length === 0) {
      // Focused mode closed — reset to full graph view
      if (prevKeyRef.current !== null) {
        prevKeyRef.current = null;
        setTimeout(() => fitView({ padding: 0.1, duration: 700 }), 50);
      }
      return;
    }
    const key = [...visibleNodeIds].sort().join(",");
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    setTimeout(() => {
      fitView({
        nodes: visibleNodeIds.map((id) => ({ id })),
        padding: 0.25,
        duration: 700,
      });
    }, 50);
  }, [visibleNodeIds, fitView]);

  return null;
}

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
export type VisualizationPageProps = {
  useQueueSplittingMock: boolean;
  useDbBranchMock: boolean;
  useMultipleSessionMock: boolean;
};

export default function VisualizationPage({ useQueueSplittingMock, useDbBranchMock, useMultipleSessionMock }: VisualizationPageProps) {
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
  const [sqsQueues, setSqsQueues] = useState<SqsEphemeralQueue[]>([]);
  const [pgBranchesRaw, setPgBranches] = useState<PgBranchDatabase[]>([]);
  const pgBranches = useMemo(() => {
    const seen = new Set<string>();
    return pgBranchesRaw.filter((b) => {
      const key = sanitizeHostname(b.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [pgBranchesRaw]);
  const [previewSessions, setPreviewSessions] = useState<PreviewSession[]>([]);
  const aliasIndex = useMemo(() => buildAliasIndex(), []);
  const [dynamicNodePositions, setDynamicNodePositions] = useState<
    Map<string, { x: number; y: number }>
  >(() => new Map());
  const [dbDialogId, setDbDialogId] = useState<string | null>(null);
  const [focusedSession, setFocusedSession] = useState<FocusedSession | null>(null);
  const [focusedMode, setFocusedMode] = useState<"mirror" | "steal">("mirror");
  const [focusPanelTab, setFocusPanelTab] = useState<"db-branch" | "queue-split" | "mirror" | "steal">("mirror");

  // Keep the module-level ref in sync so ArchitectureNode can open the dialog.
  useEffect(() => {
    openDbDialog = (id: string) => setDbDialogId(id);
    return () => { openDbDialog = null; };
  }, []);

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
          isCopyTarget: false,
          scaleDown: false,
          previewEnvKeys: [],
        });
      }
      const group = map.get(key)!;
      group.sessions.push(session);
      if (session.copyTarget) {
        group.isCopyTarget = true;
        group.scaleDown = session.copyTarget.scaleDown;
        if (session.copyTarget.originalTargetDeployment) {
          group.originalDeployment = session.copyTarget.originalTargetDeployment;
        }
      }
      if (!group.owners.some((o) => o.hostname === session.owner.hostname)) {
        group.owners.push({
          username: session.owner.username,
          hostname: session.owner.hostname,
        });
      }
    }

    // Integrate preview sessions into agent groups.
    // If a preview session targets the same service, add its key to the existing agent group.
    // If no agent group exists for that target, create a new one.
    for (const session of previewSessions) {
      const targetArchNodeId = aliasIndex.get(session.target.name.toLowerCase());
      const targetKey = targetArchNodeId ?? session.target.name;
      if (!map.has(targetKey)) {
        map.set(targetKey, {
          targetName: targetKey,
          owners: [],
          sessions: [],
          isCopyTarget: false,
          scaleDown: false,
          previewEnvKeys: [],
        });
      }
      const group = map.get(targetKey)!;
      if (!group.previewEnvKeys.some((e) => e.key === session.key && e.podName === session.podName)) {
        group.previewEnvKeys.push({ key: session.key, podName: session.podName });
      }
    }

    return Array.from(map.values());
  }, [operatorSessions, previewSessions, aliasIndex]);

  // Create one React Flow node per unique target (agent).
  // Sort agent groups so that agents targeting services further left (lower X) in the architecture
  // appear first (on top). This puts metal-mart-frontend / order-service agents above
  // payment-service / delivery-service agents. Use Y as tiebreaker.
  const sortedAgentGroups = useMemo(() => {
    return [...agentGroups].sort((a, b) => {
      const aPos = adjustedNodes.find((n) => n.id === a.targetName)?.position;
      const bPos = adjustedNodes.find((n) => n.id === b.targetName)?.position;
      const aX = aPos?.x ?? Infinity;
      const bX = bPos?.x ?? Infinity;
      if (aX !== bX) return aX - bX;
      const aY = aPos?.y ?? Infinity;
      const bY = bPos?.y ?? Infinity;
      return aY - bY;
    });
  }, [agentGroups]);

  const dynamicAgentNodes = useMemo((): Node<NodeData>[] => {
    const palette = groupPalette.mirrord;
    return sortedAgentGroups.map((group, index) => {
      const agentId = `agent-${sanitizeHostname(group.targetName)}`;
      const isCiRunner = group.owners.length > 0 && group.owners.every((o) => o.username === "runner");
      const isCopy = group.isCopyTarget;
      const copyLabel = isCopy && group.originalDeployment
        ? `Copy of ${group.originalDeployment}`
        : isCopy ? "Copy Target" : undefined;
      return {
        id: agentId,
        data: {
          group: "mirrord" as const,
          ciRunner: isCiRunner,
          label: (
            <div className={`flex flex-col gap-1 text-left${isCopy ? " mirrord-copy-pulse" : ""}`}>
              <span className="text-sm font-semibold text-slate-900">
                Agent - {group.targetName}
              </span>
              {copyLabel && (
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#E66479]">
                  {copyLabel}
                </span>
              )}
              {group.owners.map((owner) => (
                <p key={owner.hostname} className="text-xs leading-snug text-[#DC2626] font-semibold">
                  {owner.username === "runner" ? "mirrord CI" : owner.hostname}
                </p>
              ))}
              {group.previewEnvKeys.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1 border-t border-slate-200 pt-1">
                  {group.previewEnvKeys.map((entry) => (
                    entry.podName && (
                      <p key={`${entry.key}-${entry.podName}`} className="text-[11px] font-bold text-[#0EA5E9] break-all">
                        {entry.podName}
                      </p>
                    )
                  ))}
                </div>
              )}
            </div>
          ),
        },
        type: "mirrord",
        style: {
          borderRadius: 18,
          backgroundColor: "transparent",
          color: palette.text,
          boxShadow: isCiRunner ? "0px 30px 60px rgba(13,148,136,0.35)" : "0px 30px 60px rgba(124,58,237,0.35)",
          width: nodeWidth,
          zIndex: 10,
          cursor: "pointer",
          ...(isCopy ? { animation: "mirrordCopyPulse 2s ease-in-out infinite" } : {}),
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
  }, [sortedAgentGroups, dynamicNodePositions]);

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

      // Agent -> Target (skip if a kafka split topic replaces this direct path,
      // or if this is a copy target — the agent IS the replacement for the original service)
      if (!kafkaSplitTargets.has(group.targetName) && !group.isCopyTarget) {
        const sessionLabel = group.sessions
          .map((s) => s.sessionId.substring(0, 8))
          .join(", ");
        // Use top handle for metal-mart-frontend and order-service (they sit above the agents)
        const topTargets = new Set(["metal-mart-frontend", "order-service"]);
        const useTopHandle = topTargets.has(group.targetName);
        edges.push({
          id: `${agentId}-to-${group.targetName}`,
          source: agentId,
          target: group.targetName,
          label: sessionLabel,
          type: "bezier",
          sourceHandle: useTopHandle ? `${agentId}-source-top` : `${agentId}-source-right`,
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

    const fallbackTopics = kafkaTopics.filter((t) => t.topicType === "Fallback");
    const filteredTopics = kafkaTopics.filter((t) => t.topicType === "Filtered");

    // Filtered topic nodes – these connect to the local machine (mirrord-layer)
    filteredTopics.forEach((topic, index) => {
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

    // Fallback topic nodes – these connect to the target service (deployed app)
    const deliveryPos = adjustedNodes.find((n) => n.id === "delivery-service")?.position ?? { x: 0, y: 0 };
    fallbackTopics.forEach((topic, index) => {
      const nodeId = `kafka-deployed-topic-${topic.topicName}`;
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
        position: dynamicNodePositions.get(nodeId) ?? {
          x: deliveryPos.x + nodeWidth - 300 + index * (nodeWidth + 40),
          y: deliveryPos.y + 500,
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

    const fallbackTopics = kafkaTopics.filter((t) => t.topicType === "Fallback");
    const filteredTopics = kafkaTopics.filter((t) => t.topicType === "Filtered");

    // Operator → each filtered topic node (matching filter → local machine)
    for (const topic of filteredTopics) {
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

    // Filtered topic → mirrord-layer (arrow from bottom of topic to layer)
    filteredTopics.forEach((topic, index) => {
      const nodeId = `kafka-topic-${topic.topicName}`;
      const usesDynamicLocal = filteredTopics.length > 1;
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

    // Operator → each fallback topic node (not matching any filter → deployed app)
    for (const topic of fallbackTopics) {
      const nodeId = `kafka-deployed-topic-${topic.topicName}`;
      edges.push({
        id: `operator-to-${nodeId}`,
        source: "mirrord-operator",
        target: nodeId,
        label: "send messages not matching any filter",
        type: "bezier",
        sourceHandle: "operator-source-bottom",
        targetHandle: `${nodeId}-target-left`,
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

    // Fallback topic → delivery-service (consume messages to target)
    for (const topic of fallbackTopics) {
      const nodeId = `kafka-deployed-topic-${topic.topicName}`;
      edges.push({
        id: `${nodeId}-to-delivery`,
        source: nodeId,
        target: "delivery-service",
        label: "consume messages",
        type: "bezier",
        sourceHandle: `${nodeId}-source-top`,
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
    }

    return edges;
  }, [kafkaTopics, operatorSessions, aliasIndex]);

  // Build dynamic nodes for SQS split queues.
  // For each active split queue we create two nodes:
  //   1. Filtered/ephemeral node (sqs-queue-*) — receives messages matching the filter → local machine
  //   2. Deployed/original node (sqs-deployed-queue-*) — receives non-matching messages → payment-service
  const sqsQueueNodes = useMemo((): Node<NodeData>[] => {
    if (sqsQueues.length === 0) return [];
    const palette = groupPalette.mirrord;
    const nodes: Node<NodeData>[] = [];
    const sharedStyle = {
      borderRadius: 18,
      backgroundColor: "transparent",
      color: palette.text,
      boxShadow: "0px 30px 60px rgba(202,138,4,0.35)",
      width: nodeWidth,
      zIndex: 10,
    };
    const paymentPos = adjustedNodes.find((n) => n.id === "payment-service")?.position ?? { x: 0, y: 0 };

    // Filtered/ephemeral nodes — connect to mirrord-layer (local machine)
    sqsQueues.forEach((queue, index) => {
      const nodeId = `sqs-queue-${queue.queueName}`;
      nodes.push({
        id: nodeId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">{queue.queueName}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#CA8A04]">
                ephemeral · filtered
              </span>
              {queue.jqFilter && (
                <span className="text-[10px] font-mono text-slate-500 truncate" title={queue.jqFilter}>
                  {queue.jqFilter}
                </span>
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                session: {queue.sessionId.toLowerCase()}
              </span>
            </div>
          ),
        },
        position: dynamicNodePositions.get(nodeId) ?? {
          x: paymentPos.x,
          y: dynamicAgentBasePosition.y + (sqsQueues.length + index) * DYNAMIC_AGENT_SPACING_Y,
        },
        style: sharedStyle,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      });
    });

    // Deployed/original nodes — connect to payment-service (non-matching messages)
    sqsQueues.forEach((queue, index) => {
      const nodeId = `sqs-deployed-queue-${queue.originalQueueName}`;
      nodes.push({
        id: nodeId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          label: (
            <div className="flex flex-col gap-1 text-left">
              <span className="text-sm font-semibold text-slate-900">{queue.originalQueueName}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#CA8A04]">
                original · unfiltered
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                session: {queue.sessionId.toLowerCase()}
              </span>
            </div>
          ),
        },
        position: dynamicNodePositions.get(nodeId) ?? {
          x: paymentPos.x,
          y: dynamicAgentBasePosition.y + index * DYNAMIC_AGENT_SPACING_Y,
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
  }, [sqsQueues, dynamicNodePositions, adjustedNodes]);

  // Build dynamic edges for SQS split queue nodes.
  const sqsQueueEdges = useMemo((): Edge[] => {
    if (sqsQueues.length === 0) return [];
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };

    // sqs → operator (intercept messages)
    edges.push({
      id: "sqs-to-operator",
      source: "sqs",
      target: "mirrord-operator",
      label: "consume messages",
      type: "bezier",
      sourceHandle: "source-bottom",
      targetHandle: "operator-target-top",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      style: { stroke: mirroredStyle.color, strokeWidth: 2.75, strokeDasharray: mirroredStyle.dash },
      ...edgeLabelDefaults,
    });

    // operator → each filtered/ephemeral queue node (matching filter → local machine)
    for (const queue of sqsQueues) {
      const nodeId = `sqs-queue-${queue.queueName}`;
      edges.push({
        id: `operator-to-${nodeId}`,
        source: "mirrord-operator",
        target: nodeId,
        label: "matching filter",
        type: "bezier",
        sourceHandle: "operator-source-right",
        targetHandle: `${nodeId}-target-left`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: mirroredStyle.color, strokeWidth: 2.75, strokeDasharray: mirroredStyle.dash },
        ...edgeLabelDefaults,
      });
    }

    // operator → each deployed/original queue node (not matching filter → deployed app)
    for (const queue of sqsQueues) {
      const nodeId = `sqs-deployed-queue-${queue.originalQueueName}`;
      edges.push({
        id: `operator-to-${nodeId}`,
        source: "mirrord-operator",
        target: nodeId,
        label: "not matching filter",
        type: "bezier",
        sourceHandle: "operator-source-right",
        targetHandle: `${nodeId}-target-left`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: mirroredStyle.color, strokeWidth: 2.75, strokeDasharray: mirroredStyle.dash },
        ...edgeLabelDefaults,
      });
    }

    // filtered queue → mirrord-layer (local process consumes matching messages)
    sqsQueues.forEach((queue, index) => {
      const nodeId = `sqs-queue-${queue.queueName}`;
      const usesDynamicLocal = sqsQueues.length > 1;
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
        style: { stroke: mirroredStyle.color, strokeWidth: 2.75, strokeDasharray: mirroredStyle.dash },
        ...edgeLabelDefaults,
      });
    });

    // deployed queue → payment-service (deployed app consumes non-matching messages)
    for (const queue of sqsQueues) {
      const nodeId = `sqs-deployed-queue-${queue.originalQueueName}`;
      edges.push({
        id: `${nodeId}-to-payment`,
        source: nodeId,
        target: "payment-service",
        label: "consume messages",
        type: "bezier",
        sourceHandle: `${nodeId}-source-top`,
        targetHandle: "target-bottom",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: mirroredStyle.color, strokeWidth: 2.75, strokeDasharray: mirroredStyle.dash },
        ...edgeLabelDefaults,
      });
    }

    return edges;
  }, [sqsQueues, operatorSessions, aliasIndex]);

  // Hide the static sqs→payment edge when a split queue replaces it.
  const sqsReplacedEdges = useMemo(() => {
    const replaced = new Set<string>();
    if (sqsQueues.length > 0) replaced.add("sqs-to-payment");
    return replaced;
  }, [sqsQueues]);

  const hasShopSessions = agentGroups.some(g => g.sessions.length > 0);

  // Set of architecture node IDs whose deployment has been scaled down by a copy target.
  // These nodes should appear "ghosted" and incoming edges should be redirected to the agent.
  const scaleDownTargets = useMemo(() => {
    const targets = new Map<string, string>(); // originalDeployment → agentId
    for (const group of agentGroups) {
      if (group.scaleDown && group.originalDeployment) {
        const archNodeId = aliasIndex.get(group.originalDeployment.toLowerCase());
        if (archNodeId) {
          const agentId = `agent-${sanitizeHostname(group.targetName)}`;
          targets.set(archNodeId, agentId);
        }
      }
    }
    return targets;
  }, [agentGroups, aliasIndex]);

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
  // When there are no kafka topics but multiple unique hostnames in operator sessions,
  // create per-hostname local machine nodes instead.
  const hasMultipleKafkaTopics = kafkaTopics.length > 1;

  type LocalMachineEntry = { ownerName: string; hostname: string };

  const localMachineEntries = useMemo((): LocalMachineEntry[] => {
    if (hasMultipleKafkaTopics) {
      const uniqueByHostname = new Map<string, LocalMachineEntry>();
      for (const topic of kafkaTopics) {
        const session = operatorSessions.find((s) => s.sessionId === topic.sessionId);
        const hostname = session?.owner.hostname ?? "";
        if (!uniqueByHostname.has(hostname)) {
          uniqueByHostname.set(hostname, {
            ownerName: session?.owner.username ?? "Unknown",
            hostname,
          });
        }
      }
      if (uniqueByHostname.size > 1) {
        return Array.from(uniqueByHostname.values());
      }
      return [];
    }
    const uniqueHostnames = new Map<string, LocalMachineEntry>();
    const shopSessions = operatorSessions.filter((s) => s.namespace === "shop");
    for (const session of shopSessions) {
      if (!uniqueHostnames.has(session.owner.hostname)) {
        uniqueHostnames.set(session.owner.hostname, {
          ownerName: session.owner.username,
          hostname: session.owner.hostname,
        });
      }
    }
    if (uniqueHostnames.size > 1) {
      return Array.from(uniqueHostnames.values());
    }
    return [];
  }, [kafkaTopics, operatorSessions, hasMultipleKafkaTopics]);

  const hasDynamicLocalMachines = localMachineEntries.length > 1;

  /**
   * Derive which nodes are relevant to the focused session so we can dim everything else.
   * Returns null when no session is focused.
   */
  const focusedViewData = useMemo(() => {
    if (!focusedSession) return null;
    const targetArchId = aliasIndex.get(focusedSession.targetName.toLowerCase());
    if (!targetArchId) return null;

    const upstreamIds = new Set<string>();
    const downstreamIds = new Set<string>();
    for (const edge of architectureEdges) {
      if (edge.target === targetArchId) upstreamIds.add(edge.source);
      if (edge.source === targetArchId) downstreamIds.add(edge.target);
    }

    const localIndex = hasDynamicLocalMachines
      ? localMachineEntries.findIndex((e) => e.hostname === focusedSession.ownerHostname)
      : -1;
    const localId = localIndex >= 0 ? `dynamic-local-${localIndex}` : "local-process";
    const layerId = localIndex >= 0 ? `dynamic-layer-${localIndex}` : "mirrord-layer";

    // Find a pg-branch active for this developer on this target.
    // Match first by both hostname and target (most specific), then fall back to
    // hostname-only in case targetDeployment naming differs from session target name.
    const activeBranch =
      pgBranches.find(
        (b) =>
          b.owners.some((o) => o.hostname === focusedSession.ownerHostname) &&
          (b.targetDeployment === focusedSession.targetName ||
            aliasIndex.get(b.targetDeployment.toLowerCase()) === targetArchId),
      ) ??
      pgBranches.find((b) =>
        b.owners.some((o) => o.hostname === focusedSession.ownerHostname),
      ) ??
      null;
    const pgBranchId = activeBranch
      ? `pg-branch-${sanitizeHostname(activeBranch.name)}`
      : null;

    // --- Queue split detection ---------------------------------------------------
    // Find operator sessions belonging to the focused user+target. Then collect any
    // Kafka topic / SQS queue whose sessionId belongs to one of those sessions.
    // Each entry is normalized to a generic shape so the rest of focus mode can
    // treat Kafka and SQS uniformly. The user has guaranteed at most one queue
    // type is active for a given target at a time.
    const matchingSessionIds = new Set(
      operatorSessions
        .filter((s) => {
          if (s.owner.hostname !== focusedSession.ownerHostname) return false;
          const sTargetArchId = aliasIndex.get((s.target.name ?? "").toLowerCase());
          return sTargetArchId === targetArchId;
        })
        .map((s) => s.sessionId),
    );

    type ActiveQueueSplit = {
      kind: "kafka" | "sqs";
      producerId: string;       // architecture node id of the producer (e.g. "kafka", "sqs")
      filteredId: string;       // dynamic node id of the filtered/ephemeral split
      fallbackId: string;       // dynamic node id of the fallback/original split
      label: string;            // user-facing identifier (topic/queue name)
      filter?: string;          // jq filter (sqs only)
      sessionId: string;
    };

    const activeQueueSplits: ActiveQueueSplit[] = [];

    // Kafka — pair Filtered+Fallback topics by sessionId.
    const kafkaBySession = new Map<string, { filtered?: KafkaEphemeralTopic; fallback?: KafkaEphemeralTopic }>();
    for (const t of kafkaTopics) {
      if (!matchingSessionIds.has(t.sessionId)) continue;
      const entry = kafkaBySession.get(t.sessionId) ?? {};
      if (t.topicType === "Filtered") entry.filtered = t;
      else if (t.topicType === "Fallback") entry.fallback = t;
      kafkaBySession.set(t.sessionId, entry);
    }
    for (const [sessionId, { filtered, fallback }] of kafkaBySession) {
      if (!filtered || !fallback) continue;
      activeQueueSplits.push({
        kind: "kafka",
        producerId: "kafka",
        filteredId: `kafka-topic-${filtered.topicName}`,
        fallbackId: `kafka-deployed-topic-${fallback.topicName}`,
        label: filtered.topicName,
        sessionId,
      });
    }

    // SQS — each queue is self-contained (filtered + original both live on the row).
    for (const q of sqsQueues) {
      if (!matchingSessionIds.has(q.sessionId)) continue;
      activeQueueSplits.push({
        kind: "sqs",
        producerId: "sqs",
        filteredId: `sqs-queue-${q.queueName}`,
        fallbackId: `sqs-deployed-queue-${q.originalQueueName}`,
        label: q.queueName,
        filter: q.jqFilter,
        sessionId: q.sessionId,
      });
    }

    const hasQueueSplit = activeQueueSplits.length > 0;
    const queueSplitNodeIds = activeQueueSplits.flatMap((s) => [s.filteredId, s.fallbackId]);

    const visibleIds = new Set([
      targetArchId,
      ...upstreamIds,
      ...downstreamIds,
      focusedSession.agentId,
      localId,
      layerId,
      ...(pgBranchId ? [pgBranchId] : []),
      ...(hasQueueSplit ? ["mirrord-operator", ...queueSplitNodeIds] : []),
    ]);

    const targetNode = architectureNodes.find((n) => n.id === targetArchId);
    const targetLabel =
      typeof targetNode?.label === "string" ? targetNode.label : targetArchId;

    return {
      targetArchId,
      upstreamIds,
      downstreamIds,
      visibleIds,
      localId,
      layerId,
      targetLabel,
      activeBranch,
      pgBranchId,
      activeQueueSplits,
      hasQueueSplit,
    };
  }, [focusedSession, aliasIndex, hasDynamicLocalMachines, localMachineEntries, pgBranches, operatorSessions, kafkaTopics, sqsQueues]);

  /**
   * Enter focused view when the user clicks an agent node or a local process node.
   */
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("agent-")) {
        const group = agentGroups.find(
          (g) => `agent-${sanitizeHostname(g.targetName)}` === node.id,
        );
        if (group) {
          const firstSession = group.sessions[0];
          const ownerHostname = firstSession?.owner.hostname ?? group.owners[0]?.hostname ?? "unknown";
          setFocusedSession({
            targetName: group.targetName,
            agentId: node.id,
            ownerUsername:
              firstSession?.owner.username ?? group.owners[0]?.username ?? "unknown",
            ownerHostname,
          });
          setFocusedMode("mirror");
          const targetArchId = aliasIndex.get(group.targetName.toLowerCase());
          const hasBranch = pgBranches.some(
            (b) =>
              b.owners.some((o) => o.hostname === ownerHostname) &&
              (b.targetDeployment === group.targetName ||
                aliasIndex.get(b.targetDeployment.toLowerCase()) === targetArchId),
          );
          // Detect a queue split (kafka or sqs) for this user+target.
          const sessionIdsForFocus = new Set(
            operatorSessions
              .filter(
                (s) =>
                  s.owner.hostname === ownerHostname &&
                  aliasIndex.get((s.target.name ?? "").toLowerCase()) === targetArchId,
              )
              .map((s) => s.sessionId),
          );
          const hasQueueSplit =
            kafkaTopics.some((t) => sessionIdsForFocus.has(t.sessionId)) ||
            sqsQueues.some((q) => sessionIdsForFocus.has(q.sessionId));
          setFocusPanelTab(hasBranch ? "db-branch" : hasQueueSplit ? "queue-split" : "mirror");
        }
        return;
      }

      if (node.id === "local-process" || node.id.startsWith("dynamic-local-")) {
        if (agentGroups.length === 0) return;
        let group: AgentGroup | undefined;
        if (node.id === "local-process" && agentGroups.length === 1) {
          group = agentGroups[0];
        } else if (node.id.startsWith("dynamic-local-")) {
          const idx = parseInt(node.id.replace("dynamic-local-", ""), 10);
          const entry = localMachineEntries[idx];
          if (entry) {
            group = agentGroups.find((g) =>
              g.sessions.some((s) => s.owner.hostname === entry.hostname),
            );
          }
        }
        if (group) {
          const agentId = `agent-${sanitizeHostname(group.targetName)}`;
          const firstSession = group.sessions[0];
          const ownerHostname = firstSession?.owner.hostname ?? group.owners[0]?.hostname ?? "unknown";
          setFocusedSession({
            targetName: group.targetName,
            agentId,
            ownerUsername:
              firstSession?.owner.username ?? group.owners[0]?.username ?? "unknown",
            ownerHostname,
          });
          setFocusedMode("mirror");
          const targetArchId = aliasIndex.get(group.targetName.toLowerCase());
          const hasBranch = pgBranches.some(
            (b) =>
              b.owners.some((o) => o.hostname === ownerHostname) &&
              (b.targetDeployment === group.targetName ||
                aliasIndex.get(b.targetDeployment.toLowerCase()) === targetArchId),
          );
          // Detect a queue split (kafka or sqs) for this user+target.
          const sessionIdsForFocus = new Set(
            operatorSessions
              .filter(
                (s) =>
                  s.owner.hostname === ownerHostname &&
                  aliasIndex.get((s.target.name ?? "").toLowerCase()) === targetArchId,
              )
              .map((s) => s.sessionId),
          );
          const hasQueueSplit =
            kafkaTopics.some((t) => sessionIdsForFocus.has(t.sessionId)) ||
            sqsQueues.some((q) => sessionIdsForFocus.has(q.sessionId));
          setFocusPanelTab(hasBranch ? "db-branch" : hasQueueSplit ? "queue-split" : "mirror");
        }
      }
    },
    [agentGroups, localMachineEntries, pgBranches, aliasIndex, operatorSessions, kafkaTopics, sqsQueues],
  );

  const dynamicLocalMachineNodes = useMemo((): Node<NodeData>[] => {
    if (!hasDynamicLocalMachines) return [];
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

    localMachineEntries.forEach((entry, index) => {
      const ownerName = entry.ownerName;
      const hostname = entry.hostname;
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
                {ownerName === "runner" ? "mirrord CI" : `${ownerName} (${hostname})`}
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
  }, [localMachineEntries, hasDynamicLocalMachines, dynamicNodePositions]);

  // Edges for dynamic local machines: local→layer (LD_PRELOAD) and layer→operator.
  const dynamicLocalEdges = useMemo((): Edge[] => {
    if (!hasDynamicLocalMachines) return [];
    const edges: Edge[] = [];
    const mirroredStyle = intentStyles.mirrored;
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };

    localMachineEntries.forEach((_, index) => {
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
  }, [localMachineEntries, hasDynamicLocalMachines]);

  // Zone overlays for each dynamic local machine pair.
  const dynamicLocalZoneNodes = useMemo((): ClusterZoneNode[] => {
    if (!hasDynamicLocalMachines) return [];
    const zones: ClusterZoneNode[] = [];
    const padding = 80;

    localMachineEntries.forEach((entry, index) => {
      const localId = `dynamic-local-${index}`;
      const layerId = `dynamic-layer-${index}`;
      const localNode = dynamicLocalMachineNodes.find((n) => n.id === localId);
      const layerNode = dynamicLocalMachineNodes.find((n) => n.id === layerId);
      if (!localNode || !layerNode) return;

      const ownerName = entry.ownerName;

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
  }, [localMachineEntries, dynamicLocalMachineNodes, hasDynamicLocalMachines]);

  // Build dynamic nodes for PgBranchDatabase resources.
  // Each branch is positioned to the right of its target deployment's postgres data node.
  const pgBranchNodes = useMemo((): Node<NodeData>[] => {
    if (pgBranches.length === 0) return [];
    const palette = groupPalette.mirrord;

    // Collect all preview session keys for matching
    const previewKeys = new Set(previewSessions.map((s) => s.key));

    return pgBranches.map((branch, index) => {
      const nodeId = `pg-branch-${sanitizeHostname(branch.name)}`;
      // Position near the target deployment's postgres node
      const postgresNodeId = `postgres-orders`;
      const postgresPos = adjustedNodes.find((n) => n.id === postgresNodeId)?.position ?? { x: 0, y: 0 };

      // Use blue (preview) styling when branchId matches a preview session key
      const matchesPreview = previewKeys.has(branch.branchId);
      const boxShadow = matchesPreview
        ? "0px 30px 60px rgba(14,165,233,0.25)"
        : "0px 30px 60px rgba(220,38,38,0.25)";
      const buttonClass = matchesPreview
        ? "mt-1 inline-flex items-center gap-1 self-start rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
        : "mt-1 inline-flex items-center gap-1 self-start rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer";

      return {
        id: nodeId,
        type: "mirrord",
        data: {
          group: "mirrord" as const,
          matchesPreview,
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
                  {owner.username === "runner" ? "mirrord CI" : `${owner.username} (${owner.hostname})`}
                </p>
              ))}
              <button
                className={buttonClass}
                onClick={(e) => {
                  e.stopPropagation();
                  setDbDialogId(nodeId);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                View Data
              </button>
            </div>
          ),
        },
        position: dynamicNodePositions.get(nodeId) ?? {
          x: postgresPos.x - nodeWidth - 60,
          y: postgresPos.y + index * (nodeHeight + 40),
        },
        style: {
          borderRadius: 18,
          backgroundColor: "transparent",
          color: palette.text,
          boxShadow,
          width: nodeWidth,
          zIndex: 10,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        connectable: false,
        draggable: true,
        selectable: true,
      };
    });
  }, [pgBranches, dynamicNodePositions, previewSessions]);

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
      // Derive the postgres node for this branch's target deployment from architecture edges
      const targetArchId = aliasIndex.get(branch.targetDeployment.toLowerCase());
      const postgresNodeId =
        (targetArchId
          ? architectureEdges.find(
              (e) => e.source === targetArchId && e.target.startsWith("postgres-"),
            )?.target
          : undefined) ?? "postgres-orders";
      const agentId = `agent-${sanitizeHostname(branch.targetDeployment)}`;

      // Postgres → PgBranch (branch is a copy of the original DB)
      edges.push({
        id: `${postgresNodeId}-to-${nodeId}`,
        source: postgresNodeId,
        target: nodeId,
        label: `Copy mode: ${branch.copyMode}`,
        type: "bezier",
        sourceHandle: "source-bottom",
        targetHandle: `${nodeId}-target-top`,
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
  }, [pgBranches, aliasIndex, architectureEdges]);

  // Build dynamic nodes for PreviewSession resources.
  // Group preview sessions by key so sessions sharing a key are positioned together.
  const previewSessionNodes = useMemo((): Node<NodeData>[] => {
    if (previewSessions.length === 0) return [];
    const palette = groupPalette.mirrord;
    const operatorPos = adjustedNodes.find((n) => n.id === "mirrord-operator")?.position ?? { x: 0, y: 0 };

    // Group sessions by key
    const keyGroups = new Map<string, typeof previewSessions>();
    for (const session of previewSessions) {
      const group = keyGroups.get(session.key) ?? [];
      group.push(session);
      keyGroups.set(session.key, group);
    }

    const nodes: Node<NodeData>[] = [];

    // Compute the shifted operator Y (operator moves to bottom of agent list)
    const operatorShiftedY = operatorPos.y + (sortedAgentGroups.length > 0
      ? (sortedAgentGroups.length - 1) * DYNAMIC_AGENT_SPACING_Y
      : 0);

    // Flatten all sessions across groups and stack them vertically to the left of the operator
    let sessionIndex = 0;
    for (const [, sessions] of keyGroups) {
      sessions.forEach((session) => {
        const nodeId = `preview-${sanitizeHostname(session.name)}`;
        const phaseColor = session.phase === "Ready" ? "text-green-600" : session.phase === "Failed" ? "text-red-600" : "text-yellow-600";

        // Position preview pods vertically stacked to the left of the shifted operator
        const baseX = operatorPos.x - nodeWidth - 200;
        const baseY = operatorShiftedY + sessionIndex * (nodeHeight + 40);
        const position = dynamicNodePositions.get(nodeId) ?? {
          x: baseX,
          y: baseY,
        };
        sessionIndex++;

        nodes.push({
          id: nodeId,
          type: "mirrord",
          data: {
            group: "mirrord" as const,
            label: (
              <div className="flex flex-col gap-1 text-left">
                <span className="text-sm font-bold text-slate-900">
                  {session.key}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {session.target.name}
                </span>
                {session.podName && (
                  <p className="text-[11px] text-slate-500 break-all">
                    {session.podName}
                  </p>
                )}
                <p className={`text-[11px] font-medium ${phaseColor}`}>
                  {session.phase}{session.failureMessage ? ` — ${session.failureMessage}` : ""}
                </p>
              </div>
            ),
          },
          position,
          style: {
            borderRadius: 18,
            backgroundColor: "transparent",
            color: palette.text,
            boxShadow: "0px 30px 60px rgba(14,165,233,0.25)",
            width: nodeWidth,
            zIndex: 10,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          connectable: false,
          draggable: true,
          selectable: true,
        });
      });
    }

    return nodes;
  }, [previewSessions, dynamicNodePositions]);

  // Build zone overlay nodes for preview session groups (sessions sharing the same key).
  const previewSessionZoneNodes = useMemo((): ClusterZoneNode[] => {
    if (previewSessions.length === 0) return [];

    // Group sessions by key
    const keyGroups = new Map<string, typeof previewSessions>();
    for (const session of previewSessions) {
      const group = keyGroups.get(session.key) ?? [];
      group.push(session);
      keyGroups.set(session.key, group);
    }

    const zones: ClusterZoneNode[] = [];
    const padding = 30;

    for (const [key, sessions] of keyGroups) {
      // Find the preview nodes belonging to this group
      const memberNodeIds = sessions.map((s) => `preview-${sanitizeHostname(s.name)}`);
      const memberNodes: Node<NodeData>[] = previewSessionNodes.filter((n) => memberNodeIds.includes(n.id));

      // Include DB branch nodes whose branchId matches this preview key
      const matchingBranchNodes = pgBranchNodes.filter((n) => {
        const branch = pgBranches.find((b) => `pg-branch-${sanitizeHostname(b.name)}` === n.id);
        return branch && branch.branchId === key;
      });
      const allZoneNodes = [...memberNodes, ...matchingBranchNodes];
      if (allZoneNodes.length < 2) continue;

      const xs = allZoneNodes.map((n) => n.position.x);
      const ys = allZoneNodes.map((n) => n.position.y);
      const maxXs = allZoneNodes.map((n) => n.position.x + nodeWidth);
      const maxYs = allZoneNodes.map((n) => n.position.y + nodeHeight);

      const zoneWidth = Math.max(...maxXs) - Math.min(...xs) + padding * 2;
      const zoneHeight = Math.max(...maxYs) - Math.min(...ys) + padding * 2 + 20; // extra space for key label

      zones.push({
        id: `zone-preview-${sanitizeHostname(key)}`,
        type: "zone",
        position: {
          x: Math.min(...xs) - padding,
          y: Math.min(...ys) - padding - 20, // offset up for key label
        },
        data: {
          label: key,
          description: "",
          background: "rgba(191, 219, 254, 0.25)",
          border: "#3B82F6",
          accent: "#2563EB",
          zoneWidth,
          zoneHeight,
        },
        style: {
          width: zoneWidth,
          height: zoneHeight,
          zIndex: 2,
          pointerEvents: "none",
        },
        draggable: false,
        selectable: false,
      });
    }

    return zones;
  }, [previewSessions, previewSessionNodes, pgBranchNodes, pgBranches]);

  // Build dynamic edges for PreviewSession nodes: preview pod → operator.
  // The operator → agent → target path is handled by dynamicEdges via agentGroups integration.
  const previewSessionEdges = useMemo((): Edge[] => {
    if (previewSessions.length === 0) return [];
    const mirroredStyle = intentStyles.mirrored;
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
      labelBgStyle: { fill: "#FFFFFF" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
    };

    const edges: Edge[] = [];
    for (const session of previewSessions) {
      const nodeId = `preview-${sanitizeHostname(session.name)}`;
      edges.push({
        id: `${nodeId}-to-operator`,
        source: nodeId,
        target: "mirrord-operator",
        label: "Preview pod",
        type: "bezier",
        sourceHandle: `${nodeId}-source-right`,
        targetHandle: "operator-target-left",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: {
          stroke: "#0EA5E9",
          strokeWidth: 2.75,
          strokeDasharray: mirroredStyle.dash,
        },
        ...edgeLabelDefaults,
      });
    }
    return edges;
  }, [previewSessions]);

  // Combine static edges with dynamic agent edges and kafka edges.
  // When multiple kafka topics exist, static local-to-layer and layer-to-agent are replaced
  // by per-topic dynamic local edges.
  // When a copy target with scale-down is active, redirect producer edges to the agent node.
  const flowEdges = useMemo(() => {
    const staticEdges: Edge[] = [];
    for (const edge of baseEdges) {
      if (kafkaReplacedEdges.has(edge.id)) continue;
      if (sqsReplacedEdges.has(edge.id)) continue;
      // Hide static local edges when dynamic local machines replace them
      if (hasDynamicLocalMachines && (edge.id === "local-to-layer" || edge.id === "layer-to-agent")) continue;
      if (edge.id === "local-to-layer" || edge.id === "layer-to-agent") {
        if (!hasShopSessions) continue;
        // These edges pass through — skip the SESSION_NODE_IDS filter below
        staticEdges.push(edge);
        continue;
      }
      if (
        SESSION_NODE_IDS.has(edge.source) ||
        SESSION_NODE_IDS.has(edge.target)
      ) {
        continue;
      }
      // Redirect edges targeting a scaled-down service to its copy agent
      const agentId = scaleDownTargets.get(edge.target);
      if (agentId) {
        staticEdges.push({
          ...edge,
          id: `${edge.id}-redirected`,
          target: agentId,
          targetHandle: `${agentId}-target-top`,
        });
        continue;
      }
      // Also hide edges whose *source* is a scaled-down target (it's ghosted, no outgoing traffic)
      if (scaleDownTargets.has(edge.source)) continue;
      staticEdges.push(edge);
    }
    return [...staticEdges, ...dynamicEdges, ...kafkaTopicEdges, ...sqsQueueEdges, ...dynamicLocalEdges, ...pgBranchEdges, ...previewSessionEdges];
  }, [baseEdges, dynamicEdges, kafkaTopicEdges, sqsQueueEdges, dynamicLocalEdges, pgBranchEdges, previewSessionEdges, hasShopSessions, kafkaReplacedEdges, sqsReplacedEdges, hasDynamicLocalMachines, scaleDownTargets]);

  // Recompute the cluster zone overlay to encompass dynamic agent nodes.
  const dynamicClusterZoneNode = useMemo(() => {
    if (!clusterZoneNode) return null;
    if (dynamicAgentNodes.length === 0 && kafkaTopicNodes.length === 0 && sqsQueueNodes.length === 0 && pgBranchNodes.length === 0 && previewSessionNodes.length === 0) return clusterZoneNode;

    // Apply operator bottom-shift so cluster zone encompasses the shifted operator position
    const opBottomShift = sortedAgentGroups.length > 0
      ? (sortedAgentGroups.length - 1) * DYNAMIC_AGENT_SPACING_Y
      : 0;
    const clusterStaticNodes = adjustedNodes.filter((n) => {
      const zone = nodeZoneIndex.get(n.id);
      return zone === "cluster" && !SESSION_NODE_IDS.has(n.id);
    }).map((n) => {
      if (n.id === "mirrord-operator" && opBottomShift > 0) {
        return { ...n, position: { ...n.position, y: n.position.y + opBottomShift } };
      }
      return n;
    });
    const allClusterNodes = [...clusterStaticNodes, ...dynamicAgentNodes, ...kafkaTopicNodes, ...sqsQueueNodes, ...pgBranchNodes, ...previewSessionNodes];
    const padding = 48;
    const xs = allClusterNodes.map((n) => n.position.x);
    const ys = allClusterNodes.map((n) => n.position.y);
    const maxXs = allClusterNodes.map((n) => n.position.x + nodeWidth);
    const maxYs = allClusterNodes.map((n) => n.position.y + nodeHeight);

    // Include preview session zone boxes in the bounds calculation
    for (const zone of previewSessionZoneNodes) {
      xs.push(zone.position.x);
      ys.push(zone.position.y);
      maxXs.push(zone.position.x + (zone.data as ZoneNodeData).zoneWidth);
      maxYs.push(zone.position.y + (zone.data as ZoneNodeData).zoneHeight);
    }

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
  }, [dynamicAgentNodes, kafkaTopicNodes, sqsQueueNodes, pgBranchNodes, previewSessionNodes, previewSessionZoneNodes, sortedAgentGroups]);

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
    if (hasDynamicLocalMachines) {
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
      // When a single session exists, append the owner's name to the zone label
      const singleShopSession = !hasDynamicLocalMachines
        ? operatorSessions.find((s) => s.namespace === "shop")
        : undefined;
      const shifted = {
        ...localZoneNode,
        position: {
          ...localZoneNode.position,
          y: localZoneNode.position.y + localYShift,
        },
        ...(singleShopSession && {
          data: {
            ...localZoneNode.data,
            label: `Local Machine – ${singleShopSession.owner.username}`,
          },
        }),
      };
      nodes.push(shifted);
    }
    // Shift local architecture nodes down by the same amount
    // When multiple kafka topics exist, hide static local nodes (replaced by dynamic ones)
    // Shift operator down to bottom of agent list so agents are above it
    const operatorBottomShift = sortedAgentGroups.length > 0
      ? (sortedAgentGroups.length - 1) * DYNAMIC_AGENT_SPACING_Y
      : 0;

    // Resolve owner info for single-session local-process node
    const singleSessionOwner = (() => {
      if (hasDynamicLocalMachines) return undefined;
      const session = operatorSessions.find((s) => s.namespace === "shop");
      if (!session) return undefined;
      const owner = session.owner;
      return owner.username === "runner"
        ? "mirrord CI"
        : `${owner.username} (${owner.hostname})`;
    })();

    const shiftedArchNodes = visibleArchitectureNodes
      .filter((node) => {
        if (hasDynamicLocalMachines && (node.id === "local-process" || node.id === "mirrord-layer")) {
          return false;
        }
        // Hide mirrord-layer when no shop sessions exist
        if (node.id === "mirrord-layer" && !hasShopSessions) return false;
        return true;
      })
      .map((node) => {
        const zone = nodeZoneIndex.get(node.id);
        let mapped = node;
        // Show session owner on the local-process node when a single session is active
        if (mapped.id === "local-process" && singleSessionOwner) {
          mapped = {
            ...mapped,
            data: { ...mapped.data, description: singleSessionOwner },
          };
        }
        // Push operator to the bottom, aligned with the last agent
        if (mapped.id === "mirrord-operator" && operatorBottomShift > 0) {
          mapped = {
            ...mapped,
            position: { ...mapped.position, y: mapped.position.y + operatorBottomShift },
          };
        }
        if (zone === "local" && localYShift > 0) {
          mapped = {
            ...mapped,
            position: { ...mapped.position, y: mapped.position.y + localYShift },
          };
        }
        // Ghost nodes whose deployment has been scaled down by a copy target
        if (scaleDownTargets.has(mapped.id)) {
          mapped = {
            ...mapped,
            style: {
              ...mapped.style,
              opacity: 0.25,
              border: "2px dashed #CBD5E1",
              filter: "grayscale(100%)",
            },
            data: {
              ...mapped.data,
              description: mapped.data.description ? `${mapped.data.description} (scaled down)` : "(scaled down)",
            },
          };
        }
        return mapped;
      });
    nodes.push(...shiftedArchNodes);
    nodes.push(...dynamicAgentNodes);
    nodes.push(...kafkaTopicNodes);
    nodes.push(...sqsQueueNodes);
    nodes.push(...pgBranchNodes);
    nodes.push(...previewSessionNodes);
    // Add dynamic local machine nodes with localYShift applied
    if (hasDynamicLocalMachines) {
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
  }, [visibleArchitectureNodes, dynamicAgentNodes, dynamicClusterZoneNode, localYShift, kafkaTopicNodes, sqsQueueNodes, pgBranchNodes, previewSessionNodes, previewSessionZoneNodes, hasDynamicLocalMachines, hasShopSessions, dynamicLocalMachineNodes, dynamicLocalZoneNodes, scaleDownTargets, sortedAgentGroups, operatorSessions]);

  const snapshotBaseUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL || "http://localhost:8080";
    return base.replace(/\/$/, "");
  }, []);

  const mockQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (useMultipleSessionMock) params.set("multipleSessionMock", "true");
    else if (useQueueSplittingMock) params.set("queueSplittingMock", "true");
    if (useDbBranchMock) params.set("dbBranchMock", "true");
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [useQueueSplittingMock, useDbBranchMock, useMultipleSessionMock]);

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
      console.log("Operator status response:", body);
      if (isMountedRef.current) {
        setOperatorSessions(body.sessions ?? []);
        setKafkaTopics(body.kafkaTopics ?? []);
        setSqsQueues(body.sqsQueues ?? []);
        setPgBranches(body.pgBranches ?? []);
        setPreviewSessions(body.previewSessions ?? []);
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
          (change.id.startsWith("agent-") || change.id.startsWith("kafka-topic-") || change.id.startsWith("kafka-deployed-topic-") || change.id.startsWith("sqs-queue-") || change.id.startsWith("sqs-deployed-queue-") || change.id.startsWith("dynamic-local-") || change.id.startsWith("dynamic-layer-") || change.id.startsWith("pg-branch-") || change.id.startsWith("preview-"));
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

  // When shop-namespace sessions are active, add highlight (glow) to local-process and mirrord-layer.
  // mirrord-layer is hidden when no shop sessions exist.
  useEffect(() => {
    setArchitectureNodesState((nodes) =>
      nodes.map((node) => {
        if (node.id === "local-process" || node.id === "mirrord-layer") {
          const baseStyle = { ...(originalNodeStyles.get(node.id) ?? {}) };
          const styleWithGlow = hasShopSessions
            ? {
                ...baseStyle,
                opacity: 1,
                boxShadow: "0px 30px 60px rgba(124,58,237,0.35)",
              }
            : { ...baseStyle, opacity: 1 };
          const dataWithHighlight = hasShopSessions
            ? { ...node.data, highlight: true as const }
            : { ...node.data, highlight: undefined };
          return {
            ...node,
            hidden: node.id === "mirrord-layer" ? !hasShopSessions : false,
            style: styleWithGlow,
            data: dataWithHighlight,
          };
        }
        return node;
      }),
    );
  }, [hasShopSessions]);

  // Auto-close the focused view when its session disappears.
  useEffect(() => {
    if (!focusedSession) return;
    const stillActive = agentGroups.some(
      (g) => `agent-${sanitizeHostname(g.targetName)}` === focusedSession.agentId,
    );
    if (!stillActive) setFocusedSession(null);
  }, [agentGroups, focusedSession]);

  /**
   * In focused mode: filter edges to only those directly relevant to the story
   * (upstream→target, target→downstream, agent↔target, mirrord infra).
   * In steal mode: dim upstream→target and replace with bold steal arrows.
   */
  const focusedFlowEdges = useMemo((): Edge[] => {
    if (!focusedSession || !focusedViewData) return flowEdges;

    const { targetArchId, upstreamIds, downstreamIds, layerId, pgBranchId } = focusedViewData;
    const agentId = focusedSession.agentId;
    const edgeLabelDefaults = {
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 10,
      labelShowBg: true,
    };

    const activeQueueSplits = focusedViewData.activeQueueSplits;
    const queueSplitProducerIds = new Set(activeQueueSplits.map((s) => s.producerId));

    // Exclude the existing agent→target edge in all focused modes — we replace it
    // with a correctly-directed edge that tells the right story.
    const isRelevantEdge = (edge: Edge): boolean => {
      // Always exclude any edge that touches a pg-branch node — those are handled
      // separately by dbBranchEdges so the non-focused versions don't float in space.
      if (
        edge.source.startsWith("pg-branch-") ||
        edge.target.startsWith("pg-branch-")
      ) return false;
      // When a queue split is active for this session, hide the direct producer→target
      // edge — it's replaced by the producer→operator→{filtered,fallback}→{layer,target}
      // story rendered by queueSplitEdges below.
      if (
        queueSplitProducerIds.has(edge.source) &&
        edge.target === targetArchId
      ) return false;
      if (upstreamIds.has(edge.source) && edge.target === targetArchId) return true;
      if (edge.source === targetArchId && downstreamIds.has(edge.target)) return true;
      // agent→target and local↔layer edges are excluded:
      // agent→target is replaced with a corrected direction edge below;
      // local→layer is internal to the combined local node.
      return false;
    };

    // Handles for the layer node — static and dynamic variants use different ids.
    const layerSourceHandle =
      layerId === "mirrord-layer" ? "layer-source-right" : `${layerId}-source-right`;

    // Tunnel edge: agent → mirrord-layer.
    // The mirrord-layer is the actual tunnel endpoint on the local side — it receives
    // intercepted/copied traffic from the agent and delivers it to the local process
    // via LD_PRELOAD syscall interception.
    // Handles for the agent → layer tunnel — agent exits from bottom, layer receives on top.
    const agentSourceHandle = `${agentId}-source-bottom`;
    const layerTargetHandleForTunnel =
      layerId === "mirrord-layer" ? "layer-target-top" : `${layerId}-target-top`;

    const tunnelEdge: Edge = {
      id: `focused-tunnel-${agentId}-to-${layerId}`,
      source: agentId,
      target: layerId,
      sourceHandle: agentSourceHandle,
      targetHandle: layerTargetHandleForTunnel,
      label: "mirrord tunnel",
      type: "bezier",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      style: { stroke: "#E66479", strokeWidth: 2.5, strokeDasharray: "6 4" },
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "#E66479" },
      labelBgStyle: { fill: "#FFF1F3" },
      ...edgeLabelDefaults,
    };

    // When a db-branch is active, the local service uses the branched DB instead of the
    // original. Find the postgres downstream that the branch targets.
    const pgPostgresId = pgBranchId
      ? [...downstreamIds].find((id) => id.startsWith("postgres-"))
      : null;

    // Outbound edges: mirrord-layer → downstream services.
    // When db-branch is active, skip postgres (replaced by layer→pgBranch below).
    const layerToDownstreamEdges: Edge[] = [...downstreamIds]
      .filter((id) => !(pgBranchId && id === pgPostgresId))
      .map((downstreamId) => ({
        id: `focused-layer-to-${downstreamId}`,
        source: layerId,
        target: downstreamId,
        sourceHandle: layerSourceHandle,
        label: "outbound via mirrord",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: "#E66479", strokeWidth: 2, strokeDasharray: "6 4" },
        labelStyle: { fontSize: 11, fontWeight: 600, fill: "#E66479" },
        labelBgStyle: { fill: "#FFF1F3" },
        ...edgeLabelDefaults,
      }));

    // Db-branch edges: layer → pg-branch (local uses branch) + postgres → pg-branch (copy from top).
    const activeBranch = focusedViewData.activeBranch;
    const dbBranchEdges: Edge[] = pgBranchId && pgPostgresId && activeBranch
      ? [
          {
            id: `focused-layer-to-${pgBranchId}`,
            source: layerId,
            target: pgBranchId,
            sourceHandle: layerSourceHandle,
            targetHandle: `${pgBranchId}-target-left`,
            label: "use branch DB",
            type: "bezier",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
            style: { stroke: "#DC2626", strokeWidth: 2.5, strokeDasharray: "6 4" },
            labelStyle: { fontSize: 12, fontWeight: 700, fill: "#DC2626" },
            labelBgStyle: { fill: "#FEF2F2" },
            ...edgeLabelDefaults,
          },
          {
            id: `focused-${pgPostgresId}-to-${pgBranchId}`,
            source: pgPostgresId,
            target: pgBranchId,
            sourceHandle: "source-bottom",
            targetHandle: `${pgBranchId}-target-top`,
            label: `Copy mode: ${activeBranch.copyMode}`,
            type: "smoothstep",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
            style: { stroke: "#DC2626", strokeWidth: 2.5, strokeDasharray: "6 4" },
            labelStyle: { fontSize: 12, fontWeight: 600, fill: "#DC2626" },
            labelBgStyle: { fill: "#FEF2F2" },
            ...edgeLabelDefaults,
          },
        ]
      : [];

    // --- Focused queue split edges ----------------------------------------------
    // Reuse the existing "mirrored" intent palette so the visual language matches
    // the non-focused queue split rendering.
    const queueSplitEdges: Edge[] = [];
    const queueMirroredColor = intentStyles.mirrored.color;
    const queueMirroredDash = intentStyles.mirrored.dash;
    for (const split of activeQueueSplits) {
      // producer → operator
      queueSplitEdges.push({
        id: `focused-${split.producerId}-to-operator`,
        source: split.producerId,
        target: "mirrord-operator",
        sourceHandle: "source-bottom",
        targetHandle: "operator-target-top",
        label: "consume messages",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: queueMirroredColor, strokeWidth: 2.5, strokeDasharray: queueMirroredDash },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        labelBgStyle: { fill: "#FFFFFF" },
        ...edgeLabelDefaults,
      });
      // operator → filtered
      queueSplitEdges.push({
        id: `focused-operator-to-${split.filteredId}`,
        source: "mirrord-operator",
        target: split.filteredId,
        sourceHandle: "operator-source-bottom",
        targetHandle: `${split.filteredId}-target-top`,
        label: "matching filter",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: queueMirroredColor, strokeWidth: 2.5, strokeDasharray: queueMirroredDash },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        labelBgStyle: { fill: "#FFFFFF" },
        ...edgeLabelDefaults,
      });
      // filtered → layer (combined local node)
      queueSplitEdges.push({
        id: `focused-${split.filteredId}-to-${layerId}`,
        source: split.filteredId,
        target: layerId,
        sourceHandle: `${split.filteredId}-source-bottom`,
        targetHandle: layerId === "mirrord-layer" ? "layer-target-top" : `${layerId}-target-top`,
        label: "consume messages",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: queueMirroredColor, strokeWidth: 2.5, strokeDasharray: queueMirroredDash },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        labelBgStyle: { fill: "#FFFFFF" },
        ...edgeLabelDefaults,
      });
      // operator → fallback
      queueSplitEdges.push({
        id: `focused-operator-to-${split.fallbackId}`,
        source: "mirrord-operator",
        target: split.fallbackId,
        sourceHandle: "operator-source-bottom",
        targetHandle: `${split.fallbackId}-target-left`,
        label: "not matching filter",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: queueMirroredColor, strokeWidth: 2.5, strokeDasharray: queueMirroredDash },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        labelBgStyle: { fill: "#FFFFFF" },
        ...edgeLabelDefaults,
      });
      // fallback → target service
      queueSplitEdges.push({
        id: `focused-${split.fallbackId}-to-${targetArchId}`,
        source: split.fallbackId,
        target: targetArchId,
        sourceHandle: `${split.fallbackId}-source-top`,
        targetHandle: "target-bottom",
        label: "consume messages",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: queueMirroredColor, strokeWidth: 2.5, strokeDasharray: queueMirroredDash },
        labelStyle: { fontSize: 12, fontWeight: 600, fill: "#0F172A" },
        labelBgStyle: { fill: "#FFFFFF" },
        ...edgeLabelDefaults,
      });
    }

    if (focusedMode === "mirror") {
      // Mirror: traffic hits the service normally AND the agent sniffs a copy from
      // the pod's network interface and sends it through the tunnel to mirrord-layer.
      // Both the cluster service and the local process (via layer) talk to downstream services.
      const mirrorCopyEdge: Edge = {
        id: `focused-mirror-${targetArchId}-to-${agentId}`,
        source: targetArchId,
        target: agentId,
        targetHandle: `${agentId}-target-top`,
        label: "traffic copy",
        type: "bezier",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
        style: { stroke: "#4F46E5", strokeWidth: 2.5, strokeDasharray: "6 4" },
        labelStyle: { fontSize: 12, fontWeight: 700, fill: "#4F46E5" },
        labelBgStyle: { fill: "#EEF2FF" },
        ...edgeLabelDefaults,
      };
      // Keep pgBranchEdges in the array but hidden so React Flow doesn't orphan DOM elements.
      const hiddenPgBranchEdges = pgBranchEdges.map((e) => ({ ...e, hidden: true }));
      return [
        ...flowEdges.filter(isRelevantEdge),
        ...hiddenPgBranchEdges,
        mirrorCopyEdge,
        tunnelEdge,
        ...layerToDownstreamEdges,
        ...dbBranchEdges,
        ...queueSplitEdges,
      ];
    }

    // Steal mode: traffic is intercepted by the agent BEFORE reaching the service.
    // upstream → agent (stolen), service receives nothing and makes no outbound calls.
    // Only the local process talks to downstream services.
    const result: Edge[] = [];
    for (const edge of flowEdges) {
      if (!isRelevantEdge(edge)) continue;

      const isUpstreamToTarget =
        upstreamIds.has(edge.source) && edge.target === targetArchId;
      const isTargetToDownstream =
        edge.source === targetArchId && downstreamIds.has(edge.target);

      if (isUpstreamToTarget) {
        // Dim the original upstream→target edge — traffic no longer flows through it
        result.push({
          ...edge,
          animated: false,
          label: "no traffic",
          style: { stroke: "#CBD5E1", strokeWidth: 1.5, strokeDasharray: "4 4" },
          labelStyle: { fontSize: 11, fill: "#94A3B8" },
          labelBgStyle: { fill: "#F9FAFB" },
        });
        // Bold steal edge: upstream → agent (traffic intercepted before reaching service)
        result.push({
          id: `focused-steal-${edge.source}-to-${agentId}`,
          source: edge.source,
          target: agentId,
          targetHandle: `${agentId}-target-top`,
          label: "traffic stolen",
          type: "bezier",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
          style: { stroke: "#EA580C", strokeWidth: 3 },
          labelStyle: { fontSize: 12, fontWeight: 700, fill: "#EA580C" },
          labelBgStyle: { fill: "#FFF7ED" },
          ...edgeLabelDefaults,
        });
        continue;
      }

      // Service→downstream edges are skipped in steal mode — the service gets no
      // traffic so it makes no outbound calls. Local process edges added below.
      if (isTargetToDownstream) continue;

      result.push(edge);
    }
    // Keep pgBranchEdges in the array but hidden so React Flow doesn't orphan DOM elements.
    const hiddenPgBranchEdges = pgBranchEdges.map((e) => ({ ...e, hidden: true }));
    return [...result, ...hiddenPgBranchEdges, tunnelEdge, ...layerToDownstreamEdges, ...dbBranchEdges, ...queueSplitEdges];
  }, [focusedSession, focusedViewData, focusedMode, flowEdges, pgBranchEdges]);

  /**
   * Compute a fresh dagre layout for the focused nodes so they fill the screen
   * cleanly instead of inheriting the full-graph positions.
   * Uses a stable edge set (independent of mirror/steal mode) so the layout
   * doesn't jump when the presenter toggles the mode toggle.
   */
  const focusedNodePositions = useMemo(() => {
    if (!focusedViewData || !focusedSession) return null;
    const {
      visibleIds,
      targetArchId,
      upstreamIds,
      downstreamIds,
      localId,
      layerId,
      pgBranchId,
      activeQueueSplits,
    } = focusedViewData;
    const agentId = focusedSession.agentId;
    const queueSplitNodeIdSet = new Set<string>([
      ...activeQueueSplits.flatMap((s) => [s.filteredId, s.fallbackId]),
    ]);
    const hasQueueSplit = activeQueueSplits.length > 0;

    // Layout the main horizontal flow: upstreams → target → downstreams.
    // Agent and local node are placed manually BELOW the main row so:
    //   - the agent doesn't block the target→downstream edge
    //   - the local zone sits below (and outside) the cluster zone bounds
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 160 });

    // Only the service-mesh nodes go into dagre — agent, local, pg-branch, and the
    // queue split satellite nodes (operator + filtered + fallback) are placed manually.
    const dagreIds = [...visibleIds].filter(
      (id) =>
        id !== localId &&
        id !== layerId &&
        id !== agentId &&
        id !== pgBranchId &&
        id !== "mirrord-operator" &&
        !queueSplitNodeIdSet.has(id),
    );
    for (const id of dagreIds) {
      g.setNode(id, { width: nodeWidth, height: nodeHeight });
    }
    for (const upId of upstreamIds) g.setEdge(upId, targetArchId);
    for (const downId of downstreamIds) g.setEdge(targetArchId, downId);

    dagre.layout(g);

    const positions = new Map<string, { x: number; y: number }>();
    for (const id of dagreIds) {
      const node = g.node(id);
      if (node) {
        positions.set(id, { x: node.x - nodeWidth / 2, y: node.y - nodeHeight / 2 });
      }
    }

    // Shift all downstream positions right to open a full column for agent+local.
    const agentColumnWidth = nodeWidth + 60;
    for (const downId of downstreamIds) {
      const pos = positions.get(downId);
      if (pos) positions.set(downId, { x: pos.x + agentColumnWidth, y: pos.y });
    }

    // Place agent in the new gap column, 220px below the main horizontal row.
    const targetPos = positions.get(targetArchId);
    const firstDownId = [...downstreamIds][0];
    const firstDownPos = firstDownId ? positions.get(firstDownId) : undefined;

    if (targetPos) {
      const agentX = firstDownPos
        ? (targetPos.x + nodeWidth + firstDownPos.x) / 2 - nodeWidth / 2
        : targetPos.x + nodeWidth + 80;
      const agentY = targetPos.y + nodeHeight + 220;
      positions.set(agentId, { x: agentX, y: agentY });

      // Place pg-branch inside the cluster zone: same row as the agent, horizontally
      // aligned with the postgres downstream so the branch copy edge reads naturally.
      if (pgBranchId) {
        const pgPostgresId = [...downstreamIds].find((id) => id.startsWith("postgres-"));
        const postgresPos = pgPostgresId ? positions.get(pgPostgresId) : undefined;
        const pgBranchX = postgresPos ? postgresPos.x : agentX + nodeWidth + 80;
        positions.set(pgBranchId, { x: pgBranchX, y: agentY });
      }

      // --- Queue split node placement -----------------------------------------
      // Place the operator + filtered + fallback split nodes BELOW the kafka/sqs
      // producer (still inside the cluster zone). The producer sits in the main
      // upstream column on the left; we stack the operator directly under it and
      // put the filtered + fallback nodes in a row underneath the operator.
      if (hasQueueSplit) {
        const firstSplit = activeQueueSplits[0];
        const producerPos = positions.get(firstSplit.producerId);

        // Anchor the split column on the producer, falling back to a spot left
        // of the target if the producer isn't laid out for some reason.
        const anchorX = producerPos ? producerPos.x : targetPos.x - (nodeWidth + 80);
        const anchorY = producerPos ? producerPos.y : targetPos.y;

        const operatorY = anchorY + nodeHeight + 60;
        const splitRowY = operatorY + nodeHeight + 60;

        positions.set("mirrord-operator", { x: anchorX, y: operatorY });

        // Filtered nodes go on the left of the column, fallback nodes to their
        // right. With multiple splits we stack each pair downward so the cluster
        // zone simply grows to contain them.
        activeQueueSplits.forEach((split, i) => {
          const rowY = splitRowY + i * (nodeHeight + 40);
          positions.set(split.filteredId, { x: anchorX, y: rowY });
          positions.set(split.fallbackId, { x: anchorX + nodeWidth + 40, y: rowY });
        });
      }

      // Local node: below ALL cluster nodes so the local zone clears the cluster zone bottom.
      // Computed AFTER pg-branch and queue-split placement so it tracks the true cluster bottom.
      // localGap must be > localPadTop + zonePadBot (92 + 44 = 136) to avoid zone overlap.
      const clusterBottomCandidates = [...positions.entries()]
        .filter(([id]) => id !== layerId && id !== agentId)
        .map(([, p]) => p.y + nodeHeight);
      const maxClusterBottom = clusterBottomCandidates.length
        ? Math.max(...clusterBottomCandidates)
        : targetPos.y + nodeHeight;
      const localGap = 160;
      const layerY = maxClusterBottom + localGap;
      positions.set(layerId, { x: agentX, y: layerY });
    }

    return positions;
  }, [focusedViewData, focusedSession]);

  /**
   * In focused mode: hide everything else, re-layout visible nodes using
   * focusedNodePositions, and apply mode-specific visual treatments.
   * In normal mode: add pointer cursor to clickable nodes.
   */
  const displayNodes = useMemo(() => {
    if (!focusedViewData || !focusedNodePositions) {
      // Normal mode — add pointer cursor to clickable nodes when sessions are active
      if (!hasShopSessions) return flowNodes;
      return flowNodes.map((node) => {
        if (
          node.id === "local-process" ||
          node.id.startsWith("dynamic-local-") ||
          node.id.startsWith("agent-")
        ) {
          return { ...node, style: { ...node.style, cursor: "pointer" } };
        }
        return node;
      });
    }

    const { layerId, visibleIds, pgBranchId } = focusedViewData;
    const zonePadX = 48;   // horizontal padding
    const zonePadTop = 72; // extra top padding so zone header label clears nodes
    const zonePadBot = 44; // bottom padding

    // Focused mode: re-layout visible nodes, hide everything else
    return flowNodes.map((node) => {
      // Reposition zone backgrounds around the focused nodes instead of hiding them
      if (node.type === "zone") {
        // Local Machine zone: wraps just the combined local node (layerId)
        if (node.id === "zone-local") {
          const pos = focusedNodePositions.get(layerId);
          if (!pos) return { ...node, hidden: true };
          const localPadTop = zonePadTop + 20;
          const w = nodeWidth + zonePadX * 2;
          const h = nodeHeight + localPadTop + zonePadBot;
          return {
            ...node,
            hidden: false,
            position: { x: pos.x - zonePadX, y: pos.y - localPadTop },
            data: { ...node.data, zoneWidth: w, zoneHeight: h },
            style: { ...node.style, width: w, height: h },
          };
        }
        // Cluster zone: wraps all visible nodes that are NOT the local node
        if (node.id === "zone-cluster") {
          const clusterPositions = [...visibleIds]
            .filter((id) => id !== layerId)
            .map((id) => focusedNodePositions.get(id))
            .filter((p): p is { x: number; y: number } => !!p);
          if (!clusterPositions.length) return { ...node, hidden: true };
          const minX = Math.min(...clusterPositions.map((p) => p.x)) - zonePadX;
          const minY = Math.min(...clusterPositions.map((p) => p.y)) - zonePadTop;
          const maxX = Math.max(...clusterPositions.map((p) => p.x + nodeWidth)) + zonePadX;
          const maxY = Math.max(...clusterPositions.map((p) => p.y + nodeHeight)) + zonePadBot;
          const w = maxX - minX;
          const h = maxY - minY;
          return {
            ...node,
            hidden: false,
            position: { x: minX, y: minY },
            data: { ...node.data, zoneWidth: w, zoneHeight: h },
            style: { ...node.style, width: w, height: h },
          };
        }
        // Any other zone (e.g. preview zones) — hide in focused mode
        return { ...node, hidden: true };
      }

      // local-process is merged into the combined local node — hide it
      if (node.id === focusedViewData.localId) return { ...node, hidden: true };

      // Hide non-relevant nodes entirely (cleaner than dimming with a new layout)
      if (!focusedViewData.visibleIds.has(node.id)) {
        return { ...node, hidden: true };
      }

      // Apply the focused layout position (localId is excluded from dagre, so no position for it)
      const newPosition = focusedNodePositions.get(node.id);
      let mapped = {
        ...node,
        draggable: false,
        ...(newPosition ? { position: newPosition } : {}),
      };

      // Transform the mirrord-layer node into the combined "local service" node.
      // It represents both the local process and the mirrord-layer as a single entity.
      if (node.id === focusedViewData.layerId && focusedSession) {
        const combinedLabel = (
          <div className="flex flex-col gap-1.5 text-left">
            <span className="text-base font-bold text-[#111827] leading-tight">
              {focusedViewData.targetLabel}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#3B82F6]">
              Running locally
            </span>
            <p className="text-xs text-slate-600 leading-snug">
              {focusedSession.ownerUsername}
              {focusedSession.ownerHostname ? ` · ${focusedSession.ownerHostname}` : ""}
            </p>
          </div>
        );
        const glowAnimation =
          focusedMode === "mirror"
            ? "mirrordFocusMirrorPulse 2s ease-in-out infinite"
            : "mirrordFocusStealPulse 2s ease-in-out infinite";
        mapped = {
          ...mapped,
          data: { ...(mapped.data as NodeData), label: combinedLabel, focusedCombined: true },
          style: {
            ...mapped.style,
            border: "2.5px solid #3B82F6",
            backgroundColor: "rgba(191, 219, 254, 0.25)",
            animation: glowAnimation,
          },
        };
        return mapped;
      }

      // Glow on the agent — the cluster-side end of the mirrord tunnel
      if (node.id === focusedSession?.agentId) {
        const animation =
          focusedMode === "mirror"
            ? "mirrordFocusMirrorPulse 2s ease-in-out infinite"
            : "mirrordFocusStealPulse 2s ease-in-out infinite";
        mapped = { ...mapped, style: { ...mapped.style, animation } };
      }

      // Glow on the pg-branch node when db-branch is active
      if (pgBranchId && node.id === pgBranchId) {
        mapped = {
          ...mapped,
          style: {
            ...mapped.style,
            animation: "mirrordFocusDbBranchPulse 2s ease-in-out infinite",
          },
        };
      }

      // Glow on the filtered queue/topic node(s) when a queue split is active
      // for the focused session. Per spec the pulse lives on the *filtered* node
      // (the one that routes matching messages to the local process).
      if (
        focusedViewData.hasQueueSplit &&
        focusedViewData.activeQueueSplits.some((s) => s.filteredId === node.id)
      ) {
        mapped = {
          ...mapped,
          style: {
            ...mapped.style,
            animation: "mirrordFocusQueueSplitPulse 2s ease-in-out infinite",
          },
        };
      }

      // Steal mode: only dim the target service itself (it receives no traffic).
      // Downstream services stay fully visible — the local process still calls them via the layer.
      if (focusedMode === "steal" && node.id === focusedViewData.targetArchId) {
        mapped = { ...mapped, style: { ...mapped.style, opacity: 0.35, filter: "grayscale(60%)" } };
      }

      return mapped;
    });
  }, [flowNodes, focusedViewData, focusedSession, focusedMode, focusedNodePositions, hasShopSessions]);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#F5F5F5", color: "#111827", position: "relative" }}>
      <ReactFlow
        style={{ width: "100%", height: "100%" }}
        nodes={displayNodes}
        edges={focusedFlowEdges}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        elevateEdgesOnSelect={false}
        panOnScroll
        className="bg-transparent"
        proOptions={{ hideAttribution: true }}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
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
        <FocusedFitView
          visibleNodeIds={focusedViewData ? [...focusedViewData.visibleIds] : null}
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

      {/* Focused session overlay panel */}
      {focusedSession && focusedViewData && (() => {
        const activeBranch = focusedViewData.activeBranch;
        const activeQueueSplits = focusedViewData.activeQueueSplits;
        const hasQueueSplit = focusedViewData.hasQueueSplit;
        const headerBg =
          focusPanelTab === "db-branch"
            ? "#FEF2F2"
            : focusPanelTab === "queue-split"
            ? "#FEFCE8"
            : focusPanelTab === "mirror"
            ? "#F5F3FF"
            : "#FFF7ED";
        const headerBorder =
          focusPanelTab === "db-branch"
            ? "#FECACA"
            : focusPanelTab === "queue-split"
            ? "#FDE68A"
            : focusPanelTab === "mirror"
            ? "#E0E7FF"
            : "#FFEDD5";
        const headerAccent =
          focusPanelTab === "db-branch"
            ? "#DC2626"
            : focusPanelTab === "queue-split"
            ? "#CA8A04"
            : focusPanelTab === "mirror"
            ? "#4F46E5"
            : "#EA580C";
        const headerLabel =
          focusPanelTab === "db-branch"
            ? "DB Branch Active"
            : focusPanelTab === "queue-split"
            ? "Queue Split Active"
            : focusPanelTab === "mirror"
            ? "Mirroring Session"
            : "Steal Session";

        return (
          <div
            className="absolute top-6 right-6 z-50 w-[380px] rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl overflow-hidden"
            style={{ pointerEvents: "auto" }}
          >
            {/* Header */}
            <div
              className="px-6 pt-5 pb-4"
              style={{ borderBottom: `1px solid ${headerBorder}`, background: headerBg }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.2em] mb-1"
                    style={{ color: headerAccent }}
                  >
                    {headerLabel}
                  </p>
                  <p className="text-xl font-bold text-[#111827] leading-tight">
                    {focusedViewData.targetLabel}
                  </p>
                  <p className="text-sm text-[#6B7280] mt-0.5">
                    {focusedSession.ownerUsername}
                    {focusedSession.ownerHostname ? ` · ${focusedSession.ownerHostname}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setFocusedSession(null)}
                  className="ml-4 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors text-sm font-medium flex-shrink-0"
                  title="Exit focused view"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Tab bar — extra tabs appear when db-branch and/or queue-split are active */}
            <div className="px-6 pt-4 pb-3">
              <div className="flex rounded-xl border border-[#E5E7EB] overflow-hidden">
                {activeBranch && (
                  <button
                    className="flex-1 py-2.5 text-sm font-semibold transition-all"
                    style={
                      focusPanelTab === "db-branch"
                        ? { background: "#DC2626", color: "#fff" }
                        : { background: "#fff", color: "#6B7280" }
                    }
                    onClick={() => setFocusPanelTab("db-branch")}
                  >
                    DB Branch
                  </button>
                )}
                {hasQueueSplit && (
                  <button
                    className="flex-1 py-2.5 text-sm font-semibold transition-all"
                    style={
                      focusPanelTab === "queue-split"
                        ? { background: "#CA8A04", color: "#fff" }
                        : { background: "#fff", color: "#6B7280" }
                    }
                    onClick={() => setFocusPanelTab("queue-split")}
                  >
                    Queue Split
                  </button>
                )}
                <button
                  className="flex-1 py-2.5 text-sm font-semibold transition-all"
                  style={
                    focusPanelTab === "mirror"
                      ? { background: "#4F46E5", color: "#fff" }
                      : { background: "#fff", color: "#6B7280" }
                  }
                  onClick={() => { setFocusPanelTab("mirror"); setFocusedMode("mirror"); }}
                >
                  Mirror
                </button>
                <button
                  className="flex-1 py-2.5 text-sm font-semibold transition-all"
                  style={
                    focusPanelTab === "steal"
                      ? { background: "#EA580C", color: "#fff" }
                      : { background: "#fff", color: "#6B7280" }
                  }
                  onClick={() => { setFocusPanelTab("steal"); setFocusedMode("steal"); }}
                >
                  Steal
                </button>
              </div>
            </div>

            {/* Panel content */}
            <div className="px-6 pb-6">
              {focusPanelTab === "queue-split" && hasQueueSplit ? (
                <>
                  <div className="rounded-xl p-4 text-sm leading-relaxed bg-[#FEFCE8] text-[#713F12]">
                    <p>
                      The mirrord operator is splitting incoming messages for{" "}
                      <strong>{focusedViewData.targetLabel}</strong>. Messages matching
                      the active filter are routed to{" "}
                      <strong>{focusedSession.ownerUsername}</strong>&apos;s local
                      process; everything else continues to flow to the cluster service
                      unchanged. The producer and consumers are unaware of the split.
                    </p>
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    {activeQueueSplits.map((split) => (
                      <div
                        key={`${split.kind}-${split.label}`}
                        className="rounded-lg border border-[#FDE68A] bg-white p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#CA8A04]">
                            {split.kind === "kafka" ? "Kafka topic" : "SQS queue"}
                          </span>
                          <span className="font-mono text-[10px] text-[#9CA3AF]">
                            {split.sessionId.substring(0, 8)}
                          </span>
                        </div>
                        <p className="mt-1 font-semibold text-[#111827] break-all">
                          {split.label}
                        </p>
                        {split.filter && (
                          <p
                            className="mt-2 font-mono text-[11px] text-[#6B7280] truncate"
                            title={split.filter}
                          >
                            filter: {split.filter}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : focusPanelTab === "db-branch" && activeBranch ? (
                <>
                  <div className="rounded-xl p-4 text-sm leading-relaxed bg-[#FEF2F2] text-[#7F1D1D]">
                    <p>
                      <strong>{focusedSession.ownerUsername}</strong>&apos;s local service is
                      connected to a branched copy of the database. The cluster service continues
                      to use the original database unaffected.
                    </p>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#6B7280]">Branch ID</span>
                      <span className="font-medium text-[#111827] font-mono text-xs">{activeBranch.branchId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7280]">Phase</span>
                      <span
                        className="font-semibold text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: activeBranch.phase === "Ready" ? "#DCFCE7" : "#FEF9C3",
                          color: activeBranch.phase === "Ready" ? "#166534" : "#854D0E",
                        }}
                      >
                        {activeBranch.phase}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7280]">Copy mode</span>
                      <span className="font-medium text-[#111827]">{activeBranch.copyMode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7280]">Postgres version</span>
                      <span className="font-medium text-[#111827]">{activeBranch.postgresVersion}</span>
                    </div>
                    {activeBranch.expireTime && (
                      <div className="flex justify-between">
                        <span className="text-[#6B7280]">Expires</span>
                        <span className="font-medium text-[#111827]">
                          {new Date(activeBranch.expireTime).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="rounded-xl p-4 text-sm leading-relaxed"
                    style={
                      focusedMode === "mirror"
                        ? { background: "#EEF2FF", color: "#3730A3" }
                        : { background: "#FFF7ED", color: "#9A3412" }
                    }
                  >
                    {focusedMode === "mirror" ? (
                      <p>
                        Traffic continues to flow to{" "}
                        <strong>{focusedViewData.targetLabel}</strong> in the cluster as
                        normal. A copy of every incoming request is also delivered to{" "}
                        <strong>{focusedSession.ownerUsername}</strong>&apos;s local process.
                        The cluster service is unaware of the mirroring.
                      </p>
                    ) : (
                      <p>
                        All traffic that would normally reach{" "}
                        <strong>{focusedViewData.targetLabel}</strong> is being redirected to{" "}
                        <strong>{focusedSession.ownerUsername}</strong>&apos;s local machine
                        instead. The cluster service receives no requests while this session
                        is active.
                      </p>
                    )}
                  </div>
                </>
              )}
              <p className="mt-3 text-[11px] text-[#9CA3AF] text-center">
                Click an agent or local machine node to switch sessions
              </p>
            </div>
          </div>
        );
      })()}

      {/* Hint shown on agent/local nodes when sessions are active but no focused view */}
      {hasShopSessions && !focusedSession && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="rounded-full border border-[#E5E7EB] bg-white/95 px-4 py-2 text-xs font-medium text-[#6B7280] shadow-md">
            Click an agent or local machine node to focus a session
          </div>
        </div>
      )}

      {dbDialogId && (
        <DatabaseViewerDialog
          dbId={dbDialogId}
          onClose={() => setDbDialogId(null)}
        />
      )}
    </div>
  );
}
