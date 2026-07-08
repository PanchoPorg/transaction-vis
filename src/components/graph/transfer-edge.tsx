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
  const { path, labelX, labelY } = transferPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    laneIndex: data?.laneIndex ?? 0,
    laneCount: data?.laneCount ?? 1,
    fanoutIndex: data?.fanoutIndex ?? 0,
    fanoutCount: data?.fanoutCount ?? 1,
    fanoutHub: data?.fanoutHub ?? null,
    fanoutOffset: data?.fanoutOffset ?? Number.NaN,
    straightSource: data?.straightSource ?? false,
    straightTarget: data?.straightTarget ?? false,
    sourceRouteOffset: data?.sourceRouteOffset ?? null,
    targetRouteOffset: data?.targetRouteOffset ?? null,
    sourceId: data?.source ?? "",
    targetId: data?.target ?? "",
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
          strokeWidth: selected ? 5.2 : 3.4,
          strokeDasharray: dashed ? "8 8" : undefined,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          filter: selected ? `drop-shadow(0 0 8px ${color})` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          className={clsx(
            "nodrag nopan absolute w-[18ch] whitespace-nowrap bg-transparent px-1 py-0.5 text-left font-mono text-[12px] font-semibold leading-none shadow-none",
            selected
              ? "text-[#f8d09a]"
              : data?.kinds.includes("erc20")
                ? "text-[#d9dde4]"
                : data?.kinds.includes("topLevelCall") || data?.kinds.includes("native")
                  ? "text-[#81a0ff]"
                  : "text-[#d9dde4]",
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
