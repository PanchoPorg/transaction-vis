import type { TransferEdgeRecord } from "@/lib/tx/types";

type EdgeColorInput = Pick<TransferEdgeRecord, "hasFailed" | "kinds"> | null | undefined;

export const TRANSFER_ARROW_MARKER_WIDTH = 22;
export const TRANSFER_ARROW_MARKER_HEIGHT = 16;
export const TRANSFER_ARROW_MARKER_POINTS = "-8,-2.5 0,0 -8,2.5 -8,-2.5";

export function edgeColor(data: EdgeColorInput) {
  if (data?.hasFailed) return "#ef4444";
  if (data?.kinds.includes("native")) return "#5872ff";
  if (data?.kinds.includes("internal") && data?.kinds.includes("erc20")) return "#6f85ff";
  if (data?.kinds.includes("internal")) return "#9ba2ad";
  if (data?.kinds.includes("erc20")) return "#d1883a";
  return "#8c96a5";
}

export function transferArrowMarkerId(color: string) {
  return `txflow-arrow-${color.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
