import type { TransferEdgeRecord } from "@/lib/tx/types";

type EdgeColorInput = Pick<TransferEdgeRecord, "hasFailed" | "kinds"> | null | undefined;

export const TRANSFER_ARROW_MARKER_WIDTH = 22;
export const TRANSFER_ARROW_MARKER_HEIGHT = 16;
export const TRANSFER_ARROW_MARKER_POINTS = "-8,-2.5 0,0 -8,2.5 -8,-2.5";

// Keep these values aligned with the matching graph tokens in globals.css.
export const GRAPH_COLORS = {
  failed: "#d9687f",
  native: "#8d78c4",
  mixed: "#987fb0",
  internal: "#91949d",
  erc20: "#ae78b2",
  fallback: "#83868f",
} as const;

export function edgeColor(data: EdgeColorInput) {
  if (data?.hasFailed) return GRAPH_COLORS.failed;
  if (data?.kinds.includes("native")) return GRAPH_COLORS.native;
  if (data?.kinds.includes("internal") && data?.kinds.includes("erc20")) {
    return GRAPH_COLORS.mixed;
  }
  if (data?.kinds.includes("internal")) return GRAPH_COLORS.internal;
  if (data?.kinds.includes("erc20")) return GRAPH_COLORS.erc20;
  return GRAPH_COLORS.fallback;
}

export function transferArrowMarkerId(color: string) {
  return `txflow-arrow-${color.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
