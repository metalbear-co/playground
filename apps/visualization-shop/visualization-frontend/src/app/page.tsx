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
  label: ReactNode;
  group: ArchitectureNode["group"];
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
        label: (
          <div className="flex flex-col gap-1 text-left">
            <span className="text-sm font-semibold text-slate-900">
              {node.label}
            </span>
            {node.stack && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {node.stack}
              </span>
            )}
            <p className="text-xs leading-snug text-slate-600">{node.description}</p>
            {node.repoPath && (
              <span className="text-[11px] text-slate-400">{node.repoPath}</span>
            )}
          </div>
        ),
      },
      style: {
        padding: 14,
        borderRadius: 18,
        border: `2px solid ${palette.border}`,
        backgroundColor: palette.background,
        color: palette.text,
        boxShadow: "0px 20px 45px rgba(15, 23, 42, 0.15)",
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
      type: isMirrordNode ? "mirrord" : undefined,
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
        edgeType = "smoothstep";
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
        edgeType = "smoothstep";
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
        width: 20,
        height: 20,
      },
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
  sessions: SessionStatus[];
};

/**
 * Snapshot session payload returned by the backend (mirrord agents resolved to workloads).
 */
type SessionStatus = {
  id: string;
  podName: string;
  namespace: string;
  targetWorkload?: string;
  lastUpdated: string;
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
      },
      style: {
        width: Math.max(...maxX) - Math.min(...xs) + padding * 2,
        height: Math.max(...maxY) - Math.min(...ys) + padding * 2,
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
const MIRRORD_OPERATOR_SHIFT_X = 480;
const MIRRORD_OPERATOR_SHIFT_Y = 100;
const MIRRORD_AGENT_SHIFT_X = 200;
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
  const clusterCenterX = (clusterBounds.minX + clusterBounds.maxX) / 2;
  const localCenterX = (localBounds.minX + localBounds.maxX) / 2;
  const offsetX = clusterCenterX - localCenterX;
  const offsetY = clusterBounds.maxY + LOCAL_ZONE_GAP_Y - localBounds.minY;
  return {
    x: offsetX + LOCAL_ZONE_ADJUSTMENT.x,
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

const initialZoneNodes = buildZoneNodes(adjustedNodes);
const clusterZoneNode = initialZoneNodes.find((node) => node.id === "zone-cluster");
const localZoneNode = initialZoneNodes.find((node) => node.id === "zone-local");

const SESSION_NODE_IDS = new Set([
  "mirrord-layer",
  "local-process",
  "mirrord-agent",
]);

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

/**
 * Produce variant strings for a snapshot target (namespace/name, pod name, base workload name…).
 */
const extractTargetAliases = (rawTarget: string): string[] => {
  const normalized = rawTarget.toLowerCase();
  const aliases = new Set<string>([normalized]);
  const parts = normalized.split("/").filter(Boolean);
  parts.forEach((part) => aliases.add(part));
  const last = parts[parts.length - 1];
  if (last && /-[a-z0-9]{4,}$/.test(last)) {
    aliases.add(last.replace(/-[a-z0-9]{4,}$/, ""));
  }
  return Array.from(aliases);
};

const initialArchitectureNodes: Node<NodeData>[] = adjustedNodes.map((node) =>
  SESSION_NODE_IDS.has(node.id) ? { ...node, hidden: true } : node,
);

const originalNodeStyles = new Map<string, Node<NodeData>["style"]>();
adjustedNodes.forEach((node) => {
  if (!originalNodeStyles.has(node.id)) {
    originalNodeStyles.set(node.id, node.style ? { ...node.style } : undefined);
  }
});

/**
 * Presentational node used for cluster/local zones. Rendered as a non-interactive background card.
 */
const ZoneNode = ({ data }: NodeProps<ClusterZoneNode>) => (
  <div
    className="flex h-full w-full flex-col justify-between rounded-[40px] border border-dashed px-8 py-6"
    style={{
      borderColor: data.border,
      background: data.background,
      color: "#0F172A",
    }}
  >
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#4F46E5]">
        {data.label}
      </p>
      <p className="mt-1 text-sm text-[#374151]">{data.description}</p>
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
 * Custom renderer for mirrord-specific nodes (layer, agent, operator). Adds XYFlow handles and styling.
 */
const MirrordNode = ({ id }: NodeProps<MirrordNodeType>) => {
  const info = architectureNodes.find((node) => node.id === id);
  const palette = groupPalette.mirrord;
  const isLayer = id === "mirrord-layer";
  const isAgent = id === "mirrord-agent";
  const label = info?.label ?? id;
  const stack = info?.stack;
  const description = info?.description;

  return (
    <div
      className="flex h-full w-full flex-col justify-between whitespace-normal rounded-[18px] border border-solid px-4 py-4 text-left shadow-md"
      style={{
        borderColor: palette.border,
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
      {isAgent && (
        <>
          <Handle type="target" position={Position.Left} id="agent-target-left" style={handleStyle} />
          <Handle type="target" position={Position.Bottom} id="agent-target-bottom" style={handleStyle} />
          <Handle type="source" position={Position.Right} id="agent-source-right" style={handleStyle} />
        </>
      )}
      <div className="flex flex-col gap-1 text-left">
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        {stack && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {stack}
          </span>
        )}
        {description && (
          <p className="text-xs leading-snug text-slate-600">{description}</p>
        )}
      </div>
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
  const nodeTypes = useMemo(() => ({ zone: ZoneNode, mirrord: MirrordNode }), []);
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
  const hasSessions = useMemo(
    () => (snapshot?.sessions ?? []).length > 0,
    [snapshot],
  );
  const aliasIndex = useMemo(() => buildAliasIndex(), []);
  // Match active mirrord sessions to architecture node ids so the agent edge can be rewired.
  const targetedNodeId = useMemo(() => {
    const sessions = snapshot?.sessions ?? [];
    for (const session of sessions) {
      const target = session.targetWorkload;
      if (!target) {
        continue;
      }
      const variants = extractTargetAliases(target);
      for (const variant of variants) {
        const nodeId = aliasIndex.get(variant);
        if (nodeId) {
          return nodeId;
        }
      }
    }
    return undefined;
  }, [snapshot, aliasIndex]);
  // Rebuild edges when session state changes, swapping the agent target dynamically.
  const flowEdges = useMemo(() => {
    const remappedEdges = baseEdges.map((edge) => {
      if (edge.id === "agent-to-target" && targetedNodeId) {
        const targetExists = visibleArchitectureNodes.some(
          (node) => node.id === targetedNodeId,
        );
        if (targetExists) {
          return { ...edge, target: targetedNodeId };
        }
      }
      return edge;
    });
    return remappedEdges.filter((edge) => {
      if (SESSION_NODE_IDS.has(edge.source) || SESSION_NODE_IDS.has(edge.target)) {
        return hasSessions;
      }
      return true;
    });
  }, [baseEdges, hasSessions, targetedNodeId, visibleArchitectureNodes]);

  // Merge static zone overlays with the current architecture nodes.
  const flowNodes = useMemo(() => {
    const nodes: Node<NodeData | ZoneNodeData>[] = [];
    if (clusterZoneNode) {
      nodes.push(clusterZoneNode);
    }
    if (hasSessions && localZoneNode) {
      nodes.push(localZoneNode);
    }
    nodes.push(...visibleArchitectureNodes);
    return nodes;
  }, [visibleArchitectureNodes, hasSessions]);

  const snapshotBaseUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ?? "http://localhost:8080";
    return base.replace(/\/$/, "");
  }, []);

  const snapshotUrl = useMemo(
    () => `${snapshotBaseUrl}/snapshot`,
    [snapshotBaseUrl],
  );

  // React to session changes by toggling mirrord node visibility and styling.
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
          sessions: body.sessions ?? [],
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

  // React to session changes by toggling mirrord node visibility and styling.
  useEffect(() => {
    const sessions = snapshot?.sessions ?? [];
    const hasSessions = sessions.length > 0;

    setArchitectureNodesState((nodes) =>
      nodes.map((node) => {
        const baseStyle = { ...(originalNodeStyles.get(node.id) ?? {}) };

        if (node.id === "mirrord-layer" || node.id === "mirrord-agent") {
          const styleWithGlow = hasSessions
            ? {
                ...baseStyle,
                opacity: 1,
                boxShadow: "0px 30px 60px rgba(230,100,121,0.35)",
                border: "3px solid #E66479",
              }
            : {
                ...baseStyle,
                opacity: 1,
              };

          return {
            ...node,
            hidden: !hasSessions,
            style: styleWithGlow,
          };
        }

        if (node.id === "local-process") {
          return {
            ...node,
            hidden: !hasSessions,
            style: { ...baseStyle, opacity: 1 },
          };
        }

        return {
          ...node,
          hidden: false,
          style: {
            ...baseStyle,
            opacity: 1,
          },
        };
      }),
    );
  }, [snapshot]);

  return (
    <div className="flex h-screen w-screen bg-[#F5F5F5] text-[#111827]">
      <ReactFlow
        style={{ width: "100%", height: "100%" }}
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        elevateEdgesOnSelect={false}
        panOnScroll
        className="!bg-white"
        proOptions={{ hideAttribution: true }}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
      >
        <Background color="#E9E4FF" gap={24} size={2} />
        <Controls
          showInteractive={false}
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
                {snapshot.sessions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                      Active mirrord sessions ({snapshot.sessions.length})
                    </p>
                    <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#F5F3FF] p-2">
                      {snapshot.sessions.map((session) => (
                        <div key={session.id} className="mb-2 last:mb-0">
                          <p className="text-xs font-semibold text-[#E66479]">
                            Target • {session.targetWorkload ?? "Unknown workload"}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            Pod {session.podName} in {session.namespace}
                          </p>
                          <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                            Updated {new Date(session.lastUpdated).toLocaleTimeString()}
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
