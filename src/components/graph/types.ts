import type { Edge, Node } from "@xyflow/react";
import type { AddressNodeRecord, TransferEdgeRecord, TransferRecord } from "@/lib/tx/types";
import type { EdgeCurveMode, GraphPortSpec } from "./geometry";

export type AddressNodeData = AddressNodeRecord &
  Record<string, unknown> & {
    ports: GraphPortSpec[];
  };

export type TransferEdgeData = TransferEdgeRecord &
  Record<string, unknown> & {
    transfers: TransferRecord[];
    fanoutHub: string | null;
    routeY: number;
    labelBias: number;
    sourceCurveMode: EdgeCurveMode;
    targetCurveMode: EdgeCurveMode;
    sourcePortRatio: number;
    targetPortRatio: number;
  };

export type AddressFlowNode = Node<AddressNodeData, "address">;
export type TransferFlowEdge = Edge<TransferEdgeData, "transfer">;

export type GraphSelection =
  | { type: "node"; node: AddressNodeRecord }
  | { type: "edge"; edge: TransferEdgeRecord; transfers: TransferRecord[] }
  | null;
