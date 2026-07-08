import ELK from "elkjs/lib/elk.bundled.js";
import { Position } from "@xyflow/react";
import type { TxTraceResponse } from "@/lib/tx/types";
import { edgeColor, transferArrowMarkerId } from "./edge-style";
import type { AddressFlowNode, TransferFlowEdge } from "./types";

const elk = new ELK();
const NODE_WIDTH = 268;
const NODE_HEIGHT = 76;
const FANOUT_PAIR_GAP = 156;
const FANOUT_WITHIN_PAIR_GAP = 56;
const RIGHT_HANDLE_VERTICAL_GAP = NODE_HEIGHT * 0.28;
const COLUMN_X_TOLERANCE = 1;
const FALLBACK_COLUMN_NODE_GAP = NODE_HEIGHT + 156;

const layoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "440",
  "elk.spacing.nodeNode": "156",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

type LayoutEdge = {
  id: string;
  sources: string[];
  targets: string[];
};

function firstNonNativeOutSourceId(trace: TxTraceResponse, receiverId: string, nodeIds: Set<string>) {
  return [...trace.transfers]
    .filter((transfer) => transfer.kind === "erc20")
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
    .map((transfer) => transfer.from.toLowerCase())
    .find((sourceId) => sourceId !== receiverId && nodeIds.has(sourceId)) ?? null;
}

function parallelKey(source: string, target: string) {
  return [source, target].sort().join("<->");
}

function addUniqueLayoutEdge(
  layoutEdges: LayoutEdge[],
  seen: Set<string>,
  source: string,
  target: string,
  reason: string,
) {
  if (source === target) return;

  const key = `${source}->${target}`;
  if (seen.has(key)) return;

  seen.add(key);
  layoutEdges.push({
    id: `layout:${reason}:${layoutEdges.length}`,
    sources: [source],
    targets: [target],
  });
}

function receiverAnchoredRanks(trace: TxTraceResponse) {
  const nodeIds = new Set(trace.nodes.map((node) => node.id));
  const senderId = trace.tx.from.toLowerCase();
  const receiverId = trace.tx.to?.toLowerCase() ?? null;

  if (!receiverId || !nodeIds.has(receiverId) || senderId === receiverId) {
    return null;
  }

  const adjacency = new Map<string, Set<string>>();
  nodeIds.forEach((nodeId) => adjacency.set(nodeId, new Set()));
  trace.edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const ranks = new Map<string, number>();
  const preReceiverSourceId = firstNonNativeOutSourceId(trace, receiverId, nodeIds);
  if (nodeIds.has(senderId)) ranks.set(senderId, 0);
  if (preReceiverSourceId) ranks.set(preReceiverSourceId, 0);
  ranks.set(receiverId, 1);

  const queue = [receiverId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    const rank = ranks.get(nodeId) ?? 1;

    adjacency.get(nodeId)?.forEach((neighborId) => {
      if (neighborId === senderId || neighborId === preReceiverSourceId || ranks.has(neighborId)) return;
      ranks.set(neighborId, rank + 1);
      queue.push(neighborId);
    });
  }

  nodeIds.forEach((nodeId) => {
    if (ranks.has(nodeId)) return;
    ranks.set(nodeId, nodeId === senderId ? 0 : 2);
  });

  return { ranks, adjacency, senderId, receiverId, preReceiverSourceId, nodeIds };
}

export function buildLayoutEdges(trace: TxTraceResponse): LayoutEdge[] {
  const anchored = receiverAnchoredRanks(trace);

  if (!anchored) {
    return trace.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));
  }

  const { ranks, adjacency, senderId, receiverId, preReceiverSourceId, nodeIds } = anchored;
  const layoutEdges: LayoutEdge[] = [];
  const seen = new Set<string>();

  if (nodeIds.has(senderId)) {
    addUniqueLayoutEdge(layoutEdges, seen, senderId, receiverId, "sender-receiver");
  }
  if (preReceiverSourceId) {
    addUniqueLayoutEdge(layoutEdges, seen, preReceiverSourceId, receiverId, "first-non-native-source-receiver");
  }

  trace.edges.forEach((edge) => {
    const sourceRank = ranks.get(edge.source) ?? 2;
    const targetRank = ranks.get(edge.target) ?? 2;

    if (sourceRank < targetRank) {
      addUniqueLayoutEdge(layoutEdges, seen, edge.source, edge.target, edge.id);
    } else if (targetRank < sourceRank) {
      addUniqueLayoutEdge(layoutEdges, seen, edge.target, edge.source, edge.id);
    }
  });

  const targeted = new Set(layoutEdges.flatMap((edge) => edge.targets));
  nodeIds.forEach((nodeId) => {
    if (nodeId === senderId || nodeId === receiverId || nodeId === preReceiverSourceId || targeted.has(nodeId)) {
      return;
    }

    const rank = ranks.get(nodeId) ?? 2;
    const predecessor =
      [...(adjacency.get(nodeId) ?? [])]
        .filter((neighborId) => (ranks.get(neighborId) ?? 2) < rank)
        .sort((a, b) => (ranks.get(b) ?? 2) - (ranks.get(a) ?? 2))[0] ?? receiverId;

    addUniqueLayoutEdge(layoutEdges, seen, predecessor, nodeId, `fallback-${nodeId}`);
  });

  return layoutEdges;
}

export function toFlowElements(trace: TxTraceResponse) {
  const transferById = new Map(trace.transfers.map((transfer) => [transfer.id, transfer]));

  const nodes: AddressFlowNode[] = trace.nodes.map((node) => ({
    id: node.id,
    type: "address",
    data: node,
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));

  const parallelGroups = new Map<string, number>();
  const parallelIndexes = new Map<string, number>();
  trace.edges.forEach((edge) => {
    const key = parallelKey(edge.source, edge.target);
    parallelGroups.set(key, (parallelGroups.get(key) ?? 0) + 1);
  });

  const edges: TransferFlowEdge[] = trace.edges.map((edge) => {
    const key = parallelKey(edge.source, edge.target);
    const laneIndex = parallelIndexes.get(key) ?? 0;
    parallelIndexes.set(key, laneIndex + 1);

    return {
      id: edge.id,
      type: "transfer",
      source: edge.source,
      target: edge.target,
      markerEnd: transferArrowMarkerId(edgeColor(edge)),
      data: {
        ...edge,
        laneIndex,
        laneCount: parallelGroups.get(key) ?? 1,
        fanoutIndex: 0,
        fanoutCount: 1,
        fanoutHub: null,
        fanoutOffset: 0,
        straightSource: false,
        straightTarget: false,
        sourceRouteOffset: null,
        targetRouteOffset: null,
        transfers: edge.transferIds
          .map((transferId) => transferById.get(transferId))
          .filter((transfer): transfer is NonNullable<typeof transfer> => Boolean(transfer)),
      },
    };
  });

  return { nodes, edges };
}

function nodeCenter(
  positions: Map<string, { x: number; y: number }>,
  nodeId: string,
) {
  const position = positions.get(nodeId) ?? { x: 0, y: 0 };
  return {
    x: position.x + NODE_WIDTH / 2,
    y: position.y + NODE_HEIGHT / 2,
  };
}

function assignFanoutLanes(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  });

  const groups = new Map<
    string,
    Array<{
      edge: TransferFlowEdge;
      hub: string;
      other: string;
      otherY: number;
      pairKey: string;
      directionRank: number;
    }>
  >();

  edges.forEach((edge) => {
    const sourceDegree = degree.get(edge.source) ?? 0;
    const targetDegree = degree.get(edge.target) ?? 0;
    const hub = sourceDegree >= targetDegree ? edge.source : edge.target;
    const other = hub === edge.source ? edge.target : edge.source;
    const sourceCenter = nodeCenter(positions, edge.source);
    const targetCenter = nodeCenter(positions, edge.target);
    const hubCenter = nodeCenter(positions, hub);
    const otherCenter = nodeCenter(positions, other);
    const side = otherCenter.x >= hubCenter.x ? "right" : "left";
    const key = `${hub}:${side}`;
    const pairKey = parallelKey(edge.source, edge.target);
    const directionRank = sourceCenter.x <= targetCenter.x ? 0 : 1;
    const group = groups.get(key) ?? [];
    group.push({ edge, hub, other, otherY: otherCenter.y, pairKey, directionRank });
    groups.set(key, group);
  });

  groups.forEach((group) => {
    if (group.length <= 1) return;

    const pairGroups = new Map<string, typeof group>();
    group.forEach((item) => {
      const pairGroup = pairGroups.get(item.pairKey) ?? [];
      pairGroup.push(item);
      pairGroups.set(item.pairKey, pairGroup);
    });

    const orderedPairGroups = [...pairGroups.values()]
      .map((items) =>
        items.sort(
          (a, b) => a.directionRank - b.directionRank || a.otherY - b.otherY || a.edge.id.localeCompare(b.edge.id),
        ),
      )
      .sort((a, b) => {
        const aY = a.reduce((sum, item) => sum + item.otherY, 0) / a.length;
        const bY = b.reduce((sum, item) => sum + item.otherY, 0) / b.length;
        return aY - bY || a[0].pairKey.localeCompare(b[0].pairKey);
      });

    let flatIndex = 0;
    orderedPairGroups.forEach((items, pairIndex) => {
      const pairOffset = (pairIndex - (orderedPairGroups.length - 1) / 2) * FANOUT_PAIR_GAP;

      items.forEach((item, itemIndex) => {
        if (!item.edge.data) return;

        const withinPairOffset =
          items.length > 1 ? (itemIndex - (items.length - 1) / 2) * FANOUT_WITHIN_PAIR_GAP : 0;

        item.edge.data = {
          ...item.edge.data,
          fanoutIndex: flatIndex,
          fanoutCount: group.length,
          fanoutHub: item.hub,
          fanoutOffset: pairOffset + withinPairOffset,
        };
        flatIndex += 1;
      });
    });
  });
}

function assignEdgePorts(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  edges.forEach((edge) => {
    const sourceCenter = nodeCenter(positions, edge.source);
    const targetCenter = nodeCenter(positions, edge.target);
    const flowsRight = sourceCenter.x <= targetCenter.x;

    edge.sourceHandle = flowsRight ? "out-right" : "out-left";
    edge.targetHandle = flowsRight ? "in-left" : "in-right";
  });
}

type EndpointSide = "left" | "right";
type EndpointKind = "source" | "target";

type EdgeEndpoint = {
  edge: TransferFlowEdge;
  kind: EndpointKind;
  nodeId: string;
  handle: string;
  side: EndpointSide;
  pairKey: string;
  otherY: number;
};

function endpointSide(handle: string | null | undefined): EndpointSide {
  return handle?.endsWith("left") ? "left" : "right";
}

function setEndpointRoute(endpoint: EdgeEndpoint, straight: boolean, offset: number) {
  if (!endpoint.edge.data) return;

  if (endpoint.kind === "source") {
    endpoint.edge.data = {
      ...endpoint.edge.data,
      straightSource: straight,
      sourceRouteOffset: offset,
    };
    return;
  }

  endpoint.edge.data = {
    ...endpoint.edge.data,
    straightTarget: straight,
    targetRouteOffset: offset,
  };
}

function preferredStraightHandle(position: "upper" | "lower", side: EndpointSide) {
  if (position === "upper") return side === "left" ? "out-left" : "in-right";
  return side === "left" ? "in-left" : "out-right";
}

function orderedEndpoints(endpoints: EdgeEndpoint[], preferredHandle: string) {
  return [...endpoints].sort((a, b) => {
    const preferredDelta =
      Number(b.handle === preferredHandle) - Number(a.handle === preferredHandle);
    if (preferredDelta !== 0) return preferredDelta;

    return a.otherY - b.otherY || a.pairKey.localeCompare(b.pairKey) || a.edge.id.localeCompare(b.edge.id);
  });
}

function edgeDisplayOrder(edge: TransferFlowEdge) {
  const indexes = edge.data?.displayIndexes.filter((index): index is number => index !== null) ?? [];
  return indexes.length > 0 ? Math.min(...indexes) : Number.MAX_SAFE_INTEGER;
}

function edgeConnects(edge: TransferFlowEdge, a: string, b: string) {
  return (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);
}

function nodeColumnOrder(edges: TransferFlowEdge[], nodeId: string, anchorId: string | null) {
  if (anchorId) {
    const anchorEdges = edges.filter((edge) => edgeConnects(edge, nodeId, anchorId));
    if (anchorEdges.length > 0) {
      return Math.min(...anchorEdges.map(edgeDisplayOrder));
    }
  }

  const incidentOrders = edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map(edgeDisplayOrder);

  return incidentOrders.length > 0 ? Math.min(...incidentOrders) : Number.MAX_SAFE_INTEGER;
}

function connectedNodeIds(edges: TransferFlowEdge[], nodeId: string) {
  return edges.flatMap((edge) => {
    if (edge.source === nodeId) return [edge.target];
    if (edge.target === nodeId) return [edge.source];
    return [];
  });
}

function nodeOrderWithNeighbors(edges: TransferFlowEdge[], nodeId: string, neighborIds: string[]) {
  const neighborSet = new Set(neighborIds);
  const orders = edges
    .filter((edge) => edgeConnects(edge, nodeId, edge.source === nodeId ? edge.target : edge.source))
    .filter((edge) => neighborSet.has(edge.source === nodeId ? edge.target : edge.source))
    .map(edgeDisplayOrder);

  return orders.length > 0 ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
}

function buildPositionColumns(positions: Map<string, { x: number; y: number }>) {
  const columns: Array<{
    x: number;
    items: Array<{ nodeId: string; position: { x: number; y: number } }>;
  }> = [];

  positions.forEach((position, nodeId) => {
    const column = columns.find((candidate) => Math.abs(candidate.x - position.x) <= COLUMN_X_TOLERANCE);
    if (column) {
      column.items.push({ nodeId, position });
      return;
    }

    columns.push({ x: position.x, items: [{ nodeId, position }] });
  });

  return columns.sort((a, b) => a.x - b.x);
}

function columnNodeSpacing(items: Array<{ position: { y: number } }>) {
  const sortedY = items.map((item) => item.position.y).sort((a, b) => a - b);
  const gaps = sortedY
    .slice(1)
    .map((y, index) => y - sortedY[index])
    .filter((gap) => gap > 0);

  return gaps.length > 0 ? Math.min(...gaps) : FALLBACK_COLUMN_NODE_GAP;
}

export function orderColumnPositionsByTransferIndex(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  anchorId: string | null,
) {
  const columns = buildPositionColumns(positions);

  columns.forEach(({ items }) => {
    items = items.filter((item) => item.nodeId !== anchorId);
    if (items.length <= 1) return;

    const ySlots = [...items].map((item) => item.position.y).sort((a, b) => a - b);
    const orderedItems = [...items].sort((a, b) => {
      const aOrder = nodeColumnOrder(edges, a.nodeId, anchorId);
      const bOrder = nodeColumnOrder(edges, b.nodeId, anchorId);
      if (aOrder !== bOrder) return aOrder - bOrder;

      return a.position.y - b.position.y || a.nodeId.localeCompare(b.nodeId);
    });

    orderedItems.forEach((item, index) => {
      positions.set(item.nodeId, { ...item.position, y: ySlots[index] });
    });
  });
}

export function centerRightColumnsByLeftNeighbors(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  receiverId: string | null,
) {
  const columns = buildPositionColumns(positions);

  columns.forEach((column) => {
    const spacing = columnNodeSpacing(column.items);
    const groups = new Map<
      string,
      {
        anchorCenterY: number;
        leftNeighborIds: string[];
        items: Array<{ nodeId: string; position: { x: number; y: number } }>;
      }
    >();

    column.items.forEach((item) => {
      const itemX = item.position.x;
      const leftNeighborIds = [
        ...new Set(
          connectedNodeIds(edges, item.nodeId)
            .filter((neighborId) => neighborId !== receiverId)
            .filter((neighborId) => {
              const neighborPosition = positions.get(neighborId);
              return neighborPosition ? neighborPosition.x < itemX - COLUMN_X_TOLERANCE : false;
            }),
        ),
      ].sort();

      if (leftNeighborIds.length === 0) return;

      const anchorCenterY =
        leftNeighborIds.reduce((sum, neighborId) => sum + nodeCenter(positions, neighborId).y, 0) /
        leftNeighborIds.length;
      const groupKey = leftNeighborIds.join("|");
      const group = groups.get(groupKey) ?? { anchorCenterY, leftNeighborIds, items: [] };
      group.items.push(item);
      groups.set(groupKey, group);
    });

    groups.forEach((group) => {
      const orderedItems = [...group.items].sort((a, b) => {
        const aOrder = nodeOrderWithNeighbors(edges, a.nodeId, group.leftNeighborIds);
        const bOrder = nodeOrderWithNeighbors(edges, b.nodeId, group.leftNeighborIds);
        if (aOrder !== bOrder) return aOrder - bOrder;

        return a.position.y - b.position.y || a.nodeId.localeCompare(b.nodeId);
      });

      orderedItems.forEach((item, index) => {
        const centeredOffset = (index - (orderedItems.length - 1) / 2) * spacing;
        positions.set(item.nodeId, {
          ...item.position,
          y: group.anchorCenterY - NODE_HEIGHT / 2 + centeredOffset,
        });
      });
    });
  });
}

function preReceiverInboundEndpoint(
  endpoints: EdgeEndpoint[],
  receiverId: string,
  preReceiverSourceId: string | null,
) {
  if (!preReceiverSourceId) return null;
  const firstEndpoint = endpoints[0];
  if (!firstEndpoint || firstEndpoint.nodeId !== preReceiverSourceId || firstEndpoint.side !== "right") {
    return null;
  }

  return [...endpoints]
    .filter(
      (endpoint) =>
        endpoint.kind === "source" &&
        endpoint.handle === "out-right" &&
        endpoint.edge.source === preReceiverSourceId &&
        endpoint.edge.target === receiverId,
    )
    .sort(
      (a, b) =>
        edgeDisplayOrder(a.edge) - edgeDisplayOrder(b.edge) ||
        a.otherY - b.otherY ||
        a.edge.id.localeCompare(b.edge.id),
    )[0] ?? null;
}

function assignPreReceiverPairOffsets(
  endpoints: EdgeEndpoint[],
  receiverId: string,
  preReceiverSourceId: string | null,
) {
  const firstInbound = preReceiverInboundEndpoint(endpoints, receiverId, preReceiverSourceId);
  if (!firstInbound) return false;

  const orderedEndpoints = [...endpoints].sort((a, b) => {
    if (a === firstInbound) return -1;
    if (b === firstInbound) return 1;

    return (
      edgeDisplayOrder(a.edge) - edgeDisplayOrder(b.edge) ||
      a.handle.localeCompare(b.handle) ||
      a.edge.id.localeCompare(b.edge.id)
    );
  });

  orderedEndpoints.forEach((endpoint, index) => {
    if (endpoint === firstInbound) {
      setEndpointRoute(endpoint, true, 0);
      return;
    }

    const laneOffsetFromOutRight = index * FANOUT_WITHIN_PAIR_GAP;
    const handleCorrection = endpoint.handle === "in-right" ? RIGHT_HANDLE_VERTICAL_GAP : 0;
    setEndpointRoute(endpoint, false, laneOffsetFromOutRight - handleCorrection);
  });

  return true;
}

function assignOffsetsAroundStraight(endpoints: EdgeEndpoint[], straightEndpoint: EdgeEndpoint) {
  const pairGroups = new Map<string, EdgeEndpoint[]>();
  endpoints.forEach((endpoint) => {
    const pairGroup = pairGroups.get(endpoint.pairKey) ?? [];
    pairGroup.push(endpoint);
    pairGroups.set(endpoint.pairKey, pairGroup);
  });

  const orderedPairGroups = [...pairGroups.values()]
    .map((items) =>
      items.sort((a, b) => a.otherY - b.otherY || a.handle.localeCompare(b.handle) || a.edge.id.localeCompare(b.edge.id)),
    )
    .sort((a, b) => {
      const aY = a.reduce((sum, endpoint) => sum + endpoint.otherY, 0) / a.length;
      const bY = b.reduce((sum, endpoint) => sum + endpoint.otherY, 0) / b.length;
      return aY - bY || a[0].pairKey.localeCompare(b[0].pairKey);
    });

  const straightPairIndex = orderedPairGroups.findIndex((items) =>
    items.some((endpoint) => endpoint === straightEndpoint),
  );

  orderedPairGroups.forEach((items, pairIndex) => {
    const straightItemIndex = items.findIndex((endpoint) => endpoint === straightEndpoint);
    const pairOffset =
      straightPairIndex >= 0 ? (pairIndex - straightPairIndex) * FANOUT_PAIR_GAP : 0;

    items.forEach((endpoint, itemIndex) => {
      if (endpoint === straightEndpoint) {
        setEndpointRoute(endpoint, true, 0);
        return;
      }

      const withinPairOffset =
        straightItemIndex >= 0
          ? (itemIndex < straightItemIndex ? itemIndex - straightItemIndex : itemIndex - straightItemIndex) *
            FANOUT_WITHIN_PAIR_GAP
          : items.length > 1
            ? (itemIndex - (items.length - 1) / 2) * FANOUT_WITHIN_PAIR_GAP
            : 0;

      setEndpointRoute(endpoint, false, pairOffset + withinPairOffset);
    });
  });
}

function assignUniqueEndpointSides(edges: TransferFlowEdge[]) {
  const sideCounts = new Map<string, number>();

  edges.forEach((edge) => {
    const sourceKey = `${edge.source}:${endpointSide(edge.sourceHandle)}`;
    const targetKey = `${edge.target}:${endpointSide(edge.targetHandle)}`;
    sideCounts.set(sourceKey, (sideCounts.get(sourceKey) ?? 0) + 1);
    sideCounts.set(targetKey, (sideCounts.get(targetKey) ?? 0) + 1);
  });

  edges.forEach((edge) => {
    if (!edge.data) return;

    const sourceKey = `${edge.source}:${endpointSide(edge.sourceHandle)}`;
    const targetKey = `${edge.target}:${endpointSide(edge.targetHandle)}`;

    edge.data = {
      ...edge.data,
      straightSource: sideCounts.get(sourceKey) === 1,
      straightTarget: sideCounts.get(targetKey) === 1,
      sourceRouteOffset: null,
      targetRouteOffset: null,
    };
  });
}

export function assignStraightEndpointRoutes(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  receiverId: string | null,
  preReceiverSourceId: string | null = null,
) {
  if (!receiverId || !positions.has(receiverId)) {
    assignUniqueEndpointSides(edges);
    return;
  }

  assignUniqueEndpointSides(edges.filter((edge) => edge.source === receiverId || edge.target === receiverId));

  const receiverCenter = nodeCenter(positions, receiverId);
  const groups = new Map<string, EdgeEndpoint[]>();

  edges.forEach((edge) => {
    const sourceCenter = nodeCenter(positions, edge.source);
    const targetCenter = nodeCenter(positions, edge.target);
    const endpoints: EdgeEndpoint[] = [
      {
        edge,
        kind: "source",
        nodeId: edge.source,
        handle: edge.sourceHandle ?? "",
        side: endpointSide(edge.sourceHandle),
        pairKey: parallelKey(edge.source, edge.target),
        otherY: targetCenter.y,
      },
      {
        edge,
        kind: "target",
        nodeId: edge.target,
        handle: edge.targetHandle ?? "",
        side: endpointSide(edge.targetHandle),
        pairKey: parallelKey(edge.source, edge.target),
        otherY: sourceCenter.y,
      },
    ];

    endpoints.forEach((endpoint) => {
      if (endpoint.nodeId === receiverId) return;

      const key = `${endpoint.nodeId}:${endpoint.side}`;
      const group = groups.get(key) ?? [];
      group.push(endpoint);
      groups.set(key, group);
    });
  });

  groups.forEach((endpoints) => {
    const nodeCenterY = nodeCenter(positions, endpoints[0].nodeId).y;
    const nodePosition = nodeCenterY < receiverCenter.y ? "upper" : "lower";
    const preferredHandle = preferredStraightHandle(nodePosition, endpoints[0].side);
    if (assignPreReceiverPairOffsets(endpoints, receiverId, preReceiverSourceId)) return;

    const straightEndpoint = orderedEndpoints(endpoints, preferredHandle)[0];
    if (!straightEndpoint) return;

    assignOffsetsAroundStraight(endpoints, straightEndpoint);
  });
}

export async function layoutTrace(trace: TxTraceResponse) {
  const { nodes, edges } = toFlowElements(trace);
  const layoutEdges = buildLayoutEdges(trace);
  const layouted = await elk.layout({
    id: "root",
    layoutOptions,
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: layoutEdges,
  });

  const positions = new Map(
    (layouted.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  );
  const receiverId = trace.tx.to?.toLowerCase() ?? null;
  const preReceiverSourceId = receiverId
    ? firstNonNativeOutSourceId(trace, receiverId, new Set(trace.nodes.map((node) => node.id)))
    : null;
  orderColumnPositionsByTransferIndex(edges, positions, receiverId);
  centerRightColumnsByLeftNeighbors(edges, positions, receiverId);
  assignEdgePorts(edges, positions);
  assignFanoutLanes(edges, positions);
  assignStraightEndpointRoutes(edges, positions, receiverId, preReceiverSourceId);

  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges,
  };
}
