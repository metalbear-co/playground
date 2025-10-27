"use client";

import "@xyflow/react/dist/style.css";

import dagre from "dagre";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  architectureEdges,
  architectureNodes,
  architectureZones,
  groupPalette,
  type ArchitectureEdge,
  type ArchitectureNode,
} from "@/data/architecture";

type NodeData = {
  label: ReactNode;
  group: ArchitectureNode["group"];
};

const nodeWidth = 260;
const nodeHeight = 130;

type EdgeIntent = NonNullable<ArchitectureEdge["intent"]>;

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

const buildFlowNodes = (): Node<NodeData>[] =>
  architectureNodes.map((node) => {
    const palette = groupPalette[node.group];

    return {
      id: node.id,
      data: {
        group: node.group,
        label: (
          <div className="flex flex-col gap-1 text-left">
            <p className="text-sm font-semibold text-slate-900">{node.label}</p>
            {node.stack && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {node.stack}
              </p>
            )}
            <p className="text-xs leading-snug text-slate-600">{node.description}</p>
            {node.repoPath && (
              <p className="text-[11px] text-slate-400">{node.repoPath}</p>
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
      sourcePosition:
        node.id === "mirrord-layer"
          ? Position.Top
          : node.id === "mirrord-operator"
            ? Position.Right
            : Position.Right,
      targetPosition:
        node.id === "mirrord-agent"
          ? Position.Left
          : Position.Left,
      connectable: false,
      draggable: true,
      selectable: true,
      position: { x: 0, y: 0 },
    };
  });

const buildFlowEdges = (): Edge[] =>
  architectureEdges.map((edge) => {
    const intent = edge.intent ?? "default";
    const style = intentStyles[intent];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type:
        edge.id === "layer-to-agent"
          ? "step"
          : "bezier",
      sourceHandle: edge.id === "layer-to-agent" ? "top" : undefined,
      targetHandle: edge.id === "layer-to-agent" ? "bottom" : undefined,
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

const getLayoutedElements = (nodes: Node<NodeData>[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 140, ranksep: 260 });

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

type MirrordConfigSummary = {
  path: string;
  label: string;
};

type SessionStatus = {
  id: string;
  podName: string;
  namespace: string;
  targetWorkload?: string;
  lastUpdated: string;
};

const buildZoneNodes = (nodes: Node<NodeData>[]): ClusterZoneNode[] => {
  const padding = 80;
  const zoneNodes: ClusterZoneNode[] = [];

  architectureZones.forEach((zone) => {
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

const LOCAL_ZONE_OFFSET_Y = 420;
const LOCAL_ZONE_OFFSET_X = 1000;

const adjustedNodes = layoutedNodes.map((node) => {
  const zone = nodeZoneIndex.get(node.id);
  if (zone === "local") {
    return {
      ...node,
      position: {
        x: node.position.x + LOCAL_ZONE_OFFSET_X,
        y: node.position.y + LOCAL_ZONE_OFFSET_Y,
      },
    };
  }
  return node;
});

const zoneNodes = buildZoneNodes(adjustedNodes);

const initialFlowNodes: Node[] = [...zoneNodes, ...adjustedNodes];

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

const legendItems = [
  { label: "Entry / Client", color: groupPalette.entry.border },
  { label: "Frontend", color: groupPalette.frontend.border },
  { label: "Core services", color: groupPalette.service.border },
  { label: "Data services", color: groupPalette.data.border },
  { label: "Queues & Streams", color: groupPalette.queue.border },
  { label: "mirrord control plane", color: groupPalette.mirrord.border },
];

export default function Home() {
  const nodeTypes = useMemo(() => ({ zone: ZoneNode }), []);
  const [flowNodes, setFlowNodes] = useState<Node[]>(() => initialFlowNodes);
  const [flowEdges] = useState<Edge[]>(() => layoutedEdges);
  const [snapshot, setSnapshot] = useState<ClusterSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [configSummaries, setConfigSummaries] = useState<MirrordConfigSummary[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [selectedConfigPath, setSelectedConfigPath] = useState<string>("");
  const [plannedTargets, setPlannedTargets] = useState<Set<string>>(() => new Set());
  const [plannedTargetList, setPlannedTargetList] = useState<string[]>([]);
  const [plannedError, setPlannedError] = useState<string | null>(null);

  const snapshotUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ?? "http://localhost:8080";
    return `${base.replace(/\/$/, "")}/snapshot`;
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchSnapshot = async () => {
      try {
        const response = await fetch(snapshotUrl, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Snapshot request failed (${response.status})`);
        }
        const body = (await response.json()) as Partial<ClusterSnapshot>;
        if (!isMounted) {
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
        if (!isMounted) {
          return;
        }
        setSnapshotError((error as Error).message);
        setSnapshotLoading(false);
      }
    };

    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [snapshotUrl]);

  useEffect(() => {
    let cancelled = false;
    const loadConfigs = async () => {
      try {
        const response = await fetch("/api/mirrord-configs", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Config request failed (${response.status})`);
        }
        const body = (await response.json()) as {
          configs?: MirrordConfigSummary[];
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (body.error) {
          throw new Error(body.error);
        }
        setConfigSummaries(body.configs ?? []);
        setConfigsError(null);
      } catch (error) {
        if (!cancelled) {
          setConfigsError((error as Error).message);
        }
      } finally {
        if (!cancelled) {
          setConfigsLoading(false);
        }
      }
    };

    loadConfigs();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => setFlowNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const handleConfigSelection = useCallback(
    async (value: string) => {
      setSelectedConfigPath(value);

      if (!value) {
        setPlannedTargets(new Set());
        setPlannedTargetList([]);
        setPlannedError(null);
        return;
      }

      try {
        const response = await fetch(
          `/api/mirrord-configs?path=${encodeURIComponent(value)}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error(`Failed to load config (${response.status})`);
        }
        const body = (await response.json()) as {
          config?: unknown;
          error?: string;
        };
        if (body.error) {
          throw new Error(body.error);
        }
        const targets = extractTargetsFromConfig(body.config);
        setPlannedTargets(new Set(targets.map((target) => target.toLowerCase())));
        setPlannedTargetList(targets);
        setPlannedError(
          targets.length === 0
            ? "No deployment target found in selected config"
            : null,
        );
      } catch (error) {
        setPlannedTargets(new Set());
        setPlannedTargetList([]);
        setPlannedError((error as Error).message);
      }
    },
    [],
  );

  useEffect(() => {
    const sessions = snapshot?.sessions ?? [];
    const hasSessions = sessions.length > 0;
    const hasPlan = plannedTargets.size > 0;
    const sessionTargets = new Set(
      sessions
        .map((session) => session.targetWorkload?.toLowerCase())
        .filter((target): target is string => Boolean(target)),
    );

    setFlowNodes((nodes) =>
      nodes.map((node) => {
        if (node.type === "zone") {
          return node;
        }
        if (node.id === "mirrord-agent") {
          const updatedStyle = {
            ...(node.style ?? {}),
            opacity: hasSessions ? 1 : 0.45,
            boxShadow: hasSessions
              ? "0px 30px 60px rgba(230,100,121,0.35)"
              : "0px 10px 25px rgba(15,23,42,0.12)",
            border: hasSessions
              ? "3px solid #E66479"
              : "2px dashed rgba(148,163,184,0.8)",
          };
          return {
            ...node,
            style: updatedStyle,
          };
        }
        if (node.id === "mirrord-layer" || node.id === "local-process") {
          const active = hasSessions || hasPlan;
          const updatedStyle = {
            ...(node.style ?? {}),
            opacity: active ? 1 : 0.55,
            boxShadow: active
              ? "0px 25px 50px rgba(230,100,121,0.35)"
              : "0px 10px 25px rgba(15,23,42,0.12)",
            border: active
              ? "3px solid #E66479"
              : node.style?.border ?? "2px dashed rgba(148,163,184,0.8)",
          };
          return {
            ...node,
            style: updatedStyle,
          };
        }
        const service = snapshot?.services.find((svc) => svc.id === node.id);
        const status = service?.status ?? "unavailable";
        const isActive = status === "available";
        const isDegraded = status === "degraded";
        const nodeData = node.data as NodeData;
        const palette = groupPalette[nodeData.group];
        const baseBorderColor = palette?.border ?? "#E5E7EB";
        const borderColor = isDegraded ? "#F5B42A" : baseBorderColor;
        const borderWidth = isActive ? 3 : 2;
        const isPlanned = plannedTargets.has(node.id.toLowerCase());
        const targetHighlight = sessionTargets.has(node.id.toLowerCase());

        const updatedStyle = {
          ...(node.style ?? {}),
          opacity:
            targetHighlight || isPlanned || node.id === "mirrord-operator"
              ? 1
              : isActive
                ? 1
                : isDegraded
                  ? 0.7
                  : 0.55,
          boxShadow: isActive
            ? "0px 30px 60px rgba(79,70,229,0.35)"
            : isDegraded
              ? "0px 20px 35px rgba(245,180,42,0.35)"
              : "0px 10px 25px rgba(15,23,42,0.12)",
          border:
            targetHighlight || isPlanned
              ? `3px solid #E66479`
              : `${borderWidth}px solid ${borderColor}`,
        };
        return {
          ...node,
          style: updatedStyle,
        };
      }),
    );
  }, [snapshot, plannedTargets]);

  return (
    <div className="min-h-screen w-full bg-[#F5F5F5] px-6 py-12 text-[#111827] md:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
        <header className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#4F46E5]">
            Demo visualization
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-[#111827] md:text-5xl">
            mirrord traffic map
          </h1>
          <p className="mt-4 text-lg text-[#4B5563]">
            Visual overview of how requests move through the playground demo,
            where mirrord taps into the stack, and which services react to each
            event. Every node matches a repo in{" "}
            <code className="rounded bg-[#E9E4FF] px-2 py-1 text-sm text-[#4F46E5]">
              metalbear-co/playground
            </code>
            .
          </p>
        </header>

        <div className="h-[760px] w-full overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white shadow-[0_25px_80px_rgba(15,23,42,0.12)]">
          <ReactFlow
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
            <MiniMap
              pannable
              zoomable
              nodeStrokeColor={(n) => {
                const data = n?.data as NodeData | ZoneNodeData | undefined;
                if (data && "group" in data) {
                  return groupPalette[data.group].border;
                }
                if (data && "border" in data) {
                  return data.border;
                }
                return "#D1D5DB";
              }}
              maskColor="rgba(255,255,255,0.8)"
              nodeColor={(n) => {
                const data = n?.data as NodeData | ZoneNodeData | undefined;
                if (data && "group" in data) {
                  return groupPalette[data.group].background;
                }
                if (data && "background" in data) {
                  return data.background;
                }
                return "#E9E4FF";
              }}
            />
            <Controls
              showInteractive={false}
              className="border border-[#E5E7EB] bg-white/90 text-[#4F46E5] shadow-lg"
            />
            <Panel position="top-right" className="w-64 rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 text-sm text-[#111827] shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4F46E5]">
                mirrord config
              </p>
              {configsLoading ? (
                <p className="mt-2 text-xs text-[#6B7280]">Loading configs…</p>
              ) : (
                <select
                  value={selectedConfigPath}
                  onChange={(event) => handleConfigSelection(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-sm focus:border-[#4F46E5] focus:outline-none"
                >
                  <option value="">Select mirrord.json…</option>
                  {configSummaries.map((config) => (
                    <option key={config.path} value={config.path}>
                      {config.label}
                    </option>
                  ))}
                </select>
              )}
              {configsError && (
                <p className="mt-2 text-xs text-red-500">{configsError}</p>
              )}
              {plannedError && (
                <p className="mt-2 text-xs text-red-500">{plannedError}</p>
              )}
              {plannedTargetList.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    Planned targets
                  </p>
                  {plannedTargetList.map((target) => (
                    <p key={target} className="text-xs text-[#111827]">
                      {target}
                    </p>
                  ))}
                </div>
              )}
            </Panel>
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
            <Panel position="bottom-right" className="rounded-2xl border border-[#0F172A]/10 bg-[#111827] p-4 text-white shadow-xl">
              <p className="text-sm font-semibold text-white">How to read this</p>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-200">
                <li className="mb-1">Purple arrows = live requests.</li>
                <li className="mb-1">Gold links = data fan-out (Redis/Kafka/SQS).</li>
                <li className="mb-1">Dashed coral = mirrord mirrored path.</li>
                <li>Navy dash = mirrord control plane.</li>
              </ul>
            </Panel>
            <Panel position="bottom-left" className="rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 text-sm text-[#111827] shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4F46E5]">
                Live snapshot
              </p>
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
                  {(snapshot.sessions.length > 0 || plannedTargetList.length > 0) && (
                    <div className="mt-4 space-y-1 rounded-lg border border-[#E5E7EB] bg-white p-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                        Local process & mirrord-layer
                      </p>
                      {plannedTargetList.length > 0 && (
                        <p className="text-[11px] text-[#6B7280]">
                          mirrord-layer will hook the local binary and request access to:
                        </p>
                      )}
                      {plannedTargetList.length === 0 && snapshot.sessions.length === 0 && (
                        <p className="text-[11px] text-[#94A3B8]">
                          No planned sessions selected.
                        </p>
                      )}
                      {snapshot.sessions.length > 0 && (
                        <p className="text-[11px] text-[#6B7280]">
                          Session traffic tunnels over a port-forward between mirrord-layer and the
                          in-cluster agent.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

function extractTargetsFromConfig(config: unknown): string[] {
  if (!config || typeof config !== "object") {
    return [];
  }

  const targets = new Set<string>();
  const root = config as Record<string, unknown>;
  const target = root.target;

  if (target && typeof target === "object") {
    const pathCandidate = (target as Record<string, unknown>).path;
    if (pathCandidate && typeof pathCandidate === "object") {
      const pathMap = pathCandidate as Record<string, unknown>;
      ["deployment", "pod", "statefulset", "job"].forEach((key) => {
        const value = pathMap[key];
        if (typeof value === "string" && value.trim().length > 0) {
          targets.add(value.trim());
        }
      });
    }
  }

  return Array.from(targets);
}
