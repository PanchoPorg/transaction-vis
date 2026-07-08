"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { TxTraceResponse } from "@/lib/tx/types";
import { AddressNode } from "./address-node";
import {
  TRANSFER_ARROW_MARKER_HEIGHT,
  TRANSFER_ARROW_MARKER_POINTS,
  TRANSFER_ARROW_MARKER_WIDTH,
  edgeColor,
  transferArrowMarkerId,
} from "./edge-style";
import { TransferEdge } from "./transfer-edge";
import { layoutTrace } from "./layout";
import type { AddressFlowNode, GraphSelection, TransferFlowEdge } from "./types";

const nodeTypes = { address: AddressNode };
const edgeTypes = { transfer: TransferEdge };

type GraphCanvasProps = {
  trace: TxTraceResponse;
  onSelectionChange: (selection: GraphSelection) => void;
};

function TransferArrowMarkers({ edges }: { edges: TransferFlowEdge[] }) {
  const colors = useMemo(() => {
    return [...new Set(edges.map((edge) => edgeColor(edge.data)))].sort();
  }, [edges]);

  if (colors.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      focusable="false"
    >
      <defs>
        {colors.map((color) => (
          <marker
            key={color}
            id={transferArrowMarkerId(color)}
            className="txflow-arrowhead"
            markerHeight={TRANSFER_ARROW_MARKER_HEIGHT}
            markerUnits="strokeWidth"
            markerWidth={TRANSFER_ARROW_MARKER_WIDTH}
            orient="auto-start-reverse"
            refX="0"
            refY="0"
            viewBox="-10 -10 20 20"
          >
            <polyline
              className="arrowclosed"
              points={TRANSFER_ARROW_MARKER_POINTS}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ fill: color, stroke: color, strokeWidth: 1 }}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function FocusViewOnTrace({
  traceId,
  nodes,
  edges,
  canvasRef,
}: {
  traceId: string;
  nodes: AddressFlowNode[];
  edges: TransferFlowEdge[];
  canvasRef: RefObject<HTMLDivElement | null>;
}) {
  const { fitView, setViewport } = useReactFlow();
  const focusedTraceRef = useRef<string | null>(null);

  useEffect(() => {
    if (focusedTraceRef.current === traceId || nodes.length === 0) return;

    const frame = requestAnimationFrame(() => {
      focusedTraceRef.current = traceId;
      const canvas = canvasRef.current;
      const hubNode = nodes.reduce<AddressFlowNode | null>(
        (best, node) =>
          !best || node.data.transferCount > best.data.transferCount ? node : best,
        null,
      );

      if (canvas && hubNode && edges.length >= 5) {
        const rect = canvas.getBoundingClientRect();
        const nodeWidth = hubNode.width ?? 268;
        const nodeHeight = hubNode.height ?? 76;
        const hubCenterX = hubNode.position.x + nodeWidth / 2;
        const hubCenterY = hubNode.position.y + nodeHeight / 2;
        const zoom = Math.min(0.74, Math.max(0.62, rect.width / 1320));

        void setViewport(
          {
            x: rect.width * 0.36 - hubCenterX * zoom,
            y: rect.height * 0.49 - hubCenterY * zoom,
            zoom,
          },
          { duration: 360 },
        );
        return;
      }

      void fitView({ padding: 0.12, duration: 360, maxZoom: 1.05 });
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasRef, edges, fitView, nodes, setViewport, traceId]);

  return null;
}

function GraphCanvasInner({ trace, onSelectionChange }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AddressFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransferFlowEdge>([]);
  const [layouting, setLayouting] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLayouting(true);
      const layouted = await layoutTrace(trace);
      if (alive) {
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
      }
      if (alive) setLayouting(false);
    })();

    return () => {
      alive = false;
    };
  }, [setEdges, setNodes, trace]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectionChange({ type: "node", node: node.data as AddressFlowNode["data"] });
    },
    [onSelectionChange],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const data = edge.data as TransferFlowEdge["data"];
      if (!data) return;
      onSelectionChange({ type: "edge", edge: data, transfers: data.transfers });
    },
    [onSelectionChange],
  );

  return (
    <div ref={canvasRef} className="relative h-full min-h-[520px] overflow-hidden bg-[#15171b]">
      <TransferArrowMarkers edges={edges} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={() => onSelectionChange(null)}
        fitView
        minZoom={0.2}
        maxZoom={1.45}
        proOptions={{ hideAttribution: true }}
        className="txflow-canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#2b3038"
          gap={22}
          size={1.5}
          bgColor="#15171b"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor="#3c4350"
          maskColor="rgba(12, 14, 18, 0.64)"
          className="!bottom-5 !left-5 !right-auto !rounded-lg !border !border-white/10 !bg-[#202329]/95"
        />
        <Controls
          position="bottom-right"
          className="!bottom-5 !right-5 !overflow-hidden !rounded-lg !border !border-white/10 !bg-[#202329]/95 !shadow-xl"
        />
        <FocusViewOnTrace
          traceId={trace.tx.hash}
          nodes={nodes}
          edges={edges}
          canvasRef={canvasRef}
        />
      </ReactFlow>
      {layouting ? (
        <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full border border-white/10 bg-[#202329]/90 px-3 py-1.5 text-[11px] font-medium text-[#b9c0ca] shadow-lg">
          Laying out graph
        </div>
      ) : null}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
