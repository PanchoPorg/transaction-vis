"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
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
import { NODE_HEIGHT, NODE_WIDTH } from "./geometry";
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
  layoutedTraceId,
  nodes,
  edges,
  canvasRef,
}: {
  traceId: string;
  layoutedTraceId: string | null;
  nodes: AddressFlowNode[];
  edges: TransferFlowEdge[];
  canvasRef: RefObject<HTMLDivElement | null>;
}) {
  const { setViewport } = useReactFlow();
  const focusedTraceRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      layoutedTraceId !== traceId ||
      focusedTraceRef.current === traceId ||
      nodes.length === 0
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      focusedTraceRef.current = traceId;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const minX = Math.min(...nodes.map((node) => node.position.x));
      const maxX = Math.max(
        ...nodes.map((node) => node.position.x + (node.width ?? NODE_WIDTH)),
      );
      const minNodeY = Math.min(...nodes.map((node) => node.position.y));
      const maxNodeY = Math.max(
        ...nodes.map((node) => node.position.y + (node.height ?? NODE_HEIGHT)),
      );
      const routeYs = edges.flatMap((edge) => edge.data?.routeY ?? []);
      const minY = Math.min(minNodeY, ...(routeYs.map((routeY) => routeY - 40)));
      const maxY = Math.max(maxNodeY, ...(routeYs.map((routeY) => routeY + 40)));
      const viewport = getViewportForBounds(
        {
          x: minX,
          y: minY,
          width: Math.max(maxX - minX, NODE_WIDTH),
          height: Math.max(maxY - minY, NODE_HEIGHT),
        },
        rect.width,
        rect.height,
        0.2,
        1.05,
        0.12,
      );

      void setViewport(viewport, { duration: 360 });
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasRef, edges, layoutedTraceId, nodes, setViewport, traceId]);

  return null;
}

function GraphCanvasInner({ trace, onSelectionChange }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AddressFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransferFlowEdge>([]);
  const [layouting, setLayouting] = useState(true);
  const [layoutedTraceId, setLayoutedTraceId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLayouting(true);
      const layouted = await layoutTrace(trace);
      if (alive) {
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
        setLayoutedTraceId(trace.tx.hash);
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
    <div ref={canvasRef} className="relative h-full min-h-[520px] overflow-hidden bg-tx-canvas">
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
          color="var(--tx-border)"
          gap={22}
          size={1.5}
          bgColor="var(--tx-canvas)"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--tx-border-strong)"
          maskColor="rgba(9, 10, 12, 0.68)"
          className="!bottom-5 !left-5 !right-auto !rounded-lg !border !border-tx-border !bg-tx-raised/95"
        />
        <Controls
          position="bottom-right"
          className="!bottom-5 !right-5 !overflow-hidden !rounded-lg !border !border-tx-border !bg-tx-raised/95 !shadow-[0_14px_36px_rgba(3,2,8,0.28)]"
        />
        <FocusViewOnTrace
          traceId={trace.tx.hash}
          layoutedTraceId={layoutedTraceId}
          nodes={nodes}
          edges={edges}
          canvasRef={canvasRef}
        />
      </ReactFlow>
      {layouting ? (
        <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full border border-tx-border bg-tx-raised/90 px-3 py-1.5 text-[11px] font-medium text-tx-secondary shadow-lg">
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
