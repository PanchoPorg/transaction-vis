"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import { clsx } from "clsx";
import { edgeColor } from "./edge-style";
import { transferPath } from "./edge-path";
import type { TransferFlowEdge } from "./types";

export function TransferEdge(props: EdgeProps<TransferFlowEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
    markerEnd,
    selected,
  } = props;
  const { path, labelX, labelY, labelWidth, labelHeight } = transferPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    routeY: data?.routeY ?? (sourceY + targetY) / 2,
    label: data?.label ?? "",
    labelBias: data?.labelBias ?? 0.5,
    sourceCurveMode: data?.sourceCurveMode ?? "default",
    targetCurveMode: data?.targetCurveMode ?? "default",
  });
  const color = edgeColor(data);
  const dashed = data?.kinds.includes("topLevelCall");

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={30}
        style={{
          stroke: color,
          strokeWidth: selected ? 4.6 : 3,
          strokeDasharray: dashed ? "8 8" : undefined,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          filter: selected ? `drop-shadow(0 0 5px ${color})` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          className={clsx(
            "nodrag nopan absolute whitespace-nowrap bg-transparent px-1 py-0.5 text-left font-mono text-[12px] font-semibold leading-none shadow-none",
            selected
              ? "text-tx-accent-pale"
              : data?.kinds.includes("erc20")
                ? "text-tx-erc20-label"
                : data?.kinds.includes("topLevelCall") || data?.kinds.includes("native")
                  ? "text-tx-native-label"
                  : "text-tx-secondary",
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            width: labelWidth,
            height: labelHeight,
            pointerEvents: "all",
            textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)",
          }}
          type="button"
        >
          {data?.label ?? ""}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
