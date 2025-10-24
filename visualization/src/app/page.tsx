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
  type Edge,
  type Node,
} from "@xyflow/react";
import type { ReactNode } from "react";

import {
  architectureEdges,
  architectureNodes,
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
  request: { color: "#2563EB" },
  data: { color: "#059669" },
  mirrored: { color: "#0EA5E9", dash: "6 4", animated: true },
  control: { color: "#EA580C", dash: "2 4" },
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
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      connectable: false,
      draggable: false,
      selectable: false,
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
      type: "smoothstep",
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
      labelBgStyle: { fill: "#fff" },
      labelStyle: {
        fontSize: 12,
        fontWeight: 600,
        fill: "#475569",
      },
    };
  });

const getLayoutedElements = (nodes: Node<NodeData>[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 150 });

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

const legendItems = [
  { label: "Entry / Client", color: groupPalette.entry.border },
  { label: "Frontend", color: groupPalette.frontend.border },
  { label: "Core services", color: groupPalette.service.border },
  { label: "Data / Messaging", color: groupPalette.data.border },
  { label: "Queues & Streams", color: groupPalette.queue.border },
  { label: "mirrord control plane", color: groupPalette.mirrord.border },
];

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-slate-950 px-6 py-12 text-white md:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
        <header className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
            Demo visualization
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-white md:text-5xl">
            mirrord traffic map
          </h1>
          <p className="mt-4 text-lg text-slate-300">
            Visual overview of how requests move through the playground demo,
            where mirrord taps into the stack, and which services react to each
            event. Every node matches a repo in{" "}
            <code className="rounded bg-white/10 px-2 py-1 text-sm">
              metalbear-co/playground
            </code>
            .
          </p>
        </header>

        <div className="h-[760px] w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur">
          <ReactFlow
            nodes={layoutedNodes}
            edges={layoutedEdges}
            fitView
            minZoom={0.3}
            maxZoom={1.5}
            elevateEdgesOnSelect={false}
            panOnScroll
            className="!bg-slate-900/0"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#334155" gap={24} size={2} />
            <MiniMap
              pannable
              zoomable
              nodeStrokeColor={(n) => {
                const group = (n?.data as NodeData | undefined)?.group;
                return group ? groupPalette[group].border : "#94A3B8";
              }}
              maskColor="rgba(15,23,42,0.7)"
              nodeColor={(n) => {
                const group = (n?.data as NodeData | undefined)?.group;
                return group ? groupPalette[group].background : "#CBD5F5";
              }}
            />
            <Controls showInteractive={false} className="bg-slate-800/70" />
            <Panel position="top-left" className="rounded-2xl bg-white/90 p-4 text-slate-800 shadow-lg">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
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
            <Panel position="bottom-right" className="rounded-2xl bg-slate-900/80 p-4 text-slate-100 shadow-lg backdrop-blur">
              <p className="text-sm font-semibold text-white">How to read this</p>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-300">
                <li className="mb-1">Solid blue arrows = live requests.</li>
                <li className="mb-1">Green links = data fan-out (Redis/Kafka/SQS).</li>
                <li className="mb-1">Dashed cyan = mirrord mirrored path.</li>
                <li>Orange dash = mirrord control plane.</li>
              </ul>
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
