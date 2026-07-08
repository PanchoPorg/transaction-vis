import type { Edge, Node } from "@xyflow/react";
import type { AddressNodeRecord, TransferEdgeRecord, TransferRecord } from "@/lib/tx/types";

export type AddressNodeData = AddressNodeRecord & Record<string, unknown>;

export type TransferEdgeData = TransferEdgeRecord &
  Record<string, unknown> & {
    transfers: TransferRecord[];
    laneIndex: number;
    laneCount: number;
    fanoutIndex: number;
    fanoutCount: number;
    fanoutHub: string | null;
    fanoutOffset: number;
    straightSource: boolean;
    straightTarget: boolean;
    sourceRouteOffset: number | null;
    targetRouteOffset: number | null;
  };

export type AddressFlowNode = Node<AddressNodeData, "address">;
export type TransferFlowEdge = Edge<TransferEdgeData, "transfer">;

export type GraphSelection =
  | { type: "node"; node: AddressNodeRecord }
  | { type: "edge"; edge: TransferEdgeRecord; transfers: TransferRecord[] }
  | null;
