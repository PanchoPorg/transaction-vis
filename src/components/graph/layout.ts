import ELK from "elkjs/lib/elk.bundled.js";
import { Position } from "@xyflow/react";
import type { TxTraceResponse } from "@/lib/tx/types";
import { edgeColor, transferArrowMarkerId } from "./edge-style";
import {
  DEFAULT_GRAPH_PORTS,
  MIN_HORIZONTAL_ROUTE_RUN,
  MIN_HORIZONTAL_LANE_GAP,
  LOWER_PORT_RATIO,
  NODE_HEIGHT,
  NODE_ROUTE_CLEARANCE,
  NODE_WIDTH,
  UPPER_PORT_RATIO,
  edgeLabelGeometry,
  edgeRouteGeometry,
  defaultPortRatio,
  horizontalIntervalsOverlap,
  pathIntersectsRect,
  pathsIntersect,
  portPoint,
  rectsIntersect,
  type EdgeCurveMode,
  type EdgeLabelGeometry,
  type EdgeRouteGeometry,
  type GraphPoint,
  type GraphPortSide,
  type GraphPortSpec,
  type GraphRect,
} from "./geometry";
import type { AddressFlowNode, TransferFlowEdge } from "./types";

const elk = new ELK();
const COLUMN_X_TOLERANCE = 1;
const FALLBACK_COLUMN_NODE_GAP = NODE_HEIGHT + 156;
const ROUTE_EPSILON = 0.0001;
const RECIPROCAL_COMPACTION_THRESHOLD =
  MIN_HORIZONTAL_LANE_GAP + NODE_ROUTE_CLEARANCE;
const MAX_DYNAMIC_RECIPROCAL_DEGREE = 12;
const MIN_COLUMN_NODE_TOP_GAP = NODE_HEIGHT + NODE_ROUTE_CLEARANCE;
const COLUMN_GAP_COMPACTION_THRESHOLD =
  MIN_COLUMN_NODE_TOP_GAP + NODE_ROUTE_CLEARANCE;
const BASE_COMPACT_COLUMN_CLEAR_GAP =
  MIN_HORIZONTAL_LANE_GAP * 2 - NODE_HEIGHT;
const DENSE_COLUMN_GAP_SCALE = 1.3;
const SPARSE_COLUMN_GAP_SCALE = 5;
const DENSE_COLUMN_NODE_COUNT = 4;

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
    data: {
      ...node,
      ports: DEFAULT_GRAPH_PORTS.map((port) => ({ ...port })),
    },
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));

  const edges: TransferFlowEdge[] = trace.edges.map((edge) => {
    return {
      id: edge.id,
      type: "transfer",
      source: edge.source,
      target: edge.target,
      markerEnd: transferArrowMarkerId(edgeColor(edge)),
      data: {
        ...edge,
        fanoutHub: null,
        routeY: 0,
        labelBias: 0.5,
        sourceCurveMode: "default",
        targetCurveMode: "default",
        sourcePortRatio: defaultPortRatio("out-right"),
        targetPortRatio: defaultPortRatio("in-left"),
        mixedDirectionGroups: [],
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

function assignEdgePorts(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  edges.forEach((edge) => {
    const { sourceHandle, targetHandle } = handlesForPositions(
      positions.get(edge.source) ?? { x: 0, y: 0 },
      positions.get(edge.target) ?? { x: 0, y: 0 },
    );

    edge.sourceHandle = sourceHandle;
    edge.targetHandle = targetHandle;
    if (edge.data) {
      edge.data = {
        ...edge.data,
        sourcePortRatio: defaultPortRatio(sourceHandle),
        targetPortRatio: defaultPortRatio(targetHandle),
      };
    }
  });
}

function handlesForPositions(
  sourcePosition: { x: number; y: number },
  targetPosition: { x: number; y: number },
) {
  const flowsRight =
    sourcePosition.x + NODE_WIDTH / 2 <= targetPosition.x + NODE_WIDTH / 2;

  return {
    sourceHandle: flowsRight ? "out-right" : "out-left",
    targetHandle: flowsRight ? "in-left" : "in-right",
  };
}

export function edgeHasValidHorizontalCorridor(
  edge: Pick<TransferFlowEdge, "source" | "target">,
  positions: Map<string, { x: number; y: number }>,
) {
  const sourcePosition = positions.get(edge.source);
  const targetPosition = positions.get(edge.target);
  if (!sourcePosition || !targetPosition) return false;

  const { sourceHandle, targetHandle } = handlesForPositions(
    sourcePosition,
    targetPosition,
  );
  const sourcePoint = portPoint(sourcePosition, sourceHandle);
  const targetPoint = portPoint(targetPosition, targetHandle);
  const expectedDirection = sourceHandle === "out-right" ? 1 : -1;
  const routeY =
    Math.abs(sourcePoint.y - targetPoint.y) < 1
      ? sourcePoint.y + 2
      : (sourcePoint.y + targetPoint.y) / 2;
  const geometry = edgeRouteGeometry({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    routeY,
  });
  const horizontalRun =
    geometry.direction * (geometry.routeEndX - geometry.routeStartX);

  return (
    geometry.direction === expectedDirection &&
    horizontalRun >= MIN_HORIZONTAL_ROUTE_RUN
  );
}

function edgeDisplayOrder(edge: TransferFlowEdge) {
  const indexes = edge.data?.displayIndexes.filter((index): index is number => index !== null) ?? [];
  return indexes.length > 0 ? Math.min(...indexes) : Number.MAX_SAFE_INTEGER;
}

function connectedPairKey(source: string, target: string) {
  return [source, target].sort().join("<->");
}

function preferredSeparationEdge(edges: TransferFlowEdge[]) {
  return [...edges].sort(
    (a, b) =>
      edgeDisplayOrder(a) - edgeDisplayOrder(b) ||
      a.id.localeCompare(b.id),
  )[0];
}

async function elkPositions(nodes: AddressFlowNode[], edges: LayoutEdge[]) {
  const layouted = await elk.layout({
    id: "root",
    layoutOptions,
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges,
  });

  return new Map(
    (layouted.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ]),
  );
}

async function layoutPositionsWithHorizontalCorridors(
  nodes: AddressFlowNode[],
  edges: TransferFlowEdge[],
  baseLayoutEdges: LayoutEdge[],
) {
  const layoutEdges = [...baseLayoutEdges];
  const constrainedPairs = new Set<string>();

  while (true) {
    const positions = await elkPositions(nodes, layoutEdges);
    const invalidGroups = new Map<string, TransferFlowEdge[]>();

    edges.forEach((edge) => {
      if (edgeHasValidHorizontalCorridor(edge, positions)) return;
      const key = connectedPairKey(edge.source, edge.target);
      const group = invalidGroups.get(key) ?? [];
      group.push(edge);
      invalidGroups.set(key, group);
    });

    if (invalidGroups.size === 0) return positions;

    const unconstrainedGroups = [...invalidGroups.entries()]
      .filter(([key]) => !constrainedPairs.has(key))
      .sort(([a], [b]) => a.localeCompare(b));

    if (unconstrainedGroups.length === 0) {
      throw new Error("ELK could not create a horizontal corridor for every connected node pair.");
    }

    unconstrainedGroups.forEach(([key, group]) => {
      const preferred = preferredSeparationEdge(group);
      if (!preferred) return;

      constrainedPairs.add(key);
      layoutEdges.push({
        id: `layout:separation:${key}`,
        sources: [preferred.source],
        targets: [preferred.target],
      });
    });
  }
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

function reciprocalNeighborCount(
  edges: TransferFlowEdge[],
  nodeId: string,
  neighborIds: string[],
) {
  return neighborIds.filter((neighborId) => {
    const outgoing = edges.some((edge) => edge.source === nodeId && edge.target === neighborId);
    const incoming = edges.some((edge) => edge.source === neighborId && edge.target === nodeId);
    return outgoing && incoming;
  }).length;
}

function alignedItemIndex(
  edges: TransferFlowEdge[],
  orderedItems: Array<{ nodeId: string }>,
  neighborIds: string[],
) {
  if (orderedItems.length % 2 === 1) return Math.floor(orderedItems.length / 2);

  const lowerMiddle = orderedItems.length / 2 - 1;
  const upperMiddle = orderedItems.length / 2;
  const candidates = [lowerMiddle, upperMiddle];

  return candidates.sort((aIndex, bIndex) => {
    const a = orderedItems[aIndex];
    const b = orderedItems[bIndex];
    const reciprocalDelta =
      reciprocalNeighborCount(edges, b.nodeId, neighborIds) -
      reciprocalNeighborCount(edges, a.nodeId, neighborIds);
    if (reciprocalDelta !== 0) return reciprocalDelta;

    const displayDelta =
      nodeOrderWithNeighbors(edges, a.nodeId, neighborIds) -
      nodeOrderWithNeighbors(edges, b.nodeId, neighborIds);
    if (displayDelta !== 0) return displayDelta;

    return a.nodeId.localeCompare(b.nodeId);
  })[0];
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
      const anchorIndex = alignedItemIndex(edges, orderedItems, group.leftNeighborIds);

      orderedItems.forEach((item, index) => {
        const centeredOffset = (index - anchorIndex) * spacing;
        positions.set(item.nodeId, {
          ...item.position,
          y: group.anchorCenterY - NODE_HEIGHT / 2 + centeredOffset,
        });
      });
    });
  });
}

function preferredLabelBias(edge: TransferFlowEdge) {
  if (edge.data?.fanoutHub === edge.source) return 0.52;
  if (edge.data?.fanoutHub === edge.target) return 0.48;
  return 0.5;
}

function nodeRect(position: { x: number; y: number }) {
  return {
    ...position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
}

function straightRouteCandidate(
  edge: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const sourcePosition = positions.get(edge.source);
  const targetPosition = positions.get(edge.target);
  if (!sourcePosition || !targetPosition) return null;

  const { sourceHandle, targetHandle } = handlesForPositions(
    sourcePosition,
    targetPosition,
  );
  const sourcePoint = portPoint(sourcePosition, sourceHandle);
  const targetPoint = portPoint(targetPosition, targetHandle);
  if (Math.abs(sourcePoint.y - targetPoint.y) >= 1) return null;

  const geometry = edgeRouteGeometry({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    routeY: sourcePoint.y,
  });
  const label = edgeLabelGeometry({
    label: edge.data?.label ?? "",
    horizontalStartX: geometry.horizontalStartX,
    horizontalEndX: geometry.horizontalEndX,
    routeY: sourcePoint.y,
    labelBias: 0.5,
  });
  const hitsNode = [...positions.entries()].some(([nodeId, position]) => {
    if (nodeId === edge.source || nodeId === edge.target) return false;
    return (
      pathIntersectsRect(
        geometry.segments,
        nodeRect(position),
        NODE_ROUTE_CLEARANCE,
      ) ||
      rectsIntersect(
        label.rect,
        {
          x: position.x - NODE_ROUTE_CLEARANCE,
          y: position.y - NODE_ROUTE_CLEARANCE,
          width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
          height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
        },
      )
    );
  });

  if (hitsNode) return null;
  return { edge, geometry, label };
}

function straightCandidatesConflict(
  a: NonNullable<ReturnType<typeof straightRouteCandidate>>,
  b: NonNullable<ReturnType<typeof straightRouteCandidate>>,
) {
  return (
    (horizontalIntervalsOverlap(a.geometry, b.geometry) &&
      Math.abs(
        a.geometry.segments[0].from.y - b.geometry.segments[0].from.y,
      ) <
        MIN_HORIZONTAL_LANE_GAP - ROUTE_EPSILON) ||
    pathsIntersect(
      a.geometry.segments,
      b.geometry.segments,
      sharedPhysicalPorts(a.edge, b.edge, a.geometry, b.geometry),
    ) ||
    rectsIntersect(a.label.rect, b.label.rect) ||
    pathIntersectsRect(a.geometry.segments, b.label.rect) ||
    pathIntersectsRect(b.geometry.segments, a.label.rect)
  );
}

function bestCompatibleStraightSet(
  candidates: Array<NonNullable<ReturnType<typeof straightRouteCandidate>>>,
) {
  const ordered = [...candidates].sort(
    (a, b) =>
      edgeDisplayOrder(a.edge) - edgeDisplayOrder(b.edge) ||
      a.edge.id.localeCompare(b.edge.id),
  );
  let best: typeof ordered = [];

  const prefer = (candidate: typeof ordered, current: typeof ordered) => {
    if (candidate.length !== current.length) return candidate.length > current.length;
    for (let index = 0; index < candidate.length; index += 1) {
      const orderDelta =
        edgeDisplayOrder(candidate[index].edge) -
        edgeDisplayOrder(current[index].edge);
      if (orderDelta !== 0) return orderDelta < 0;
      const idDelta = candidate[index].edge.id.localeCompare(current[index].edge.id);
      if (idDelta !== 0) return idDelta < 0;
    }
    return false;
  };

  if (ordered.length > 20) {
    return ordered.filter((candidate, index, selected) =>
      selected
        .slice(0, index)
        .every((other) => !straightCandidatesConflict(candidate, other)),
    );
  }

  const visit = (index: number, selected: typeof ordered) => {
    if (selected.length + ordered.length - index < best.length) return;
    if (index === ordered.length) {
      if (prefer(selected, best)) best = [...selected];
      return;
    }

    const candidate = ordered[index];
    if (
      selected.every((other) => !straightCandidatesConflict(candidate, other))
    ) {
      selected.push(candidate);
      visit(index + 1, selected);
      selected.pop();
    }
    visit(index + 1, selected);
  };

  visit(0, []);
  return best;
}

function compareStraightSets(
  a: ReturnType<typeof bestCompatibleStraightSet>,
  b: ReturnType<typeof bestCompatibleStraightSet>,
) {
  if (a.length !== b.length) return b.length - a.length;
  for (let index = 0; index < a.length; index += 1) {
    const orderDelta =
      edgeDisplayOrder(a[index].edge) - edgeDisplayOrder(b[index].edge);
    if (orderDelta !== 0) return orderDelta;
    const idDelta = a[index].edge.id.localeCompare(b[index].edge.id);
    if (idDelta !== 0) return idDelta;
  }
  return 0;
}

export function alignColumnsForStraightRoutes(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  receiverId: string | null,
) {
  const columns = buildPositionColumns(positions);
  if (columns.length < 2) return;
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });

  const anchorIndex = Math.max(
    0,
    columns.findIndex((column) =>
      column.items.some((item) => item.nodeId === receiverId),
    ),
  );
  const fixed = new Set(columns[anchorIndex].items.map((item) => item.nodeId));
  const processingOrder = columns
    .map((_, index) => index)
    .filter((index) => index !== anchorIndex)
    .sort(
      (a, b) =>
        Math.abs(a - anchorIndex) - Math.abs(b - anchorIndex) ||
        a - b,
    );

  processingOrder.forEach((columnIndex) => {
    const column = columns[columnIndex];
    const nodeIds = new Set(column.items.map((item) => item.nodeId));
    const relevantEdges = edges.filter(
      (edge) =>
        (nodeIds.has(edge.source) && fixed.has(edge.target)) ||
        (nodeIds.has(edge.target) && fixed.has(edge.source)),
    );
    const offsets = new Set<number>([0]);

    relevantEdges.forEach((edge) => {
      const sourcePosition = positions.get(edge.source);
      const targetPosition = positions.get(edge.target);
      if (!sourcePosition || !targetPosition) return;
      const handles = handlesForPositions(sourcePosition, targetPosition);
      const sourcePoint = portPoint(sourcePosition, handles.sourceHandle);
      const targetPoint = portPoint(targetPosition, handles.targetHandle);
      offsets.add(
        Number(
          (
            nodeIds.has(edge.source)
              ? targetPoint.y - sourcePoint.y
              : sourcePoint.y - targetPoint.y
          ).toFixed(6),
        ),
      );
    });

    const originalY = new Map(
      column.items.map((item) => [item.nodeId, positions.get(item.nodeId)!.y]),
    );
    const scored = [...offsets].map((offset) => {
      column.items.forEach((item) => {
        positions.set(item.nodeId, {
          ...positions.get(item.nodeId)!,
          y: originalY.get(item.nodeId)! + offset,
        });
      });
      const straight = bestCompatibleStraightSet(
        relevantEdges
          .map((edge) => straightRouteCandidate(edge, positions))
          .filter(
            (
              candidate,
            ): candidate is NonNullable<
              ReturnType<typeof straightRouteCandidate>
            > => candidate !== null,
          ),
      );
      return {
        offset,
        straight,
        straightEdgeIds: new Set(
          straight.map((candidate) => candidate.edge.id),
        ),
        curvedEndpointCount: relevantEdges.length - straight.length,
      };
    });

    const ranked = scored.sort(
      (a, b) =>
        compareStraightSets(a.straight, b.straight) ||
        Math.abs(a.offset) - Math.abs(b.offset) ||
        a.offset - b.offset,
    );
    const baseline = ranked.find(
      (candidate) => Math.abs(candidate.offset) <= ROUTE_EPSILON,
    )!;
    const proposed = ranked[0];
    const fixedEndpointDegree = Math.max(
      0,
      ...relevantEdges.flatMap((edge) => [
        fixed.has(edge.source) ? degrees.get(edge.source) ?? 0 : 0,
        fixed.has(edge.target) ? degrees.get(edge.target) ?? 0 : 0,
      ]),
    );
    const admissible = ranked.filter((candidate) => {
      if (Math.abs(candidate.offset) <= ROUTE_EPSILON) return true;

      const candidateGain =
        candidate.straight.length - baseline.straight.length;
      if (candidateGain >= 2) return true;
      if (
        candidateGain !== 1 ||
        column.items.length > 2 ||
        Math.abs(candidate.offset) > NODE_HEIGHT * 2 ||
        fixedEndpointDegree > 10
      ) {
        return false;
      }

      if (candidate === proposed) return true;

      const preservesExistingStraightRoutes = baseline.straight.every(
        ({ edge }) => candidate.straightEdgeIds.has(edge.id),
      );
      const addsKnownStraightRoute = candidate.straight.some(
        ({ edge }) =>
          !baseline.straightEdgeIds.has(edge.id) &&
          edgeDisplayOrder(edge) < Number.MAX_SAFE_INTEGER,
      );
      return preservesExistingStraightRoutes && addsKnownStraightRoute;
    });
    const best = admissible.sort(
      (a, b) =>
        compareStraightSets(a.straight, b.straight) ||
        a.curvedEndpointCount - b.curvedEndpointCount ||
        Math.abs(a.offset) - Math.abs(b.offset) ||
        a.offset - b.offset,
    )[0] ?? baseline;

    column.items.forEach((item) => {
      positions.set(item.nodeId, {
        ...positions.get(item.nodeId)!,
        y: originalY.get(item.nodeId)! + best.offset,
      });
      fixed.add(item.nodeId);
    });
  });
}

type RouteEntry = {
  edge: TransferFlowEdge;
  sourcePoint: GraphPoint;
  targetPoint: GraphPoint;
  leftPortY: number;
  rightPortY: number;
  orderY: number;
  spanMinX: number;
  spanMaxX: number;
  displayOrder: number;
  preferredLabelBias: number;
};

type RouteAssignment = {
  entry: RouteEntry;
  routeY: number;
  geometry: EdgeRouteGeometry;
  label: EdgeLabelGeometry;
  labelBias: number;
  sourceCurveMode: EdgeCurveMode;
  targetCurveMode: EdgeCurveMode;
};

function routeEntries(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  });

  const entries = edges.flatMap((edge) => {
    if (!edge.data) return [];

    const sourcePosition = positions.get(edge.source);
    const targetPosition = positions.get(edge.target);
    if (!sourcePosition || !targetPosition || !edge.sourceHandle || !edge.targetHandle) return [];

    const sourcePoint = portPoint(
      sourcePosition,
      edge.sourceHandle,
      edge.data.sourcePortRatio,
    );
    const targetPoint = portPoint(
      targetPosition,
      edge.targetHandle,
      edge.data.targetPortRatio,
    );
    const flowsRight = sourcePoint.x <= targetPoint.x;
    const leftPortY = flowsRight ? sourcePoint.y : targetPoint.y;
    const rightPortY = flowsRight ? targetPoint.y : sourcePoint.y;
    const sourceDegree = degree.get(edge.source) ?? 0;
    const targetDegree = degree.get(edge.target) ?? 0;

    edge.data = {
      ...edge.data,
      fanoutHub: sourceDegree >= targetDegree ? edge.source : edge.target,
    };

    return [{
      edge,
      sourcePoint,
      targetPoint,
      leftPortY,
      rightPortY,
      orderY: (leftPortY + rightPortY) / 2,
      spanMinX: Math.min(sourcePoint.x, targetPoint.x),
      spanMaxX: Math.max(sourcePoint.x, targetPoint.x),
      displayOrder: edgeDisplayOrder(edge),
      preferredLabelBias: preferredLabelBias(edge),
    }];
  });

  return entries;
}

function routeComponents(entries: RouteEntry[]) {
  const unseen = new Set(entries);
  const components: RouteEntry[][] = [];

  while (unseen.size > 0) {
    const first = unseen.values().next().value as RouteEntry;
    const component: RouteEntry[] = [];
    const queue = [first];
    unseen.delete(first);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const entry = queue[cursor];
      component.push(entry);

      [...unseen].forEach((candidate) => {
        if (
          Math.min(entry.spanMaxX, candidate.spanMaxX) -
            Math.max(entry.spanMinX, candidate.spanMinX) >
          1
        ) {
          unseen.delete(candidate);
          queue.push(candidate);
        }
      });
    }

    components.push(component);
  }

  return components;
}

function routeGeometryWithModes(
  entry: RouteEntry,
  routeY: number,
  sourceCurveMode: EdgeCurveMode,
  targetCurveMode: EdgeCurveMode,
) {
  return edgeRouteGeometry({
    sourceX: entry.sourcePoint.x,
    sourceY: entry.sourcePoint.y,
    targetX: entry.targetPoint.x,
    targetY: entry.targetPoint.y,
    routeY,
    sourceCurveMode,
    targetCurveMode,
  });
}

function routeCandidates(
  entries: RouteEntry[],
  expansion = entries.length + 1,
  positions?: Map<string, { x: number; y: number }>,
) {
  const values = new Set<number>();
  const baseValues = new Set<number>();

  entries.forEach((entry) => {
    [entry.sourcePoint.y, entry.targetPoint.y].forEach((baseY) => {
      baseValues.add(baseY);
    });
  });

  positions?.forEach((position) => {
    baseValues.add(position.y - NODE_ROUTE_CLEARANCE - 1);
    baseValues.add(position.y + NODE_HEIGHT + NODE_ROUTE_CLEARANCE + 1);
    baseValues.add(
      position.y -
        NODE_ROUTE_CLEARANCE -
        8 +
        17 -
        1,
    );
    baseValues.add(
      position.y +
        NODE_HEIGHT +
        NODE_ROUTE_CLEARANCE +
        8 +
        17 +
        1,
    );
  });

  baseValues.forEach((baseY) => {
    for (let step = -expansion; step <= expansion; step += 1) {
      values.add(Number((baseY + step * MIN_HORIZONTAL_LANE_GAP).toFixed(6)));
    }
  });

  const portValues = entries.flatMap((entry) => [
    entry.sourcePoint.y,
    entry.targetPoint.y,
  ]);
  return [
    ...new Set(
      [...values].map(
        (value) =>
          portValues.find((portY) => Math.abs(portY - value) < 1) ?? value,
      ),
    ),
  ].sort((a, b) => a - b);
}

function compareRouteEntryOrder(a: RouteEntry, b: RouteEntry) {
  return (
    a.orderY - b.orderY ||
    Math.min(a.leftPortY, a.rightPortY) -
      Math.min(b.leftPortY, b.rightPortY) ||
    a.displayOrder - b.displayOrder ||
    a.edge.id.localeCompare(b.edge.id)
  );
}

function orderedRouteEntries(entries: RouteEntry[]) {
  return [...entries].sort(compareRouteEntryOrder);
}

function routeIntersectsNode(
  entry: RouteEntry,
  geometry: EdgeRouteGeometry,
  positions: Map<string, { x: number; y: number }>,
) {
  return [...positions.entries()].some(([nodeId, position]) =>
    pathIntersectsRect(
      geometry.segments,
      nodeRect(position),
      nodeId === entry.edge.source || nodeId === entry.edge.target
        ? -0.75
        : NODE_ROUTE_CLEARANCE,
    ),
  );
}

function edgeEndpointPoints(edge: TransferFlowEdge, geometry: EdgeRouteGeometry) {
  const sourcePoint = geometry.segments[0]?.from;
  const targetPoint = geometry.segments.at(-1)?.to;
  return [
    { nodeId: edge.source, handle: edge.sourceHandle, point: sourcePoint },
    { nodeId: edge.target, handle: edge.targetHandle, point: targetPoint },
  ].filter(
    (
      endpoint,
    ): endpoint is { nodeId: string; handle: string | null | undefined; point: GraphPoint } =>
      Boolean(endpoint.point),
  );
}

function sharedPhysicalPorts(
  aEdge: TransferFlowEdge,
  bEdge: TransferFlowEdge,
  aGeometry: EdgeRouteGeometry,
  bGeometry: EdgeRouteGeometry,
) {
  const aEndpoints = edgeEndpointPoints(aEdge, aGeometry);
  const bEndpoints = edgeEndpointPoints(bEdge, bGeometry);
  return aEndpoints.flatMap((a) =>
    bEndpoints.flatMap((b) =>
      a.nodeId === b.nodeId && a.handle === b.handle ? [a.point] : [],
    ),
  );
}

function routeOrderRelation(a: RouteEntry, b: RouteEntry) {
  const aAbove =
    a.leftPortY <= b.leftPortY + ROUTE_EPSILON &&
    a.rightPortY <= b.rightPortY + ROUTE_EPSILON &&
    (a.leftPortY < b.leftPortY - ROUTE_EPSILON ||
      a.rightPortY < b.rightPortY - ROUTE_EPSILON);
  const bAbove =
    b.leftPortY <= a.leftPortY + ROUTE_EPSILON &&
    b.rightPortY <= a.rightPortY + ROUTE_EPSILON &&
    (b.leftPortY < a.leftPortY - ROUTE_EPSILON ||
      b.rightPortY < a.rightPortY - ROUTE_EPSILON);

  if (aAbove) return -1;
  if (bAbove) return 1;
  if (
    Math.abs(a.leftPortY - b.leftPortY) <= ROUTE_EPSILON &&
    Math.abs(a.rightPortY - b.rightPortY) <= ROUTE_EPSILON
  ) {
    return (
      a.displayOrder - b.displayOrder ||
      a.edge.id.localeCompare(b.edge.id)
    );
  }
  return 0;
}

function labelSlot(
  entry: RouteEntry,
  geometry: EdgeRouteGeometry,
  routeY: number,
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
) {
  const initial = edgeLabelGeometry({
    label: entry.edge.data?.label ?? "",
    horizontalStartX: geometry.horizontalStartX,
    horizontalEndX: geometry.horizontalEndX,
    routeY,
    labelBias: entry.preferredLabelBias,
  });
  const halfWidth = initial.width / 2;
  const minX = geometry.horizontalMinX + halfWidth;
  const maxX = geometry.horizontalMaxX - halfWidth;
  if (minX > maxX) return null;

  const preferredX = Math.min(maxX, Math.max(minX, initial.center.x));
  const xValues = new Set<number>([preferredX, minX, maxX]);
  const addRectBoundaries = (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    xValues.add(rect.x - halfWidth - 1);
    xValues.add(rect.x + rect.width + halfWidth + 1);
  };

  positions.forEach((position) =>
    addRectBoundaries({
      x: position.x - NODE_ROUTE_CLEARANCE,
      y: position.y - NODE_ROUTE_CLEARANCE,
      width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
      height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
    }),
  );
  assignments.forEach((assignment) => addRectBoundaries(assignment.label.rect));

  const labelForX = (x: number) => {
    const denominator = geometry.horizontalEndX - geometry.horizontalStartX;
    const labelBias =
      Math.abs(denominator) <= ROUTE_EPSILON
        ? 0.5
        : (x - geometry.horizontalStartX) / denominator;
    const label = edgeLabelGeometry({
      label: entry.edge.data?.label ?? "",
      horizontalStartX: geometry.horizontalStartX,
      horizontalEndX: geometry.horizontalEndX,
      routeY,
      labelBias,
    });
    return { label, labelBias };
  };

  return [...xValues]
    .filter((x) => x >= minX - ROUTE_EPSILON && x <= maxX + ROUTE_EPSILON)
    .sort(
      (a, b) =>
        Math.abs(a - preferredX) - Math.abs(b - preferredX) ||
        a - b,
    )
    .map(labelForX)
    .find(({ label }) => {
      const hitsNode = [...positions.values()].some((position) =>
        rectsIntersect(label.rect, {
          x: position.x - NODE_ROUTE_CLEARANCE,
          y: position.y - NODE_ROUTE_CLEARANCE,
          width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
          height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
        }),
      );
      if (hitsNode) return false;

      return assignments.every(
        (assignment) =>
          !rectsIntersect(label.rect, assignment.label.rect) &&
          !pathIntersectsRect(assignment.geometry.segments, label.rect) &&
          !pathIntersectsRect(geometry.segments, assignment.label.rect),
      );
    }) ?? null;
}

function routeModes(
  geometry: EdgeRouteGeometry,
  includeExpanded = false,
) {
  const modes: Array<[EdgeCurveMode, EdgeCurveMode]> = [["default", "default"]];
  if (geometry.sourceNeedsCurve) modes.push(["compact", "default"]);
  if (geometry.targetNeedsCurve) modes.push(["default", "compact"]);
  if (geometry.sourceNeedsCurve && geometry.targetNeedsCurve) {
    modes.push(["compact", "compact"]);
  }
  if (includeExpanded && geometry.sourceNeedsCurve) {
    modes.push(["expanded", "default"]);
  }
  if (includeExpanded && geometry.targetNeedsCurve) {
    modes.push(["default", "expanded"]);
  }
  if (
    includeExpanded &&
    geometry.sourceNeedsCurve &&
    geometry.targetNeedsCurve
  ) {
    modes.push(
      ["expanded", "compact"],
      ["compact", "expanded"],
      ["expanded", "expanded"],
    );
  }
  return modes;
}

function shareMixedDirectionGroup(
  a: TransferFlowEdge,
  b: TransferFlowEdge,
) {
  const bGroups = new Set(b.data?.mixedDirectionGroups ?? []);
  return (a.data?.mixedDirectionGroups ?? []).some((group) =>
    bGroups.has(group)
  );
}

type PathIntersectionMode = "none" | "ordered" | "all";

function assignmentCompatible(
  candidate: RouteAssignment,
  other: RouteAssignment,
  pathIntersectionMode: PathIntersectionMode = "ordered",
) {
  const physicalOrder = routeOrderRelation(candidate.entry, other.entry);
  const intervalsOverlap = horizontalIntervalsOverlap(
    candidate.geometry,
    other.geometry,
  );
  const order = intervalsOverlap ? physicalOrder : 0;
  if (
    (order < 0 && candidate.routeY >= other.routeY - ROUTE_EPSILON) ||
    (order > 0 && candidate.routeY <= other.routeY + ROUTE_EPSILON)
  ) {
    return false;
  }
  if (
    intervalsOverlap &&
    Math.abs(candidate.routeY - other.routeY) + ROUTE_EPSILON <
      MIN_HORIZONTAL_LANE_GAP
  ) {
    return false;
  }
  if (
    (pathIntersectionMode === "all" ||
      (pathIntersectionMode === "ordered" && physicalOrder !== 0) ||
      shareMixedDirectionGroup(candidate.entry.edge, other.entry.edge)) &&
    pathsIntersect(
      candidate.geometry.segments,
      other.geometry.segments,
      sharedPhysicalPorts(
        candidate.entry.edge,
        other.entry.edge,
        candidate.geometry,
        other.geometry,
      ),
    )
  ) {
    return false;
  }
  return (
    !rectsIntersect(candidate.label.rect, other.label.rect) &&
    !pathIntersectsRect(candidate.geometry.segments, other.label.rect) &&
    !pathIntersectsRect(other.geometry.segments, candidate.label.rect)
  );
}

function assignmentForRoute(
  entry: RouteEntry,
  routeY: number,
  sourceCurveMode: EdgeCurveMode,
  targetCurveMode: EdgeCurveMode,
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
  pathIntersectionMode: PathIntersectionMode = "ordered",
) {
  const geometry = routeGeometryWithModes(
    entry,
    routeY,
    sourceCurveMode,
    targetCurveMode,
  );
  if (routeIntersectsNode(entry, geometry, positions)) return null;
  const labelResult = labelSlot(
    entry,
    geometry,
    routeY,
    positions,
    assignments,
  );
  if (!labelResult) return null;

  const assignment = {
    entry,
    routeY,
    geometry,
    label: labelResult.label,
    labelBias: labelResult.labelBias,
    sourceCurveMode,
    targetCurveMode,
  } satisfies RouteAssignment;
  return assignments.every((other) =>
    assignmentCompatible(assignment, other, pathIntersectionMode)
  )
    ? assignment
    : null;
}

function assignmentOptions(
  entry: RouteEntry,
  candidates: number[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
  maxOptions = 32,
  pathIntersectionMode: PathIntersectionMode = "ordered",
) {
  const routeModesByCost = candidates
    .flatMap((routeY) => {
      const baseGeometry = routeGeometryWithModes(
        entry,
        routeY,
        "default",
        "default",
      );
      return routeModes(baseGeometry).map(
        ([sourceCurveMode, targetCurveMode]) => ({
          routeY,
          sourceCurveMode,
          targetCurveMode,
          curveCount:
            Number(baseGeometry.sourceNeedsCurve) +
            Number(baseGeometry.targetNeedsCurve),
          targetCurveCount: Number(baseGeometry.targetNeedsCurve),
          compactCount:
            Number(sourceCurveMode === "compact") +
            Number(targetCurveMode === "compact"),
        }),
      );
    })
    .sort((a, b) => {
      const curveDelta = a.curveCount - b.curveCount;
      if (curveDelta !== 0) return curveDelta;
      const distanceDelta =
        Math.abs(a.routeY - entry.orderY) -
        Math.abs(b.routeY - entry.orderY);
      if (Math.abs(distanceDelta) > ROUTE_EPSILON) return distanceDelta;
      return (
        a.targetCurveCount - b.targetCurveCount ||
        a.compactCount - b.compactCount ||
        a.routeY - b.routeY
      );
    });
  const options: RouteAssignment[] = [];
  for (const {
    routeY,
    sourceCurveMode,
    targetCurveMode,
  } of routeModesByCost) {
    const assignment = assignmentForRoute(
      entry,
      routeY,
      sourceCurveMode,
      targetCurveMode,
      positions,
      assignments,
      pathIntersectionMode,
    );
    if (!assignment) continue;
    options.push(assignment);
    if (options.length >= maxOptions) break;
  }
  return options;
}

type RouteEndpoint = "source" | "target";

function mixedDirectionGroupNodeId(group: string) {
  const separator = group.lastIndexOf(":");
  return separator >= 0 ? group.slice(0, separator) : group;
}

function preferredMixedDirectionEndpoints(entry: RouteEntry) {
  const endpoints = new Set<RouteEndpoint>();
  (entry.edge.data?.mixedDirectionGroups ?? []).forEach((group) => {
    const nodeId = mixedDirectionGroupNodeId(group);
    if (entry.edge.source === nodeId) endpoints.add("target");
    if (entry.edge.target === nodeId) endpoints.add("source");
  });
  return endpoints;
}

function mixedDirectionEntryComponents(entries: RouteEntry[]) {
  const mixedEntries = entries.filter(
    (entry) =>
      (entry.edge.data?.mixedDirectionGroups?.length ?? 0) > 0,
  );
  const unseen = new Set(mixedEntries);
  const components: RouteEntry[][] = [];

  while (unseen.size > 0) {
    const first = unseen.values().next().value as RouteEntry;
    const component: RouteEntry[] = [];
    const groups = new Set(
      first.edge.data?.mixedDirectionGroups ?? [],
    );
    const queue = [first];
    unseen.delete(first);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const entry = queue[cursor];
      component.push(entry);
      (entry.edge.data?.mixedDirectionGroups ?? []).forEach((group) =>
        groups.add(group)
      );

      let added = true;
      while (added) {
        added = false;
        [...unseen].forEach((candidate) => {
          if (
            !(candidate.edge.data?.mixedDirectionGroups ?? []).some(
              (group) => groups.has(group),
            )
          ) {
            return;
          }
          unseen.delete(candidate);
          queue.push(candidate);
          (candidate.edge.data?.mixedDirectionGroups ?? []).forEach(
            (group) => groups.add(group),
          );
          added = true;
        });
      }
    }

    components.push(component);
  }

  return components;
}

function mixedDirectionAssignmentOptions(
  entry: RouteEntry,
  candidates: number[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
  allowTwoCurveRoutes: boolean,
  optionLimit: number,
) {
  const preferredEndpoints = preferredMixedDirectionEndpoints(entry);
  const preferredRouteYs: number[] = [];
  if (preferredEndpoints.has("source")) {
    preferredRouteYs.push(entry.sourcePoint.y);
  }
  if (preferredEndpoints.has("target")) {
    preferredRouteYs.push(entry.targetPoint.y);
  }
  const routeYs = [
    ...new Set([
      ...preferredRouteYs,
      entry.sourcePoint.y,
      entry.targetPoint.y,
      ...(allowTwoCurveRoutes
        ? prioritizedRouteCandidates(entry, candidates, optionLimit * 8)
        : []),
    ]),
  ];
  const ranked = routeYs.flatMap((routeY) => {
    const baseGeometry = routeGeometryWithModes(
      entry,
      routeY,
      "default",
      "default",
    );
    const curveCount =
      Number(baseGeometry.sourceNeedsCurve) +
      Number(baseGeometry.targetNeedsCurve);
    if (curveCount > (allowTwoCurveRoutes ? 2 : 1)) return [];

    const preferredCurveCount =
      Number(
        preferredEndpoints.has("source") &&
          baseGeometry.sourceNeedsCurve,
      ) +
      Number(
        preferredEndpoints.has("target") &&
          baseGeometry.targetNeedsCurve,
      );
    return routeModes(baseGeometry).map(
      ([sourceCurveMode, targetCurveMode]) => ({
        routeY,
        sourceCurveMode,
        targetCurveMode,
        curveCount,
        preferredCurveCount,
        compactCount:
          Number(sourceCurveMode === "compact") +
          Number(targetCurveMode === "compact"),
      }),
    );
  }).sort(
    (a, b) =>
      a.preferredCurveCount - b.preferredCurveCount ||
      a.curveCount - b.curveCount ||
      a.compactCount - b.compactCount ||
      Math.abs(a.routeY - entry.orderY) -
        Math.abs(b.routeY - entry.orderY) ||
      a.routeY - b.routeY,
  );

  const options: RouteAssignment[] = [];
  for (const candidate of ranked) {
    const assignment = assignmentForRoute(
      entry,
      candidate.routeY,
      candidate.sourceCurveMode,
      candidate.targetCurveMode,
      positions,
      assignments,
      "all",
    );
    if (!assignment) continue;
    options.push(assignment);
    if (options.length >= optionLimit) break;
  }
  return options;
}

function findMixedDirectionAssignments(
  entries: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
  candidates: number[],
  fixedAssignments: RouteAssignment[],
  maxTwoCurveRoutes: number,
  optionLimit: number,
): RouteAssignment[] | null {
  type SearchState = {
    assignments: RouteAssignment[];
    twoCurveRoutes: number;
    preferredCurveCount: number;
    fullyStraightRoutes: number;
    curvedEndpoints: number;
    compactCount: number;
    routeDisplacement: number;
    labelDisplacement: number;
    stableKey: string;
  };
  const orderedEntries = orderedRouteEntries(entries);
  const beamWidth = Math.max(
    32,
    Math.min(128, optionLimit * 2),
  );
  let states: SearchState[] = [{
    assignments: [],
    twoCurveRoutes: 0,
    preferredCurveCount: 0,
    fullyStraightRoutes: 0,
    curvedEndpoints: 0,
    compactCount: 0,
    routeDisplacement: 0,
    labelDisplacement: 0,
    stableKey: "",
  }];

  for (const entry of orderedEntries) {
    const nextStates: SearchState[] = [];
    for (const state of states) {
      const options = mixedDirectionAssignmentOptions(
        entry,
        candidates,
        positions,
        [...fixedAssignments, ...state.assignments],
        maxTwoCurveRoutes > state.twoCurveRoutes,
        optionLimit,
      );
      const preferredEndpoints =
        preferredMixedDirectionEndpoints(entry);

      for (const assignment of options) {
        const curveCount = assignmentCurveCount(assignment);
        const twoCurveRoutes =
          state.twoCurveRoutes + Number(curveCount === 2);
        if (twoCurveRoutes > maxTwoCurveRoutes) continue;
        const preferredCurveCount =
          Number(
            preferredEndpoints.has("source") &&
              assignment.geometry.sourceNeedsCurve,
          ) +
          Number(
            preferredEndpoints.has("target") &&
              assignment.geometry.targetNeedsCurve,
          );
        const compactCount =
          Number(assignment.sourceCurveMode === "compact") +
          Number(assignment.targetCurveMode === "compact");
        nextStates.push({
          assignments: [...state.assignments, assignment],
          twoCurveRoutes,
          preferredCurveCount:
            state.preferredCurveCount + preferredCurveCount,
          fullyStraightRoutes:
            state.fullyStraightRoutes + Number(curveCount === 0),
          curvedEndpoints: state.curvedEndpoints + curveCount,
          compactCount: state.compactCount + compactCount,
          routeDisplacement:
            state.routeDisplacement +
            Math.abs(assignment.routeY - entry.orderY),
          labelDisplacement:
            state.labelDisplacement +
            Math.abs(
              assignment.labelBias - entry.preferredLabelBias,
            ),
          stableKey:
            `${state.stableKey}|${entry.edge.id}:` +
            `${assignment.routeY}:` +
            `${assignment.sourceCurveMode}:` +
            assignment.targetCurveMode,
        });
      }
    }
    if (nextStates.length === 0) return null;

    nextStates.sort(
      (a, b) =>
        a.twoCurveRoutes - b.twoCurveRoutes ||
        a.preferredCurveCount - b.preferredCurveCount ||
        b.fullyStraightRoutes - a.fullyStraightRoutes ||
        a.curvedEndpoints - b.curvedEndpoints ||
        a.compactCount - b.compactCount ||
        a.routeDisplacement - b.routeDisplacement ||
        a.labelDisplacement - b.labelDisplacement ||
        a.stableKey.localeCompare(b.stableKey),
    );
    states = nextStates.slice(0, beamWidth);
  }

  return states[0]?.assignments ?? null;
}

function optimizeMixedDirectionAssignments(
  component: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
  candidates: number[],
  expansion: number,
) {
  for (const mixedComponent of mixedDirectionEntryComponents(component)) {
    const mixedEntries = new Set(mixedComponent);
    const fixedAssignments = assignments.filter(
      (assignment) => !mixedEntries.has(assignment.entry),
    );
    const optionLimit = Math.max(
      8,
      Math.ceil(Math.sqrt(expansion)) * 2,
    );
    const optimized = findMixedDirectionAssignments(
      mixedComponent,
      positions,
      candidates,
      fixedAssignments,
      mixedComponent.length,
      optionLimit,
    );
    if (!optimized) return false;

    assignments.splice(
      0,
      assignments.length,
      ...fixedAssignments,
      ...optimized,
    );
  }

  return true;
}

function minimumStandaloneCurveCount(
  entry: RouteEntry,
  candidates: number[],
  positions: Map<string, { x: number; y: number }>,
) {
  const option = assignmentOptions(entry, candidates, positions, [], 1)[0];
  return option
    ? Number(option.geometry.sourceNeedsCurve) +
        Number(option.geometry.targetNeedsCurve)
    : 3;
}

function prioritizedRouteCandidates(
  entry: RouteEntry,
  candidates: number[],
  limit = 96,
) {
  const laneSteps = Math.max(8, Math.ceil(limit / 8));
  const laneGrid = new Set<number>();
  for (let step = -laneSteps; step <= laneSteps; step += 1) {
    laneGrid.add(
      Number(
        (entry.sourcePoint.y + step * MIN_HORIZONTAL_LANE_GAP).toFixed(6),
      ),
    );
    laneGrid.add(
      Number(
        (entry.targetPoint.y + step * MIN_HORIZONTAL_LANE_GAP).toFixed(6),
      ),
    );
  }
  const nearby = [...candidates]
    .sort((a, b) => {
      const aGeometry = routeGeometryWithModes(entry, a, "default", "default");
      const bGeometry = routeGeometryWithModes(entry, b, "default", "default");
      const curveDelta =
        Number(aGeometry.sourceNeedsCurve) +
        Number(aGeometry.targetNeedsCurve) -
        Number(bGeometry.sourceNeedsCurve) -
        Number(bGeometry.targetNeedsCurve);
      if (curveDelta !== 0) return curveDelta;
      const distanceDelta =
        Math.abs(a - entry.orderY) - Math.abs(b - entry.orderY);
      if (Math.abs(distanceDelta) > ROUTE_EPSILON) return distanceDelta;
      return (
        Number(aGeometry.targetNeedsCurve) -
          Number(bGeometry.targetNeedsCurve) ||
        a - b
      );
    })
    .slice(0, Math.max(0, limit - laneGrid.size));
  return [...new Set([...laneGrid, ...nearby])];
}

function writeAssignment(assignment: RouteAssignment) {
  const data = assignment.entry.edge.data;
  if (!data) return;
  assignment.entry.edge.data = {
    ...data,
    routeY: assignment.routeY,
    labelBias: assignment.labelBias,
    sourceCurveMode: assignment.sourceCurveMode,
    targetCurveMode: assignment.targetCurveMode,
  };
}

function entriesFormReciprocalBoundary(upper: RouteEntry, lower: RouteEntry) {
  return (
    upper.edge.source === lower.edge.target &&
    upper.edge.target === lower.edge.source &&
    upper.leftPortY + ROUTE_EPSILON < lower.leftPortY &&
    upper.rightPortY + ROUTE_EPSILON < lower.rightPortY
  );
}

function assignmentCurveCount(assignment: RouteAssignment) {
  return (
    Number(assignment.geometry.sourceNeedsCurve) +
    Number(assignment.geometry.targetNeedsCurve)
  );
}

function entryPointAtNode(entry: RouteEntry, nodeId: string) {
  if (entry.edge.source === nodeId) return entry.sourcePoint;
  if (entry.edge.target === nodeId) return entry.targetPoint;
  return null;
}

function expandedAssignmentOptions(
  entry: RouteEntry,
  routeY: number,
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
) {
  const baseGeometry = routeGeometryWithModes(
    entry,
    routeY,
    "default",
    "default",
  );
  return routeModes(baseGeometry, true).flatMap(
    ([sourceCurveMode, targetCurveMode]) => {
      const assignment = assignmentForRoute(
        entry,
        routeY,
        sourceCurveMode,
        targetCurveMode,
        positions,
        assignments,
        "all",
      );
      return assignment ? [assignment] : [];
    },
  );
}

function optimizeMixedSidePeerAssignments(
  component: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
) {
  const mixedGroups = [
    ...new Set(
      component.flatMap(
        (entry) => entry.edge.data?.mixedDirectionGroups ?? [],
      ),
    ),
  ].sort();

  for (const mixedGroup of mixedGroups) {
    const hubId = mixedDirectionGroupNodeId(mixedGroup);
    const groupEntries = component.filter((entry) =>
      entry.edge.data?.mixedDirectionGroups?.includes(mixedGroup)
    );
    const byPeer = new Map<string, RouteEntry[]>();
    groupEntries.forEach((entry) => {
      const peerId =
        entry.edge.source === hubId
          ? entry.edge.target
          : entry.edge.source;
      const peerEntries = byPeer.get(peerId) ?? [];
      peerEntries.push(entry);
      byPeer.set(peerId, peerEntries);
    });
    const peers = [...byPeer.entries()]
      .filter(([, entries]) => {
        if (entries.length === 1) return true;
        return (
          entries.length === 2 &&
          entries[0].edge.source === entries[1].edge.target &&
          entries[0].edge.target === entries[1].edge.source
        );
      })
      .sort(([aId], [bId]) => {
        const a = positions.get(aId) ?? { x: 0, y: 0 };
        const b = positions.get(bId) ?? { x: 0, y: 0 };
        return a.y - b.y || a.x - b.x || aId.localeCompare(bId);
      });
    const optimizedEntries = new Set(
      peers.flatMap(([, entries]) => entries),
    );
    if (
      optimizedEntries.size === 0 ||
      optimizedEntries.size !== groupEntries.length
    ) {
      continue;
    }
    const fixedAssignments = assignments.filter(
      (assignment) => !optimizedEntries.has(assignment.entry),
    );
    const baselineByEntry = new Map(
      assignments.map((assignment) => [assignment.entry, assignment]),
    );
    const needsOptimization = peers.some(([peerId, peerEntries]) => {
      const hasStraightIncidentRoute = peerEntries.some((entry) => {
        const point = entryPointAtNode(entry, peerId);
        const assignment = baselineByEntry.get(entry);
        return (
          point &&
          assignment &&
          Math.abs(assignment.routeY - point.y) < 1
        );
      });
      const hasCompactReciprocalGap =
        peerEntries.length !== 2 ||
        Math.abs(
          Math.abs(
            baselineByEntry.get(peerEntries[0])!.routeY -
              baselineByEntry.get(peerEntries[1])!.routeY,
          ) - MIN_HORIZONTAL_LANE_GAP,
        ) <= ROUTE_EPSILON;
      return !hasStraightIncidentRoute || !hasCompactReciprocalGap;
    });
    if (!needsOptimization) continue;

    type SearchState = {
      assignments: RouteAssignment[];
      expandedCount: number;
      displacement: number;
      stableKey: string;
    };
    let states: SearchState[] = [{
      assignments: [],
      expandedCount: 0,
      displacement: 0,
      stableKey: "",
    }];
    let groupFailed = false;

    for (const [peerId, peerEntries] of peers) {
      const nextStates: SearchState[] = [];
      const anchors = [...peerEntries].sort((a, b) => {
        const aPoint = entryPointAtNode(a, peerId);
        const bPoint = entryPointAtNode(b, peerId);
        return (
          (aPoint?.y ?? 0) - (bPoint?.y ?? 0) ||
          a.displayOrder - b.displayOrder ||
          a.edge.id.localeCompare(b.edge.id)
        );
      });

      states.forEach((state) => {
        const existing = [...fixedAssignments, ...state.assignments];
        anchors.forEach((anchor) => {
          const anchorPoint = entryPointAtNode(anchor, peerId);
          if (!anchorPoint) return;
          expandedAssignmentOptions(
            anchor,
            anchorPoint.y,
            positions,
            existing,
          ).forEach((anchorAssignment) => {
            const configurations: RouteAssignment[][] = [];
            if (peerEntries.length === 1) {
              configurations.push([anchorAssignment]);
            } else {
              const companion = peerEntries.find(
                (entry) => entry !== anchor,
              );
              const companionPoint = companion
                ? entryPointAtNode(companion, peerId)
                : null;
              if (!companion || !companionPoint) return;
              const direction =
                companionPoint.y >= anchorPoint.y ? 1 : -1;
              expandedAssignmentOptions(
                companion,
                anchorPoint.y +
                  direction * MIN_HORIZONTAL_LANE_GAP,
                positions,
                [...existing, anchorAssignment],
              ).forEach((companionAssignment) =>
                configurations.push([
                  anchorAssignment,
                  companionAssignment,
                ])
              );
            }

            configurations.forEach((configuration) => {
              nextStates.push({
                assignments: [
                  ...state.assignments,
                  ...configuration,
                ],
                expandedCount:
                  state.expandedCount +
                  configuration.reduce(
                    (count, assignment) =>
                      count +
                      Number(
                        assignment.sourceCurveMode === "expanded",
                      ) +
                      Number(
                        assignment.targetCurveMode === "expanded",
                      ),
                    0,
                  ),
                displacement:
                  state.displacement +
                  configuration.reduce(
                    (total, assignment) =>
                      total +
                      Math.abs(
                        assignment.routeY -
                          baselineByEntry.get(assignment.entry)!.routeY,
                      ),
                    0,
                  ),
                stableKey:
                  `${state.stableKey}|` +
                  configuration
                    .map(
                      (assignment) =>
                        `${assignment.entry.edge.id}:` +
                        `${assignment.routeY}:` +
                        `${assignment.sourceCurveMode}:` +
                        assignment.targetCurveMode,
                    )
                    .join("|"),
              });
            });
          });
        });
      });
      if (nextStates.length === 0) {
        groupFailed = true;
        break;
      }
      nextStates.sort(
        (a, b) =>
          a.expandedCount - b.expandedCount ||
          a.displacement - b.displacement ||
          a.stableKey.localeCompare(b.stableKey),
      );
      states = nextStates.slice(0, 128);
    }

    if (groupFailed) continue;
    const best = states[0];
    if (!best || best.assignments.length !== optimizedEntries.size) {
      continue;
    }
    assignments.splice(
      0,
      assignments.length,
      ...fixedAssignments,
      ...best.assignments,
    );
  }

}

function rebalanceCompactReciprocalLanes(
  entries: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
) {
  const ordered = orderedRouteEntries(entries);
  const baseCandidates = routeCandidates(
    entries,
    entries.length + positions.size + 1,
    positions,
  );

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const upper = ordered[index];
    const lower = ordered[index + 1];
    if (!entriesFormReciprocalBoundary(upper, lower)) continue;
    const currentUpper = assignments.find(
      (assignment) => assignment.entry === upper,
    );
    const currentLower = assignments.find(
      (assignment) => assignment.entry === lower,
    );
    if (!currentUpper || !currentLower) continue;
    const currentGap = currentLower.routeY - currentUpper.routeY;
    if (currentGap > RECIPROCAL_COMPACTION_THRESHOLD + ROUTE_EPSILON) {
      continue;
    }
    if (
      currentUpper.sourceCurveMode === "compact" ||
      currentUpper.targetCurveMode === "compact" ||
      currentLower.sourceCurveMode === "compact" ||
      currentLower.targetCurveMode === "compact"
    ) {
      continue;
    }

    const others = assignments.filter(
      (assignment) =>
        assignment !== currentUpper && assignment !== currentLower,
    );
    const essentialCandidates = [
      currentUpper.routeY,
      currentLower.routeY,
      upper.sourcePoint.y,
      upper.targetPoint.y,
      lower.sourcePoint.y,
      lower.targetPoint.y,
      ...[...positions.values()].flatMap((position) => [
        position.y - NODE_ROUTE_CLEARANCE - 1,
        position.y + NODE_HEIGHT + NODE_ROUTE_CLEARANCE + 1,
      ]),
    ];
    const nearbyCandidates = [...baseCandidates]
      .filter((candidate, candidateIndex, values) =>
        values.indexOf(candidate) === candidateIndex
      )
      .sort(
        (a, b) =>
          Math.min(
            Math.abs(a - upper.orderY),
            Math.abs(a - lower.orderY),
            Math.abs(a - currentUpper.routeY),
            Math.abs(a - currentLower.routeY),
          ) -
            Math.min(
              Math.abs(b - upper.orderY),
              Math.abs(b - lower.orderY),
              Math.abs(b - currentUpper.routeY),
              Math.abs(b - currentLower.routeY),
            ) ||
          a - b,
      )
      .slice(0, 64);
    const candidates = [...new Set([
      ...essentialCandidates,
      ...nearbyCandidates,
    ])];
    const currentCurveCount =
      assignmentCurveCount(currentUpper) + assignmentCurveCount(currentLower);
    const currentDistance =
      Math.abs(currentUpper.routeY - upper.orderY) +
      Math.abs(currentLower.routeY - lower.orderY);

    const pairOptions = candidates.flatMap((upperRouteY) => {
      const upperBase = routeGeometryWithModes(
        upper,
        upperRouteY,
        "default",
        "default",
      );
      const upperOptions = routeModes(upperBase).flatMap(
        ([sourceCurveMode, targetCurveMode]) => {
          const option = assignmentForRoute(
            upper,
            upperRouteY,
            sourceCurveMode,
            targetCurveMode,
            positions,
            others,
          );
          return option ? [option] : [];
        },
      );

      return candidates.flatMap((lowerRouteY) => {
        const gap = lowerRouteY - upperRouteY;
        if (
          gap + ROUTE_EPSILON < MIN_HORIZONTAL_LANE_GAP ||
          gap > RECIPROCAL_COMPACTION_THRESHOLD + ROUTE_EPSILON
        ) {
          return [];
        }
        const lowerBase = routeGeometryWithModes(
          lower,
          lowerRouteY,
          "default",
          "default",
        );

        return upperOptions.flatMap((upperOption) =>
          routeModes(lowerBase).flatMap(
            ([sourceCurveMode, targetCurveMode]) => {
              const lowerOption = assignmentForRoute(
                lower,
                lowerRouteY,
                sourceCurveMode,
                targetCurveMode,
                positions,
                [...others, upperOption],
              );
              if (!lowerOption) return [];
              const curveCount =
                assignmentCurveCount(upperOption) +
                assignmentCurveCount(lowerOption);
              return curveCount <= currentCurveCount
                ? [{
                    upper: upperOption,
                    lower: lowerOption,
                    curveCount,
                    distance:
                      Math.abs(upperOption.routeY - upper.orderY) +
                      Math.abs(lowerOption.routeY - lower.orderY),
                    compactCount:
                      Number(upperOption.sourceCurveMode === "compact") +
                      Number(upperOption.targetCurveMode === "compact") +
                      Number(lowerOption.sourceCurveMode === "compact") +
                      Number(lowerOption.targetCurveMode === "compact"),
                  }]
                : [];
            },
          ),
        );
      });
    });
    const best = pairOptions.sort(
      (a, b) =>
        a.curveCount - b.curveCount ||
        a.distance - b.distance ||
        a.compactCount - b.compactCount ||
        a.upper.routeY - b.upper.routeY,
    )[0];
    if (
      !best ||
      best.curveCount > currentCurveCount ||
      (best.curveCount === currentCurveCount &&
        best.distance >= currentDistance - ROUTE_EPSILON)
    ) {
      continue;
    }

    assignments[assignments.indexOf(currentUpper)] = best.upper;
    assignments[assignments.indexOf(currentLower)] = best.lower;
    writeAssignment(best.upper);
    writeAssignment(best.lower);
  }
}

function compactReciprocalLanes(
  entries: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
  assignments: RouteAssignment[],
) {
  const ordered = orderedRouteEntries(entries);
  const candidates = routeCandidates(
    entries,
    entries.length + positions.size + 1,
    positions,
  );

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const upper = ordered[index];
    const lower = ordered[index + 1];
    if (!entriesFormReciprocalBoundary(upper, lower)) continue;

    const upperAssignment = assignments.find(
      (assignment) => assignment.entry === upper,
    );
    const lowerAssignment = assignments.find(
      (assignment) => assignment.entry === lower,
    );
    if (!upperAssignment || !lowerAssignment) continue;
    const currentGap = lowerAssignment.routeY - upperAssignment.routeY;
    if (currentGap <= RECIPROCAL_COMPACTION_THRESHOLD + ROUTE_EPSILON) continue;
    const usesDynamicPairPorts = [
      upper.edge.sourceHandle,
      upper.edge.targetHandle,
      lower.edge.sourceHandle,
      lower.edge.targetHandle,
    ].every((handle) => handle?.startsWith("dynamic:"));
    const currentPairCurveCount =
      assignmentCurveCount(upperAssignment) +
      assignmentCurveCount(lowerAssignment);

    const moves = [
      {
        current: upperAssignment,
        reciprocal: lowerAssignment,
        exact: lowerAssignment.routeY - MIN_HORIZONTAL_LANE_GAP,
      },
      {
        current: lowerAssignment,
        reciprocal: upperAssignment,
        exact: upperAssignment.routeY + MIN_HORIZONTAL_LANE_GAP,
      },
    ].flatMap(({ current, reciprocal, exact }) => {
      const currentCurves = [
        current.geometry.sourceNeedsCurve,
        current.geometry.targetNeedsCurve,
      ];
      const movesToward = (routeY: number) =>
        current.routeY < reciprocal.routeY
          ? routeY > current.routeY + ROUTE_EPSILON &&
            routeY <= exact + ROUTE_EPSILON
          : routeY < current.routeY - ROUTE_EPSILON &&
            routeY >= exact - ROUTE_EPSILON;
      const routeYs = [exact, ...candidates]
        .filter((routeY, candidateIndex, values) => values.indexOf(routeY) === candidateIndex)
        .filter(movesToward)
        .sort(
          (a, b) =>
            Math.abs(a - reciprocal.routeY) -
              Math.abs(b - reciprocal.routeY) ||
            Math.abs(a - current.routeY) - Math.abs(b - current.routeY) ||
            a - b,
        );
      const others = assignments.filter(
        (assignment) =>
          assignment !== current && assignment !== reciprocal,
      );

      return routeYs.flatMap((routeY) => {
        const baseGeometry = routeGeometryWithModes(
          current.entry,
          routeY,
          "default",
          "default",
        );
        if (
          !usesDynamicPairPorts &&
          (baseGeometry.sourceNeedsCurve !== currentCurves[0] ||
            baseGeometry.targetNeedsCurve !== currentCurves[1])
        ) {
          return [];
        }
        const reciprocalBase = routeGeometryWithModes(
          reciprocal.entry,
          reciprocal.routeY,
          "default",
          "default",
        );
        return routeModes(reciprocalBase).flatMap(
          ([reciprocalSourceMode, reciprocalTargetMode]) => {
            const reciprocalCandidate = assignmentForRoute(
              reciprocal.entry,
              reciprocal.routeY,
              reciprocalSourceMode,
              reciprocalTargetMode,
              positions,
              others,
            );
            if (!reciprocalCandidate) return [];

            return routeModes(baseGeometry).flatMap(
              ([sourceCurveMode, targetCurveMode]) => {
                const candidate = assignmentForRoute(
                  current.entry,
                  routeY,
                  sourceCurveMode,
                  targetCurveMode,
                  positions,
                  [...others, reciprocalCandidate],
                );
                if (!candidate) return [];
                const pairCurveCount =
                  assignmentCurveCount(candidate) +
                  assignmentCurveCount(reciprocalCandidate);
                return pairCurveCount <=
                  currentPairCurveCount + (usesDynamicPairPorts ? 1 : 0)
                  ? [{ moved: candidate, reciprocal: reciprocalCandidate }]
                  : [];
              },
            );
          },
        );
      });
    });

    const best = moves.sort(
      (a, b) =>
        Math.abs(a.moved.routeY -
          (a.moved.entry === upper ? lowerAssignment.routeY : upperAssignment.routeY)) -
          Math.abs(b.moved.routeY -
            (b.moved.entry === upper ? lowerAssignment.routeY : upperAssignment.routeY)) ||
        Math.abs(a.moved.routeY -
          assignments.find((assignment) => assignment.entry === a.moved.entry)!.routeY) -
          Math.abs(b.moved.routeY -
            assignments.find((assignment) => assignment.entry === b.moved.entry)!.routeY) ||
        a.moved.entry.displayOrder - b.moved.entry.displayOrder ||
        a.moved.entry.edge.id.localeCompare(b.moved.entry.edge.id)
    )[0];
    if (!best) continue;

    const movedIndex = assignments.findIndex(
      (assignment) => assignment.entry === best.moved.entry,
    );
    const reciprocalIndex = assignments.findIndex(
      (assignment) => assignment.entry === best.reciprocal.entry,
    );
    assignments[movedIndex] = best.moved;
    assignments[reciprocalIndex] = best.reciprocal;
    writeAssignment(best.moved);
    writeAssignment(best.reciprocal);
  }
}

function assignComponentLanes(
  component: RouteEntry[],
  positions: Map<string, { x: number; y: number }>,
) {
  let expansion = component.length + positions.size + 1;
  const pathIntersectionMode: PathIntersectionMode = "ordered";
  const hasMixedDirectionConstraints = component.some(
    (entry) =>
      (entry.edge.data?.mixedDirectionGroups?.length ?? 0) > 0,
  );

  while (true) {
    const candidates = routeCandidates(component, expansion, positions);
    const minimumCurves = new Map(
      component.map((entry) => [
        entry,
        minimumStandaloneCurveCount(entry, candidates, positions),
      ]),
    );
    const entries = [...component].sort((a, b) => {
      const aCurves = minimumCurves.get(a) ?? 3;
      const bCurves = minimumCurves.get(b) ?? 3;
      return (
        aCurves - bCurves ||
        compareRouteEntryOrder(a, b) ||
        a.edge.id.localeCompare(b.edge.id)
      );
    });
    const candidatesByEntry = new Map(
      entries.map((entry) => [
        entry,
        prioritizedRouteCandidates(entry, candidates),
      ]),
    );
    const assignments: RouteAssignment[] = [];
    let failed = false;
    for (const entry of entries) {
      const assignment = assignmentOptions(
        entry,
        candidates,
        positions,
        assignments,
        1,
        pathIntersectionMode,
      )[0];
      if (!assignment) {
        failed = true;
        break;
      }
      assignments.push(assignment);
    }

    if (failed) {
      assignments.length = 0;
      const assignRemaining = (
        remaining: RouteEntry[],
        remainingPathIntersectionMode: PathIntersectionMode,
      ): boolean => {
        if (remaining.length === 0) return true;
        const choices = remaining
          .map((entry, entryIndex) => ({
            entry,
            entryIndex,
            options: assignmentOptions(
              entry,
              candidatesByEntry.get(entry) ?? candidates,
              positions,
              assignments,
              4,
              remainingPathIntersectionMode,
            ),
          }))
          .sort(
            (a, b) =>
              a.options.length - b.options.length ||
              a.entryIndex - b.entryIndex,
          );
        const choice = choices[0];
        if (choice.options.length === 0) return false;
        const nextRemaining = remaining.filter(
          (entry) => entry !== choice.entry,
        );
        for (const assignment of choice.options) {
          assignments.push(assignment);
          if (
            assignRemaining(
              nextRemaining,
              remainingPathIntersectionMode,
            )
          ) {
            return true;
          }
          assignments.pop();
        }
        return false;
      };
      if (!hasMixedDirectionConstraints) {
        failed = !assignRemaining(
          entries,
          pathIntersectionMode,
        );
      }
      if (failed) {
        assignments.length = 0;
        failed = false;
        for (const entry of entries) {
          const assignment = assignmentOptions(
            entry,
            candidates,
            positions,
            assignments,
            1,
            "none",
          )[0];
          if (!assignment) {
            failed = true;
            break;
          }
          assignments.push(assignment);
        }
      }
      if (failed) {
        assignments.length = 0;
        failed = false;
        for (const entry of orderedRouteEntries(component)) {
          const assignment = assignmentOptions(
            entry,
            candidates,
            positions,
            assignments,
            1,
            "none",
          )[0];
          if (!assignment) {
            failed = true;
            break;
          }
          assignments.push(assignment);
        }
      }
      if (failed) {
        assignments.length = 0;
        failed = !assignRemaining(entries, "none");
      }
    }

    if (failed) {
      expansion *= 2;
      continue;
    }

    if (
      !optimizeMixedDirectionAssignments(
        component,
        positions,
        assignments,
        candidates,
        expansion,
      )
    ) {
      expansion *= 2;
      continue;
    }

    assignments.forEach(writeAssignment);
    rebalanceCompactReciprocalLanes(component, positions, assignments);
    compactReciprocalLanes(component, positions, assignments);
    optimizeMixedSidePeerAssignments(
      component,
      positions,
      assignments,
    );
    assignments.forEach(writeAssignment);
    return;
  }
}

type ReciprocalPair = {
  key: string;
  leftToRight: TransferFlowEdge;
  rightToLeft: TransferFlowEdge;
};

function orderedReciprocalPairs(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const grouped = new Map<string, TransferFlowEdge[]>();
  edges.forEach((edge) => {
    const key = connectedPairKey(edge.source, edge.target);
    const group = grouped.get(key) ?? [];
    group.push(edge);
    grouped.set(key, group);
  });

  return [...grouped.entries()].flatMap(([key, group]) => {
    const nodeIds = [...new Set(group.flatMap((edge) => [
      edge.source,
      edge.target,
    ]))];
    if (nodeIds.length !== 2) return [];
    const [left, right] = nodeIds.sort((a, b) => {
      const aCenter = nodeCenter(positions, a);
      const bCenter = nodeCenter(positions, b);
      return aCenter.x - bCenter.x || a.localeCompare(b);
    });
    const byTransfer = (a: TransferFlowEdge, b: TransferFlowEdge) =>
      edgeDisplayOrder(a) - edgeDisplayOrder(b) ||
      a.id.localeCompare(b.id);
    const leftToRight = group
      .filter((edge) => edge.source === left && edge.target === right)
      .sort(byTransfer);
    const rightToLeft = group
      .filter((edge) => edge.source === right && edge.target === left)
      .sort(byTransfer);

    return Array.from(
      { length: Math.min(leftToRight.length, rightToLeft.length) },
      (_, index) => ({
        key: `${key}:${index}`,
        leftToRight: leftToRight[index],
        rightToLeft: rightToLeft[index],
      }),
    );
  });
}

function reciprocalPairInterveningEdges(
  pair: ReciprocalPair,
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const forwardRoute = edgeHorizontalRoute(pair.leftToRight, positions);
  const reverseRoute = edgeHorizontalRoute(pair.rightToLeft, positions);
  const forwardY = pair.leftToRight.data?.routeY;
  const reverseY = pair.rightToLeft.data?.routeY;
  if (
    !forwardRoute ||
    !reverseRoute ||
    forwardY === undefined ||
    reverseY === undefined
  ) {
    return [];
  }

  const minY = Math.min(forwardY, reverseY);
  const maxY = Math.max(forwardY, reverseY);
  return edges.filter((edge) => {
    if (edge === pair.leftToRight || edge === pair.rightToLeft || !edge.data) {
      return false;
    }
    if (
      edge.data.routeY <= minY + ROUTE_EPSILON ||
      edge.data.routeY >= maxY - ROUTE_EPSILON
    ) {
      return false;
    }
    const route = edgeHorizontalRoute(edge, positions);
    return Boolean(
      route &&
        (horizontalIntervalsOverlap(route, forwardRoute) ||
          horizontalIntervalsOverlap(route, reverseRoute)),
    );
  });
}

function edgeSideAtNode(
  edge: TransferFlowEdge,
  nodeId: string,
  positions: Map<string, { x: number; y: number }>,
): GraphPortSide {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  return nodeCenter(positions, otherId).x >= nodeCenter(positions, nodeId).x
    ? "right"
    : "left";
}

function orderedSideEdges(
  edges: TransferFlowEdge[],
  nodeId: string,
  positions: Map<string, { x: number; y: number }>,
) {
  const byPeer = new Map<string, TransferFlowEdge[]>();
  edges.forEach((edge) => {
    const peerId = edge.source === nodeId ? edge.target : edge.source;
    const group = byPeer.get(peerId) ?? [];
    group.push(edge);
    byPeer.set(peerId, group);
  });
  const byTransfer = (a: TransferFlowEdge, b: TransferFlowEdge) =>
    edgeDisplayOrder(a) - edgeDisplayOrder(b) ||
    a.id.localeCompare(b.id);

  return [...byPeer.entries()]
    .sort(([aId, aEdges], [bId, bEdges]) => {
      const aPosition = positions.get(aId) ?? { x: 0, y: 0 };
      const bPosition = positions.get(bId) ?? { x: 0, y: 0 };
      return (
        aPosition.y - bPosition.y ||
        Math.min(...aEdges.map(edgeDisplayOrder)) -
          Math.min(...bEdges.map(edgeDisplayOrder)) ||
        aId.localeCompare(bId)
      );
    })
    .flatMap(([, peerEdges]) => {
      const leftToRight = peerEdges
        .filter(
          (edge) =>
            nodeCenter(positions, edge.source).x <=
            nodeCenter(positions, edge.target).x,
        )
        .sort(byTransfer);
      const rightToLeft = peerEdges
        .filter((edge) => !leftToRight.includes(edge))
        .sort(byTransfer);
      const paired: TransferFlowEdge[] = [];
      const pairCount = Math.min(leftToRight.length, rightToLeft.length);
      for (let index = 0; index < pairCount; index += 1) {
        paired.push(leftToRight[index], rightToLeft[index]);
      }
      return [
        ...paired,
        ...leftToRight.slice(pairCount),
        ...rightToLeft.slice(pairCount),
      ];
    });
}

function dynamicPortId(
  edge: TransferFlowEdge,
  nodeId: string,
  type: "source" | "target",
  side: GraphPortSide,
  purpose: "reciprocal" | "mixed" = "reciprocal",
) {
  const purposePrefix = purpose === "mixed" ? "mixed:" : "";
  return `dynamic:${purposePrefix}${type}:${nodeId}:${edge.id}:${side}`;
}

function assignOrderedSidePorts(
  nodes: AddressFlowNode[],
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  affectedSides: Set<string>,
  purpose: "reciprocal" | "mixed" = "reciprocal",
) {
  let changed = false;

  [...affectedSides].sort().forEach((key) => {
    const separator = key.lastIndexOf(":");
    const nodeId = key.slice(0, separator);
    const side = key.slice(separator + 1) as GraphPortSide;
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const sideEdges = edges.filter(
      (edge) =>
        (edge.source === nodeId || edge.target === nodeId) &&
        edgeSideAtNode(edge, nodeId, positions) === side,
    );
    const ordered = orderedSideEdges(sideEdges, nodeId, positions);
    if (ordered.length === 0) return;
    const dynamicPorts: GraphPortSpec[] = ordered.map((edge, index) => {
      const type = edge.source === nodeId ? "source" : "target";
      const ratio =
        ordered.length === 1
          ? (UPPER_PORT_RATIO + LOWER_PORT_RATIO) / 2
          : UPPER_PORT_RATIO +
            ((LOWER_PORT_RATIO - UPPER_PORT_RATIO) * index) /
              (ordered.length - 1);
      const id = dynamicPortId(
        edge,
        nodeId,
        type,
        side,
        purpose,
      );
      if (type === "source") {
        edge.sourceHandle = id;
        edge.data = {
          ...edge.data!,
          sourcePortRatio: ratio,
        };
      } else {
        edge.targetHandle = id;
        edge.data = {
          ...edge.data!,
          targetPortRatio: ratio,
        };
      }
      return { id, type, side, ratio };
    });
    node.data = {
      ...node.data,
      ports: [
        ...node.data.ports.filter((port) => port.side !== side),
        ...dynamicPorts,
      ],
    };
    changed = true;
  });

  return changed;
}

export function assignReciprocalBundlePorts(
  nodes: AddressFlowNode[],
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  });
  const problemPairs = orderedReciprocalPairs(edges, positions).filter(
    (pair) => {
      const endpoints = [
        pair.leftToRight.source,
        pair.leftToRight.target,
      ];
      return (
        endpoints.some((nodeId) => degree.get(nodeId) === 2) &&
        reciprocalPairInterveningEdges(pair, edges, positions).length > 0
      );
    },
  );
  if (problemPairs.length === 0) return false;

  const pairsByNodeSide = new Map<string, ReciprocalPair[]>();
  problemPairs.forEach((pair) => {
    [pair.leftToRight.source, pair.leftToRight.target].forEach((nodeId) => {
      const side = edgeSideAtNode(pair.leftToRight, nodeId, positions);
      const key = `${nodeId}:${side}`;
      const group = pairsByNodeSide.get(key) ?? [];
      if (!group.some((candidate) => candidate.key === pair.key)) {
        group.push(pair);
      }
      pairsByNodeSide.set(key, group);
    });
  });

  const congestedSides = [...pairsByNodeSide.entries()]
    .filter(([key, pairs]) => {
      const separator = key.lastIndexOf(":");
      const nodeId = key.slice(0, separator);
      return (
        pairs.length >= 2 &&
        (degree.get(nodeId) ?? 0) <= MAX_DYNAMIC_RECIPROCAL_DEGREE
      );
    })
    .map(([key]) => key);
  if (congestedSides.length === 0) return false;

  const affectedSides = new Set(congestedSides);
  problemPairs.forEach((pair) => {
    const touchesCongestedSide = [
      pair.leftToRight.source,
      pair.leftToRight.target,
    ].some((nodeId) =>
      affectedSides.has(
        `${nodeId}:${edgeSideAtNode(pair.leftToRight, nodeId, positions)}`,
      ),
    );
    if (!touchesCongestedSide) return;

    [pair.leftToRight.source, pair.leftToRight.target].forEach((nodeId) => {
      affectedSides.add(
        `${nodeId}:${edgeSideAtNode(pair.leftToRight, nodeId, positions)}`,
      );
    });
  });

  return assignOrderedSidePorts(nodes, edges, positions, affectedSides);
}

function edgePortPointAtNode(
  edge: TransferFlowEdge,
  nodeId: string,
  positions: Map<string, { x: number; y: number }>,
) {
  const position = positions.get(nodeId);
  if (!position || !edge.data) return null;

  if (edge.source === nodeId && edge.sourceHandle) {
    return portPoint(
      position,
      edge.sourceHandle,
      edge.data.sourcePortRatio,
    );
  }
  if (edge.target === nodeId && edge.targetHandle) {
    return portPoint(
      position,
      edge.targetHandle,
      edge.data.targetPortRatio,
    );
  }
  return null;
}

function edgeHandleAtNode(edge: TransferFlowEdge, nodeId: string) {
  if (edge.source === nodeId) return edge.sourceHandle;
  if (edge.target === nodeId) return edge.targetHandle;
  return null;
}

function edgeNeedsCurveAtNode(
  edge: TransferFlowEdge,
  nodeId: string,
  geometry: EdgeRouteGeometry,
) {
  return edge.source === nodeId
    ? geometry.sourceNeedsCurve
    : geometry.targetNeedsCurve;
}

export function assignMixedDirectionFanoutPorts(
  nodes: AddressFlowNode[],
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const geometries = new Map(
    edges.map((edge) => [edge, edgeHorizontalRoute(edge, positions)]),
  );
  const edgesBySide = new Map<string, TransferFlowEdge[]>();
  edges.forEach((edge) => {
    [edge.source, edge.target].forEach((nodeId) => {
      const side = edgeSideAtNode(edge, nodeId, positions);
      const key = `${nodeId}:${side}`;
      const group = edgesBySide.get(key) ?? [];
      group.push(edge);
      edgesBySide.set(key, group);
    });
  });

  const affectedSides = new Set<string>();
  [...edgesBySide.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, sideEdges]) => {
      if (
        sideEdges.length < 2 ||
        sideEdges.length > MAX_DYNAMIC_RECIPROCAL_DEGREE
      ) {
        return;
      }
      const separator = key.lastIndexOf(":");
      const nodeId = key.slice(0, separator);
      if (
        sideEdges.some((edge) =>
          edgeHandleAtNode(edge, nodeId)?.startsWith("dynamic:")
        )
      ) {
        return;
      }
      const ordered = orderedSideEdges(sideEdges, nodeId, positions);
      const crossingCounts = new Map<TransferFlowEdge, number>();

      ordered.forEach((upper, upperIndex) => {
        const upperPoint = edgePortPointAtNode(upper, nodeId, positions);
        const upperGeometry = geometries.get(upper);
        if (!upperPoint || !upperGeometry) return;

        ordered.slice(upperIndex + 1).forEach((lower) => {
          const lowerPoint = edgePortPointAtNode(lower, nodeId, positions);
          const lowerGeometry = geometries.get(lower);
          if (!lowerPoint || !lowerGeometry) return;
          const samePhysicalHandle =
            edgeHandleAtNode(upper, nodeId) ===
            edgeHandleAtNode(lower, nodeId);
          const localOrderIsInverted =
            upperPoint.y > lowerPoint.y + ROUTE_EPSILON ||
            (Math.abs(upperPoint.y - lowerPoint.y) <= ROUTE_EPSILON &&
              !samePhysicalHandle);
          if (
            !localOrderIsInverted ||
            !pathsIntersect(
              upperGeometry.segments,
              lowerGeometry.segments,
              sharedPhysicalPorts(
                upper,
                lower,
                upperGeometry,
                lowerGeometry,
              ),
            )
          ) {
            return;
          }
          crossingCounts.set(
            upper,
            (crossingCounts.get(upper) ?? 0) + 1,
          );
          crossingCounts.set(
            lower,
            (crossingCounts.get(lower) ?? 0) + 1,
          );
        });
      });

      const anchor = [...crossingCounts.entries()]
        .filter(([edge, crossingCount]) => {
          const geometry = geometries.get(edge);
          return (
            crossingCount >= 2 &&
            geometry &&
            !edgeNeedsCurveAtNode(edge, nodeId, geometry)
          );
        })
        .map(([edge]) => edge)
        .sort(
          (a, b) =>
            Math.abs(
              (a.data?.routeY ?? 0) -
                nodeCenter(positions, nodeId).y,
            ) -
              Math.abs(
                (b.data?.routeY ?? 0) -
                  nodeCenter(positions, nodeId).y,
              ) ||
            edgeDisplayOrder(a) - edgeDisplayOrder(b) ||
            a.id.localeCompare(b.id),
        )[0];
      const hasReciprocalPeer = sideEdges.some((edge, index) =>
        sideEdges.slice(index + 1).some(
          (other) =>
            edge.source === other.target &&
            edge.target === other.source,
        )
      );
      if (anchor || (crossingCounts.size > 0 && hasReciprocalPeer)) {
        affectedSides.add(key);
      }
    });

  affectedSides.forEach((key) => {
    (edgesBySide.get(key) ?? []).forEach((edge) => {
      if (!edge.data) return;
      edge.data = {
        ...edge.data,
        mixedDirectionGroups: [
          ...new Set([
            ...(edge.data.mixedDirectionGroups ?? []),
            key,
          ]),
        ].sort(),
      };
    });
  });

  return assignOrderedSidePorts(
    nodes,
    edges,
    positions,
    affectedSides,
    "mixed",
  );
}

function edgePortRatioAtNode(edge: TransferFlowEdge, nodeId: string) {
  if (!edge.data) return null;
  if (edge.source === nodeId) return edge.data.sourcePortRatio;
  if (edge.target === nodeId) return edge.data.targetPortRatio;
  return null;
}

function cloneRoutingEdges(edges: TransferFlowEdge[]) {
  return edges.map((edge) => ({
    ...edge,
    data: edge.data ? { ...edge.data } : edge.data,
  }));
}

function routedEdgeLabel(
  edge: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const geometry = edgeHorizontalRoute(edge, positions);
  if (!geometry || !edge.data) return null;
  return edgeLabelGeometry({
    label: edge.data.label,
    horizontalStartX: geometry.horizontalStartX,
    horizontalEndX: geometry.horizontalEndX,
    routeY: edge.data.routeY,
    labelBias: edge.data.labelBias,
  });
}

export function routingIsCollisionFree(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const geometries = new Map(
    edges.map((edge) => [edge, edgeHorizontalRoute(edge, positions)]),
  );
  const labels = new Map(
    edges.map((edge) => [edge, routedEdgeLabel(edge, positions)]),
  );

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const geometry = geometries.get(edge);
    const label = labels.get(edge);
    if (
      !geometry ||
      !label ||
      !edgeHasValidHorizontalCorridor(edge, positions) ||
      edgeNodeCollisions(edge, positions).length > 0
    ) {
      return false;
    }
    if (
      [...positions.values()].some((position) =>
        rectsIntersect(label.rect, {
          x: position.x - NODE_ROUTE_CLEARANCE,
          y: position.y - NODE_ROUTE_CLEARANCE,
          width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
          height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
        }),
      )
    ) {
      return false;
    }

    for (const other of edges.slice(index + 1)) {
      const otherGeometry = geometries.get(other);
      const otherLabel = labels.get(other);
      if (!otherGeometry || !otherLabel) return false;
      if (
        horizontalRoutesConflict(edge, other, positions) ||
        pathsIntersect(
          geometry.segments,
          otherGeometry.segments,
          sharedPhysicalPorts(edge, other, geometry, otherGeometry),
        ) ||
        rectsIntersect(label.rect, otherLabel.rect) ||
        pathIntersectsRect(geometry.segments, otherLabel.rect) ||
        pathIntersectsRect(otherGeometry.segments, label.rect)
      ) {
        return false;
      }
    }
  }

  return true;
}

function dynamicReciprocalBlocksAreContiguous(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  return orderedReciprocalPairs(edges, positions)
    .filter((pair) =>
      [
        pair.leftToRight.sourceHandle,
        pair.leftToRight.targetHandle,
        pair.rightToLeft.sourceHandle,
        pair.rightToLeft.targetHandle,
      ].every((handle) => handle?.startsWith("dynamic:")),
    )
    .every(
      (pair) =>
        pair.leftToRight.data &&
        pair.rightToLeft.data &&
        Math.abs(
          pair.leftToRight.data.routeY - pair.rightToLeft.data.routeY,
        ) <=
          MIN_HORIZONTAL_LANE_GAP + ROUTE_EPSILON &&
        Math.abs(
          pair.leftToRight.data.routeY - pair.rightToLeft.data.routeY,
        ) >=
          MIN_HORIZONTAL_LANE_GAP - ROUTE_EPSILON &&
        reciprocalPairInterveningEdges(pair, edges, positions).length === 0,
    );
}

function alignedReciprocalSuffixPositions({
  pair,
  hubId,
  peerId,
  sideEdges,
  degrees,
  positions,
}: {
  pair: ReciprocalPair;
  hubId: string;
  peerId: string;
  sideEdges: TransferFlowEdge[];
  degrees: Map<string, number>;
  positions: Map<string, { x: number; y: number }>;
}) {
  const hubPoint = edgePortPointAtNode(pair.leftToRight, hubId, positions);
  const peerRatio = edgePortRatioAtNode(pair.leftToRight, peerId);
  const peerPosition = positions.get(peerId);
  if (!hubPoint || peerRatio === null || !peerPosition) return null;

  const column = buildPositionColumns(positions).find((candidate) =>
    candidate.items.some((item) => item.nodeId === peerId),
  );
  if (!column) return null;
  const orderedItems = [...column.items].sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.nodeId.localeCompare(b.nodeId),
  );
  const peerIndex = orderedItems.findIndex((item) => item.nodeId === peerId);
  const forwardIndex = sideEdges.indexOf(pair.leftToRight);
  if (peerIndex < 0 || forwardIndex < 0) return null;

  const desiredY = new Map<string, number>([
    [peerId, hubPoint.y - NODE_HEIGHT * peerRatio],
  ]);
  sideEdges.slice(forwardIndex + 1).forEach((edge, offset) => {
    const followerId = edge.source === hubId ? edge.target : edge.source;
    if (
      degrees.get(followerId) !== 1 ||
      followerId === peerId
    ) {
      return;
    }
    const followerPosition = positions.get(followerId);
    const followerRatio = edgePortRatioAtNode(edge, followerId);
    if (
      !followerPosition ||
      followerRatio === null ||
      Math.abs(followerPosition.x - column.x) > COLUMN_X_TOLERANCE ||
      followerPosition.y + ROUTE_EPSILON < peerPosition.y
    ) {
      return;
    }

    desiredY.set(
      followerId,
      hubPoint.y +
        (offset + 1) * MIN_HORIZONTAL_LANE_GAP -
        NODE_HEIGHT * followerRatio,
    );
  });

  const candidatePositions = new Map(
    [...positions.entries()].map(([nodeId, position]) => [
      nodeId,
      { ...position },
    ]),
  );
  let previousY =
    peerIndex > 0 ? orderedItems[peerIndex - 1].position.y : null;
  for (const item of orderedItems.slice(peerIndex)) {
    const minimumY =
      previousY === null
        ? Number.NEGATIVE_INFINITY
        : previousY + NODE_HEIGHT + NODE_ROUTE_CLEARANCE;
    const proposedY = desiredY.get(item.nodeId) ?? item.position.y;
    const y = Math.max(proposedY, minimumY);
    candidatePositions.set(item.nodeId, {
      ...item.position,
      y,
    });
    previousY = y;
  }

  return {
    positions: candidatePositions,
    movedNodeIds: new Set(
      orderedItems
        .slice(peerIndex)
        .filter(
          (item) =>
            Math.abs(
              candidatePositions.get(item.nodeId)!.y - item.position.y,
            ) > ROUTE_EPSILON,
        )
        .map((item) => item.nodeId),
    ),
  };
}

type ReciprocalColumnAlignmentCandidate = {
  positions: Map<string, { x: number; y: number }>;
  anchorEdgeId: string;
  straightCount: number;
  curvedEndpointCount: number;
  displacement: number;
  labelShift: number;
  displayOrder: number;
};

export function alignDynamicReciprocalLeafColumns(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });
  const baselineGeometries = new Map(
    edges.map((edge) => [edge.id, edgeHorizontalRoute(edge, positions)]),
  );
  const baselineLabels = new Map(
    edges.map((edge) => [edge.id, routedEdgeLabel(edge, positions)]),
  );
  const baselineStraightCount = [...baselineGeometries.values()].filter(
    (geometry) =>
      geometry && !geometry.sourceNeedsCurve && !geometry.targetNeedsCurve,
  ).length;
  const baselineCurveCount = [...baselineGeometries.values()].reduce(
    (count, geometry) =>
      count +
      Number(geometry?.sourceNeedsCurve) +
      Number(geometry?.targetNeedsCurve),
    0,
  );
  const candidates: ReciprocalColumnAlignmentCandidate[] = [];

  orderedReciprocalPairs(edges, positions).forEach((pair) => {
    const endpoints = [
      pair.leftToRight.source,
      pair.leftToRight.target,
    ];
    const peerIds = endpoints.filter((nodeId) => degrees.get(nodeId) === 2);
    if (peerIds.length !== 1) return;
    const peerId = peerIds[0];
    const hubId = endpoints.find((nodeId) => nodeId !== peerId);
    if (!hubId || (degrees.get(hubId) ?? 0) <= 2) return;
    if (
      ![
        pair.leftToRight.sourceHandle,
        pair.leftToRight.targetHandle,
        pair.rightToLeft.sourceHandle,
        pair.rightToLeft.targetHandle,
      ].every((handle) => handle?.startsWith("dynamic:"))
    ) {
      return;
    }

    const side = edgeSideAtNode(pair.leftToRight, hubId, positions);
    const sideEdges = orderedSideEdges(
      edges.filter(
        (edge) =>
          (edge.source === hubId || edge.target === hubId) &&
          edgeSideAtNode(edge, hubId, positions) === side,
      ),
      hubId,
      positions,
    );
    const forwardIndex = sideEdges.indexOf(pair.leftToRight);
    if (
      forwardIndex < 0 ||
      sideEdges[forwardIndex + 1] !== pair.rightToLeft
    ) {
      return;
    }

    const aligned = alignedReciprocalSuffixPositions({
      pair,
      hubId,
      peerId,
      sideEdges,
      degrees,
      positions,
    });
    if (!aligned || aligned.movedNodeIds.size === 0) return;

    const candidateEdges = cloneRoutingEdges(edges);
    assignRouteLanes(candidateEdges, aligned.positions);
    const candidateById = new Map(
      candidateEdges.map((edge) => [edge.id, edge]),
    );
    const candidateAnchor = candidateById.get(pair.leftToRight.id);
    const candidateAnchorGeometry = candidateAnchor
      ? edgeHorizontalRoute(candidateAnchor, aligned.positions)
      : null;
    if (
      !candidateAnchorGeometry ||
      candidateAnchorGeometry.sourceNeedsCurve ||
      candidateAnchorGeometry.targetNeedsCurve ||
      !routingIsCollisionFree(candidateEdges, aligned.positions) ||
      !dynamicReciprocalBlocksAreContiguous(
        candidateEdges,
        aligned.positions,
      )
    ) {
      return;
    }

    const lockedIds = new Set(
      sideEdges.slice(0, forwardIndex).map((edge) => edge.id),
    );
    const localIds = new Set(sideEdges.map((edge) => edge.id));
    const preservesRoutes = edges.every((edge) => {
      const baseline = baselineGeometries.get(edge.id);
      const candidateEdge = candidateById.get(edge.id);
      const candidate = candidateEdge
        ? edgeHorizontalRoute(candidateEdge, aligned.positions)
        : null;
      if (!baseline || !candidate || !candidateEdge?.data || !edge.data) {
        return false;
      }
      if (lockedIds.has(edge.id)) {
        return (
          Math.abs(candidateEdge.data.routeY - edge.data.routeY) <=
            ROUTE_EPSILON &&
          candidate.sourceNeedsCurve === baseline.sourceNeedsCurve &&
          candidate.targetNeedsCurve === baseline.targetNeedsCurve
        );
      }
      if (localIds.has(edge.id)) return true;
      return (
        (!candidate.sourceNeedsCurve || baseline.sourceNeedsCurve) &&
        (!candidate.targetNeedsCurve || baseline.targetNeedsCurve)
      );
    });
    if (!preservesRoutes) return;

    const candidateGeometries = candidateEdges.map((edge) =>
      edgeHorizontalRoute(edge, aligned.positions),
    );
    const straightCount = candidateGeometries.filter(
      (geometry) =>
        geometry && !geometry.sourceNeedsCurve && !geometry.targetNeedsCurve,
    ).length;
    const curvedEndpointCount = candidateGeometries.reduce(
      (count, geometry) =>
        count +
        Number(geometry?.sourceNeedsCurve) +
        Number(geometry?.targetNeedsCurve),
      0,
    );
    if (
      straightCount <= baselineStraightCount &&
      curvedEndpointCount >= baselineCurveCount
    ) {
      return;
    }
    const displacement = [...aligned.movedNodeIds].reduce(
      (total, nodeId) =>
        total +
        Math.abs(
          aligned.positions.get(nodeId)!.y - positions.get(nodeId)!.y,
        ),
      0,
    );
    const labelShift = candidateEdges.reduce((total, edge) => {
      const baseline = baselineLabels.get(edge.id);
      const candidate = routedEdgeLabel(edge, aligned.positions);
      return total +
        (baseline && candidate
          ? Math.abs(candidate.center.x - baseline.center.x)
          : 0);
    }, 0);
    candidates.push({
      positions: aligned.positions,
      anchorEdgeId: pair.leftToRight.id,
      straightCount,
      curvedEndpointCount,
      displacement,
      labelShift,
      displayOrder: edgeDisplayOrder(pair.leftToRight),
    });
  });

  const best = candidates.sort(
    (a, b) =>
      b.straightCount - a.straightCount ||
      a.curvedEndpointCount - b.curvedEndpointCount ||
      a.displacement - b.displacement ||
      a.labelShift - b.labelShift ||
      a.displayOrder - b.displayOrder ||
      a.anchorEdgeId.localeCompare(b.anchorEdgeId),
  )[0];
  if (!best) return false;

  best.positions.forEach((position, nodeId) => {
    positions.set(nodeId, position);
  });
  return true;
}

type ColumnGapCompactionCandidate = {
  positions: Map<string, { x: number; y: number }>;
  edges: TransferFlowEdge[];
  movedNodeIds: Set<string>;
  gapReduction: number;
  remainingGap: number;
  displacement: number;
  labelShift: number;
  stableKey: string;
};

type PositionColumn = ReturnType<typeof buildPositionColumns>[number];
type ComponentPositionColumn = PositionColumn & {
  componentId: string;
  physicalColumn: PositionColumn;
};

function connectedComponentIds(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const neighbors = new Map(
    [...positions.keys()].map((nodeId) => [nodeId, new Set<string>()]),
  );
  edges.forEach((edge) => {
    if (!neighbors.has(edge.source) || !neighbors.has(edge.target)) return;
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  });

  const componentIds = new Map<string, string>();
  [...positions.keys()]
    .sort((a, b) => a.localeCompare(b))
    .forEach((rootId) => {
      if (componentIds.has(rootId)) return;
      const component: string[] = [];
      const queue = [rootId];
      componentIds.set(rootId, rootId);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const nodeId = queue[cursor];
        component.push(nodeId);
        [...(neighbors.get(nodeId) ?? [])]
          .sort((a, b) => a.localeCompare(b))
          .forEach((neighborId) => {
            if (componentIds.has(neighborId)) return;
            componentIds.set(neighborId, rootId);
            queue.push(neighborId);
          });
      }
      const stableId = component.sort((a, b) => a.localeCompare(b))[0];
      component.forEach((nodeId) => componentIds.set(nodeId, stableId));
    });
  return componentIds;
}

function buildComponentPositionColumns(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const componentIds = connectedComponentIds(edges, positions);
  return buildPositionColumns(positions)
    .flatMap((physicalColumn) => {
      const itemsByComponent = new Map<
        string,
        PositionColumn["items"]
      >();
      physicalColumn.items.forEach((item) => {
        const componentId = componentIds.get(item.nodeId) ?? item.nodeId;
        const items = itemsByComponent.get(componentId) ?? [];
        items.push(item);
        itemsByComponent.set(componentId, items);
      });
      return [...itemsByComponent.entries()].map(
        ([componentId, items]) => ({
          x: physicalColumn.x,
          componentId,
          physicalColumn,
          items,
        }),
      );
    })
    .sort(
      (a, b) =>
        a.x - b.x ||
        Math.min(...a.items.map((item) => item.position.y)) -
          Math.min(...b.items.map((item) => item.position.y)) ||
        a.componentId.localeCompare(b.componentId),
    ) satisfies ComponentPositionColumn[];
}

export function adaptiveColumnClearGap(nodeCount: number) {
  const density =
    Math.min(Math.max(nodeCount, 2), DENSE_COLUMN_NODE_COUNT) - 2;
  const densityRange = DENSE_COLUMN_NODE_COUNT - 2;
  const scale =
    SPARSE_COLUMN_GAP_SCALE -
    ((SPARSE_COLUMN_GAP_SCALE - DENSE_COLUMN_GAP_SCALE) *
      density) /
      densityRange;
  return BASE_COMPACT_COLUMN_CLEAR_GAP * scale;
}

function minimumColumnNodeTopGap(nodeCount: number) {
  return NODE_HEIGHT + adaptiveColumnClearGap(nodeCount);
}

function columnClusterThreshold(nodeCount: number) {
  return minimumColumnNodeTopGap(nodeCount) + NODE_ROUTE_CLEARANCE;
}

function copyRoutingState(
  targetEdges: TransferFlowEdge[],
  sourceEdges: TransferFlowEdge[],
) {
  const sourceById = new Map(sourceEdges.map((edge) => [edge.id, edge]));
  targetEdges.forEach((edge) => {
    const source = sourceById.get(edge.id);
    if (!source?.data) return;
    edge.sourceHandle = source.sourceHandle;
    edge.targetHandle = source.targetHandle;
    edge.data = {
      ...edge.data!,
      ...source.data,
    };
  });
}

type ColumnSpacingAnchor = {
  nodeId: string;
  edgeIds: string[];
  stableKey: string;
};

type ColumnSpacingPlacement = {
  gap: number;
  firstY: number;
  anchor: ColumnSpacingAnchor | undefined;
  stableKey: string;
};

function straightColumnSpacingAnchors(
  ordered: ComponentPositionColumn["items"],
  componentEdges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const columnNodeIds = new Set(
    ordered.map((item) => item.nodeId),
  );
  const edgeIdsByNode = new Map<string, Set<string>>();

  componentEdges.forEach((edge) => {
    const geometry = edgeHorizontalRoute(edge, positions);
    if (
      !geometry ||
      geometry.sourceNeedsCurve ||
      geometry.targetNeedsCurve
    ) {
      return;
    }

    [
      { nodeId: edge.source, peerId: edge.target },
      { nodeId: edge.target, peerId: edge.source },
    ].forEach(({ nodeId, peerId }) => {
      if (
        !columnNodeIds.has(nodeId) ||
        columnNodeIds.has(peerId)
      ) {
        return;
      }
      const edgeIds = edgeIdsByNode.get(nodeId) ?? new Set<string>();
      edgeIds.add(edge.id);
      edgeIdsByNode.set(nodeId, edgeIds);
    });
  });

  const anchors: ColumnSpacingAnchor[] = [...edgeIdsByNode.entries()]
    .map(([nodeId, edgeIds]) => {
      const orderedEdgeIds = [...edgeIds].sort((a, b) =>
        a.localeCompare(b),
      );
      return {
        nodeId,
        edgeIds: orderedEdgeIds,
        stableKey: `${nodeId}:${orderedEdgeIds.join(",")}`,
      };
    })
    .sort((a, b) => a.stableKey.localeCompare(b.stableKey));
  return anchors;
}

export function equalizeComponentColumnSpacing(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  primaryNodeId?: string,
) {
  let changed = false;
  const columns = buildComponentPositionColumns(edges, positions);
  const componentIds = connectedComponentIds(edges, positions);
  const primaryComponentId = primaryNodeId
    ? componentIds.get(primaryNodeId)
    : undefined;

  columns.forEach((column) => {
    if (column.items.length <= 1) return;
    const ordered = [...column.items].sort(
      (a, b) =>
        a.position.y - b.position.y ||
        a.nodeId.localeCompare(b.nodeId),
    );
    const isDisconnectedPair =
      ordered.length === 2 &&
      primaryComponentId !== undefined &&
      column.componentId !== primaryComponentId;
    if (ordered.length === 2 && !isDisconnectedPair) return;

    const targetGap = isDisconnectedPair
      ? minimumColumnNodeTopGap(DENSE_COLUMN_NODE_COUNT)
      : minimumColumnNodeTopGap(ordered.length);
    const currentGap =
      (ordered.at(-1)!.position.y - ordered[0].position.y) /
      (ordered.length - 1);
    if (
      isDisconnectedPair &&
      currentGap <= targetGap + ROUTE_EPSILON
    ) {
      return;
    }
    if (
      !isDisconnectedPair &&
      Math.abs(currentGap - targetGap) < 1
    ) {
      return;
    }
    const minimumGap = MIN_COLUMN_NODE_TOP_GAP;
    const gapCandidates = (
      isDisconnectedPair
        ? [targetGap]
        : [
            targetGap,
            currentGap,
            targetGap + MIN_HORIZONTAL_LANE_GAP,
            Math.max(
              minimumGap,
              targetGap - MIN_HORIZONTAL_LANE_GAP,
            ),
            targetGap + MIN_HORIZONTAL_LANE_GAP * 2,
          ]
    )
      .map((gap) => Number(gap.toFixed(6)))
      .filter(
        (gap, index, values) =>
          gap >= minimumGap - ROUTE_EPSILON &&
          values.indexOf(gap) === index,
      )
      .sort(
        (a, b) =>
          Math.abs(a - targetGap) - Math.abs(b - targetGap) ||
          a - b,
      );
    const currentCenter =
      (ordered[0].position.y + ordered.at(-1)!.position.y) / 2;
    const componentEdges = edges.filter(
      (edge) =>
        componentIds.get(edge.source) === column.componentId &&
        componentIds.get(edge.target) === column.componentId,
    );
    const baselineStraightEdgeIds = new Set(
      componentEdges
        .filter((edge) => {
          const geometry = edgeHorizontalRoute(edge, positions);
          return (
            geometry &&
            !geometry.sourceNeedsCurve &&
            !geometry.targetNeedsCurve
          );
        })
        .map((edge) => edge.id),
    );
    const anchors = isDisconnectedPair
      ? straightColumnSpacingAnchors(
          ordered,
          componentEdges,
          positions,
        )
      : [];
    const placementCandidates =
      gapCandidates.flatMap<ColumnSpacingPlacement>((gap) => {
        if (anchors.length === 0) {
          return [
            {
              gap,
              firstY:
                currentCenter - (gap * (ordered.length - 1)) / 2,
              anchor: undefined,
              stableKey: `center:${gap}`,
            },
          ];
        }
        return anchors.map((anchor) => {
          const anchorIndex = ordered.findIndex(
            (item) => item.nodeId === anchor.nodeId,
          );
          return {
            gap,
            firstY:
              ordered[anchorIndex].position.y - anchorIndex * gap,
            anchor,
            stableKey: anchor.stableKey,
          };
        });
      });
    const acceptedCandidates: Array<{
      positions: Map<string, { x: number; y: number }>;
      edges: TransferFlowEdge[];
      componentId?: string;
      straightCount: number;
      curvedEndpointCount: number;
      displacement: number;
      stableKey: string;
    }> = [];

    for (const placement of placementCandidates) {
      const candidatePositions = new Map(
        [...positions.entries()].map(([nodeId, position]) => [
          nodeId,
          { ...position },
        ]),
      );
      ordered.forEach((item, index) => {
        candidatePositions.set(item.nodeId, {
          ...item.position,
          y: Number(
            (placement.firstY + index * placement.gap).toFixed(6),
          ),
        });
      });
      if (!nodeBoxesHaveClearance(candidatePositions)) continue;

      const candidateEdges = cloneRoutingEdges(edges);
      let candidateComponentEdges: TransferFlowEdge[];
      if (isDisconnectedPair) {
        candidateComponentEdges = candidateEdges.filter(
          (edge) =>
            componentIds.get(edge.source) === column.componentId &&
            componentIds.get(edge.target) === column.componentId,
        );
        assignRouteLanes(candidateComponentEdges, candidatePositions);
        alignColumnPairLabels(
          candidateComponentEdges,
          candidatePositions,
        );
      } else {
        assignRouteLanes(candidateEdges, candidatePositions);
        candidateComponentEdges = candidateEdges.filter(
          (edge) =>
            componentIds.get(edge.source) === column.componentId &&
            componentIds.get(edge.target) === column.componentId,
        );
      }
      const candidateById = new Map(
        candidateEdges.map((edge) => [edge.id, edge]),
      );
      if (
        placement.anchor &&
        !placement.anchor.edgeIds.every((edgeId) => {
          const candidate = candidateById.get(edgeId);
          const geometry = candidate
            ? edgeHorizontalRoute(candidate, candidatePositions)
            : null;
          return (
            geometry &&
            !geometry.sourceNeedsCurve &&
            !geometry.targetNeedsCurve
          );
        })
      ) {
        continue;
      }
      if (
        !routingIsCollisionFree(candidateEdges, candidatePositions) ||
        !dynamicReciprocalBlocksAreContiguous(
          candidateEdges,
          candidatePositions,
        )
      ) {
        continue;
      }
      const candidateGeometries = new Map(
        candidateComponentEdges.map((edge) => [
          edge.id,
          edgeHorizontalRoute(edge, candidatePositions),
        ]),
      );
      acceptedCandidates.push({
        positions: candidatePositions,
        edges: candidateEdges,
        componentId: isDisconnectedPair
          ? column.componentId
          : undefined,
        straightCount: [...baselineStraightEdgeIds].filter(
          (edgeId) => {
            const geometry = candidateGeometries.get(edgeId);
            return (
              geometry &&
              !geometry.sourceNeedsCurve &&
              !geometry.targetNeedsCurve
            );
          },
        ).length,
        curvedEndpointCount: [
          ...candidateGeometries.values(),
        ].reduce(
          (count, geometry) =>
            count +
            Number(geometry?.sourceNeedsCurve) +
            Number(geometry?.targetNeedsCurve),
          0,
        ),
        displacement: ordered.reduce(
          (total, item) =>
            total +
            Math.abs(
              candidatePositions.get(item.nodeId)!.y -
                item.position.y,
            ),
          0,
        ),
        stableKey: placement.stableKey,
      });
      if (anchors.length === 0) break;
    }

    const accepted = (
      anchors.length > 0
        ? acceptedCandidates.sort(
            (a, b) =>
              b.straightCount - a.straightCount ||
              a.curvedEndpointCount - b.curvedEndpointCount ||
              a.displacement - b.displacement ||
              a.stableKey.localeCompare(b.stableKey),
          )
        : acceptedCandidates
    )[0];
    if (!accepted) return;
    ordered.forEach((item) => {
      positions.set(item.nodeId, accepted.positions.get(item.nodeId)!);
    });
    if (accepted.componentId === undefined) {
      copyRoutingState(edges, accepted.edges);
    } else {
      const acceptedComponentId = accepted.componentId;
      copyRoutingState(
        edges.filter(
          (edge) =>
            componentIds.get(edge.source) === acceptedComponentId &&
            componentIds.get(edge.target) === acceptedComponentId,
        ),
        accepted.edges.filter(
          (edge) =>
            componentIds.get(edge.source) === acceptedComponentId &&
            componentIds.get(edge.target) === acceptedComponentId,
        ),
      );
    }
    changed = true;
  });

  return changed;
}

export function alignColumnPairLabels(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const componentIds = connectedComponentIds(edges, positions);
  const groups = new Map<string, TransferFlowEdge[]>();
  edges.forEach((edge) => {
    const sourcePosition = positions.get(edge.source);
    const targetPosition = positions.get(edge.target);
    if (!sourcePosition || !targetPosition) return;
    const minX = Math.min(sourcePosition.x, targetPosition.x);
    const maxX = Math.max(sourcePosition.x, targetPosition.x);
    if (maxX - minX <= COLUMN_X_TOLERANCE) return;
    const componentId =
      componentIds.get(edge.source) ??
      componentIds.get(edge.target) ??
      edge.source;
    const key =
      `${componentId}:` +
      `${Number(minX.toFixed(6))}<->${Number(maxX.toFixed(6))}`;
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  });

  let changed = false;
  [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, group]) => {
      if (group.length <= 1) return;
      const slots = group.flatMap((edge) => {
        const geometry = edgeHorizontalRoute(edge, positions);
        if (!geometry || !edge.data) return [];
        const label = edgeLabelGeometry({
          label: edge.data.label,
          horizontalStartX: geometry.horizontalStartX,
          horizontalEndX: geometry.horizontalEndX,
          routeY: edge.data.routeY,
          labelBias: edge.data.labelBias,
        });
        return [{
          edge,
          geometry,
          width: label.width,
          currentLeft: label.rect.x,
          minLeft: geometry.horizontalMinX,
          maxLeft: geometry.horizontalMaxX - label.width,
        }];
      });
      if (slots.length !== group.length) return;

      const minLeft = Math.max(...slots.map((slot) => slot.minLeft));
      const maxLeft = Math.min(...slots.map((slot) => slot.maxLeft));
      if (minLeft > maxLeft + ROUTE_EPSILON) return;
      const orderedCurrentLeft = slots
        .map((slot) => slot.currentLeft)
        .sort((a, b) => a - b);
      const preferredLeft =
        orderedCurrentLeft[Math.floor(orderedCurrentLeft.length / 2)];
      const leftCandidates = [
        Math.min(maxLeft, Math.max(minLeft, preferredLeft)),
        minLeft,
        maxLeft,
      ].filter(
        (left, index, values) =>
          values.findIndex(
            (candidate) => Math.abs(candidate - left) <= ROUTE_EPSILON,
          ) === index,
      );

      for (const left of leftCandidates) {
        const candidateEdges = cloneRoutingEdges(edges);
        const candidateById = new Map(
          candidateEdges.map((edge) => [edge.id, edge]),
        );
        slots.forEach((slot) => {
          const candidate = candidateById.get(slot.edge.id);
          if (!candidate?.data) return;
          const denominator =
            slot.geometry.horizontalEndX -
            slot.geometry.horizontalStartX;
          const centerX = left + slot.width / 2;
          candidate.data.labelBias =
            Math.abs(denominator) <= ROUTE_EPSILON
              ? 0.5
              : Math.min(
                  1,
                  Math.max(
                    0,
                    (centerX - slot.geometry.horizontalStartX) /
                      denominator,
                  ),
                );
        });
        if (!routingIsCollisionFree(candidateEdges, positions)) continue;
        copyRoutingState(edges, candidateEdges);
        changed = true;
        break;
      }
    });

  return changed;
}

function dynamicReciprocalPeerIds(edges: TransferFlowEdge[]) {
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });

  const peerIds = new Set<string>();
  edges.forEach((edge) => {
    const sourceIsMixed =
      edge.sourceHandle?.startsWith("dynamic:mixed:") ?? false;
    const targetIsMixed =
      edge.targetHandle?.startsWith("dynamic:mixed:") ?? false;
    const usesMixedDirectionPorts = sourceIsMixed || targetIsMixed;
    if (!usesMixedDirectionPorts) {
      if (
        edge.sourceHandle?.startsWith("dynamic:") ||
        edge.targetHandle?.startsWith("dynamic:")
      ) {
        if ((degrees.get(edge.source) ?? 0) <= 2) {
          peerIds.add(edge.source);
        }
        if ((degrees.get(edge.target) ?? 0) <= 2) {
          peerIds.add(edge.target);
        }
      }
      return;
    }
    if (
      edge.sourceHandle?.startsWith("dynamic:") &&
      !sourceIsMixed &&
      (degrees.get(edge.source) ?? 0) <= 2
    ) {
      peerIds.add(edge.source);
    }
    if (
      edge.targetHandle?.startsWith("dynamic:") &&
      !targetIsMixed &&
      (degrees.get(edge.target) ?? 0) <= 2
    ) {
      peerIds.add(edge.target);
    }
  });
  return peerIds;
}

function compactionShiftCandidates({
  movedNodeIds,
  direction,
  maxShift,
  edges,
  positions,
}: {
  movedNodeIds: Set<string>;
  direction: 1 | -1;
  maxShift: number;
  edges: TransferFlowEdge[];
  positions: Map<string, { x: number; y: number }>;
}) {
  const shifts = new Set<number>([
    Number(maxShift.toFixed(6)),
  ]);
  for (
    let shift = MIN_HORIZONTAL_LANE_GAP;
    shift <= maxShift + ROUTE_EPSILON;
    shift += MIN_HORIZONTAL_LANE_GAP
  ) {
    shifts.add(Number(Math.min(shift, maxShift).toFixed(6)));
  }

  const movedPortYs = edges.flatMap((edge) => {
    const geometry = edgeHorizontalRoute(edge, positions);
    if (!geometry) return [];
    return [
      {
        nodeId: edge.source,
        isStraight: !geometry.sourceNeedsCurve,
      },
      {
        nodeId: edge.target,
        isStraight: !geometry.targetNeedsCurve,
      },
    ].flatMap(({ nodeId, isStraight }) => {
      if (!isStraight || !movedNodeIds.has(nodeId)) return [];
      const point = edgePortPointAtNode(edge, nodeId, positions);
      return point ? [point.y] : [];
    });
  });
  const stationaryYs = edges.flatMap((edge) => {
    if (
      movedNodeIds.has(edge.source) ||
      movedNodeIds.has(edge.target) ||
      !edge.data
    ) {
      return [];
    }
    return [edge.data.routeY];
  });
  const minDelta = direction > 0 ? ROUTE_EPSILON : -maxShift;
  const maxDelta = direction > 0 ? maxShift : -ROUTE_EPSILON;

  movedPortYs.forEach((movedY) => {
    stationaryYs.forEach((stationaryY) => {
      const minStep = Math.ceil(
        (movedY + minDelta - stationaryY) /
          MIN_HORIZONTAL_LANE_GAP,
      );
      const maxStep = Math.floor(
        (movedY + maxDelta - stationaryY) /
          MIN_HORIZONTAL_LANE_GAP,
      );
      for (let step = minStep; step <= maxStep; step += 1) {
        const delta =
          stationaryY +
          step * MIN_HORIZONTAL_LANE_GAP -
          movedY;
        if (
          direction * delta <= ROUTE_EPSILON ||
          Math.abs(delta) > maxShift + ROUTE_EPSILON
        ) {
          continue;
        }
        shifts.add(Number(Math.abs(delta).toFixed(6)));
      }
    });
  });

  return [...shifts]
    .filter(
      (shift) =>
        shift > ROUTE_EPSILON &&
        shift <= maxShift + ROUTE_EPSILON,
    )
    .sort((a, b) => b - a);
}

function expansionShiftCandidates({
  movedNodeIds,
  direction,
  targetShift,
  edges,
  positions,
}: {
  movedNodeIds: Set<string>;
  direction: 1 | -1;
  targetShift: number;
  edges: TransferFlowEdge[];
  positions: Map<string, { x: number; y: number }>;
}) {
  const shifts = new Set(
    compactionShiftCandidates({
      movedNodeIds,
      direction,
      maxShift: targetShift,
      edges,
      positions,
    }),
  );
  const movedPositions = [...movedNodeIds].flatMap((nodeId) => {
    const position = positions.get(nodeId);
    return position ? [{ nodeId, position }] : [];
  });
  const stationaryPositions = [...positions.entries()].filter(
    ([nodeId]) => !movedNodeIds.has(nodeId),
  );

  movedPositions.forEach(({ position }) => {
    stationaryPositions.forEach(([, stationary]) => {
      const horizontalClearance =
        Math.max(position.x, stationary.x) -
        Math.min(position.x + NODE_WIDTH, stationary.x + NODE_WIDTH);
      if (horizontalClearance > NODE_ROUTE_CLEARANCE + ROUTE_EPSILON) {
        return;
      }
      const obstacleIsAhead =
        direction < 0
          ? stationary.y < position.y
          : stationary.y > position.y;
      if (!obstacleIsAhead) return;
      const boundaryShift =
        direction < 0
          ? position.y -
            stationary.y -
            MIN_COLUMN_NODE_TOP_GAP
          : stationary.y -
            position.y -
            MIN_COLUMN_NODE_TOP_GAP;
      if (
        boundaryShift > ROUTE_EPSILON &&
        boundaryShift < targetShift - ROUTE_EPSILON
      ) {
        shifts.add(Number(boundaryShift.toFixed(6)));
      }
    });
  });

  return [...shifts]
    .filter(
      (shift) =>
        shift > ROUTE_EPSILON &&
        shift <= targetShift + ROUTE_EPSILON,
    )
    .sort((a, b) => b - a);
}

function edgeCurveProfile(
  edge: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const geometry = edgeHorizontalRoute(edge, positions);
  if (!geometry || !edge.data) return null;
  return {
    sourceNeedsCurve: geometry.sourceNeedsCurve,
    targetNeedsCurve: geometry.targetNeedsCurve,
    sourceCurveMode: edge.data.sourceCurveMode,
    targetCurveMode: edge.data.targetCurveMode,
  };
}

function canShiftNodeBlockWithoutBreakingStraightEdge(
  movedNodeIds: Set<string>,
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  return edges.every((edge) => {
    const geometry = edgeHorizontalRoute(edge, positions);
    if (
      !geometry ||
      geometry.sourceNeedsCurve ||
      geometry.targetNeedsCurve
    ) {
      return true;
    }
    return (
      movedNodeIds.has(edge.source) ===
      movedNodeIds.has(edge.target)
    );
  });
}

function preserveMovedStraightDynamicPortYs({
  edges,
  candidateEdges,
  movedNodeIds,
  positions,
  candidatePositions,
}: {
  edges: TransferFlowEdge[];
  candidateEdges: TransferFlowEdge[];
  movedNodeIds: Set<string>;
  positions: Map<string, { x: number; y: number }>;
  candidatePositions: Map<string, { x: number; y: number }>;
}) {
  const candidateById = new Map(
    candidateEdges.map((edge) => [edge.id, edge]),
  );
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });

  edges.forEach((edge) => {
    const geometry = edgeHorizontalRoute(edge, positions);
    const candidate = candidateById.get(edge.id);
    if (!geometry || !candidate?.data) return;

    [
      {
        nodeId: edge.source,
        handle: edge.sourceHandle,
        needsCurve: geometry.sourceNeedsCurve,
        field: "sourcePortRatio" as const,
      },
      {
        nodeId: edge.target,
        handle: edge.targetHandle,
        needsCurve: geometry.targetNeedsCurve,
        field: "targetPortRatio" as const,
      },
    ].forEach(({ nodeId, handle, needsCurve, field }) => {
      if (
        needsCurve ||
        !movedNodeIds.has(nodeId) ||
        (!handle?.startsWith("dynamic:") &&
          degrees.get(nodeId) !== 1)
      ) {
        return;
      }
      const baselinePoint = edgePortPointAtNode(edge, nodeId, positions);
      const candidatePosition = candidatePositions.get(nodeId);
      if (!baselinePoint || !candidatePosition) return;
      candidate.data![field] =
        (baselinePoint.y - candidatePosition.y) / NODE_HEIGHT;
    });
  });

  const endpointsByNode = new Map<
    string,
    Array<{
      baselineRatio: number;
      candidateRatio: number;
      stableKey: string;
    }>
  >();
  edges.forEach((edge) => {
    const candidate = candidateById.get(edge.id);
    if (!edge.data || !candidate?.data) return;
    [
      {
        nodeId: edge.source,
        handle: edge.sourceHandle,
        baselineRatio: edge.data.sourcePortRatio,
        candidateRatio: candidate.data.sourcePortRatio,
      },
      {
        nodeId: edge.target,
        handle: edge.targetHandle,
        baselineRatio: edge.data.targetPortRatio,
        candidateRatio: candidate.data.targetPortRatio,
      },
    ].forEach(
      ({
        nodeId,
        handle,
        baselineRatio,
        candidateRatio,
      }) => {
        if (
          !movedNodeIds.has(nodeId) ||
          (!handle?.startsWith("dynamic:") &&
            degrees.get(nodeId) !== 1)
        ) {
          return;
        }
        const endpoints = endpointsByNode.get(nodeId) ?? [];
        endpoints.push({
          baselineRatio,
          candidateRatio,
          stableKey: `${handle}:${edge.id}`,
        });
        endpointsByNode.set(nodeId, endpoints);
      },
    );
  });

  return [...endpointsByNode.values()].every((endpoints) => {
    const ordered = endpoints.sort(
      (a, b) =>
        a.baselineRatio - b.baselineRatio ||
        a.stableKey.localeCompare(b.stableKey),
    );
    return ordered.every(
      (endpoint, index) =>
        endpoint.candidateRatio >= 0.1 - ROUTE_EPSILON &&
        endpoint.candidateRatio <= 0.9 + ROUTE_EPSILON &&
        (index === 0 ||
          endpoint.candidateRatio >
            ordered[index - 1].candidateRatio + ROUTE_EPSILON),
    );
  });
}

function canonicalizeMovedLeafPortRatios(
  edges: TransferFlowEdge[],
  candidateEdges: TransferFlowEdge[],
  movedNodeIds: Set<string>,
) {
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });
  const candidateById = new Map(
    candidateEdges.map((edge) => [edge.id, edge]),
  );

  movedNodeIds.forEach((nodeId) => {
    if ((degrees.get(nodeId) ?? 0) > 2) return;
    const endpoints: Array<{
      edge: TransferFlowEdge;
      candidate: TransferFlowEdge;
      handle: string;
      baselineRatio: number;
      field: "sourcePortRatio" | "targetPortRatio";
    }> = [];
    edges.forEach((edge) => {
      const candidate = candidateById.get(edge.id);
      if (!candidate?.data || !edge.data) return;
      if (edge.source === nodeId && edge.sourceHandle) {
        endpoints.push({
          edge,
          candidate,
          handle: edge.sourceHandle,
          baselineRatio: edge.data.sourcePortRatio,
          field: "sourcePortRatio",
        });
        return;
      }
      if (edge.target === nodeId && edge.targetHandle) {
        endpoints.push({
          edge,
          candidate,
          handle: edge.targetHandle,
          baselineRatio: edge.data.targetPortRatio,
          field: "targetPortRatio",
        });
      }
    });

    endpoints
      .filter(({ handle }) => !handle.startsWith("dynamic:"))
      .forEach(({ candidate, handle, field }) => {
        candidate.data![field] = defaultPortRatio(handle);
      });

    const dynamicBySide = new Map<
      GraphPortSide,
      typeof endpoints
    >();
    endpoints
      .filter(({ handle }) => handle.startsWith("dynamic:"))
      .forEach((endpoint) => {
        const side: GraphPortSide = endpoint.handle.endsWith(":right")
          ? "right"
          : "left";
        const group = dynamicBySide.get(side) ?? [];
        group.push(endpoint);
        dynamicBySide.set(side, group);
      });
    dynamicBySide.forEach((group) => {
      group
        .sort(
          (a, b) =>
            a.baselineRatio - b.baselineRatio ||
            a.edge.id.localeCompare(b.edge.id),
        )
        .forEach(({ candidate, field }, index) => {
          candidate.data![field] =
            group.length === 1
              ? (UPPER_PORT_RATIO + LOWER_PORT_RATIO) / 2
              : UPPER_PORT_RATIO +
                ((LOWER_PORT_RATIO - UPPER_PORT_RATIO) * index) /
                  (group.length - 1);
        });
    });
  });
}

function nodeBoxesHaveClearance(
  positions: Map<string, { x: number; y: number }>,
) {
  const entries = [...positions.entries()];
  const padding = NODE_ROUTE_CLEARANCE / 2;
  return entries.every(([, position], index) =>
    entries.slice(index + 1).every(([, otherPosition]) =>
      {
        const first = {
          x: position.x - padding,
          y: position.y - padding,
          width: NODE_WIDTH + padding * 2,
          height: NODE_HEIGHT + padding * 2,
        };
        const second = {
          x: otherPosition.x - padding,
          y: otherPosition.y - padding,
          width: NODE_WIDTH + padding * 2,
          height: NODE_HEIGHT + padding * 2,
        };
        const overlapX =
          Math.min(first.x + first.width, second.x + second.width) -
          Math.max(first.x, second.x);
        const overlapY =
          Math.min(first.y + first.height, second.y + second.height) -
          Math.max(first.y, second.y);
        return (
          overlapX <= ROUTE_EPSILON || overlapY <= ROUTE_EPSILON
        );
      },
    ),
  );
}

type LayoutConnectedComponent = {
  id: string;
  nodeIds: Set<string>;
  edges: TransferFlowEdge[];
};

function layoutConnectedComponents(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const componentIds = connectedComponentIds(edges, positions);
  const componentsById = new Map<string, LayoutConnectedComponent>();
  positions.forEach((_, nodeId) => {
    const componentId = componentIds.get(nodeId) ?? nodeId;
    const component = componentsById.get(componentId) ?? {
      id: componentId,
      nodeIds: new Set<string>(),
      edges: [],
    };
    component.nodeIds.add(nodeId);
    componentsById.set(componentId, component);
  });
  edges.forEach((edge) => {
    const componentId = componentIds.get(edge.source);
    if (!componentId || componentId !== componentIds.get(edge.target)) {
      return;
    }
    componentsById.get(componentId)?.edges.push(edge);
  });
  return [...componentsById.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

function componentVisualBounds(
  component: LayoutConnectedComponent,
  positions: Map<string, { x: number; y: number }>,
): GraphRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const addPoint = ({ x, y }: GraphPoint) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const addRect = (rect: GraphRect) => {
    addPoint({ x: rect.x, y: rect.y });
    addPoint({
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });
  };

  component.nodeIds.forEach((nodeId) => {
    const position = positions.get(nodeId);
    if (!position) return;
    addRect({
      ...position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });
  component.edges.forEach((edge) => {
    const geometry = edgeHorizontalRoute(edge, positions);
    if (geometry) {
      geometry.segments.forEach((segment) => {
        addPoint(segment.from);
        addPoint(segment.to);
        if (segment.kind === "cubic") {
          addPoint(segment.control1);
          addPoint(segment.control2);
        }
      });
    }
    const label = routedEdgeLabel(edge, positions);
    if (label) addRect(label.rect);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function translateConnectedComponent(
  component: LayoutConnectedComponent,
  positions: Map<string, { x: number; y: number }>,
  dx: number,
  dy: number,
) {
  component.nodeIds.forEach((nodeId) => {
    const position = positions.get(nodeId);
    if (!position) return;
    positions.set(nodeId, {
      x: position.x + dx,
      y: position.y + dy,
    });
  });
  if (Math.abs(dy) <= ROUTE_EPSILON) return;
  component.edges.forEach((edge) => {
    if (edge.data) edge.data.routeY += dy;
  });
}

export function alignDisconnectedComponents(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  primaryNodeId: string,
) {
  const candidatePositions = new Map(
    [...positions.entries()].map(([nodeId, position]) => [
      nodeId,
      { ...position },
    ]),
  );
  const candidateEdges = cloneRoutingEdges(edges);
  const components = layoutConnectedComponents(
    candidateEdges,
    candidatePositions,
  );
  if (components.length <= 1) return false;

  const primary =
    components.find((component) =>
      component.nodeIds.has(primaryNodeId),
    ) ?? components[0];
  const primaryBounds = componentVisualBounds(
    primary,
    candidatePositions,
  );
  const primaryCenterX = primaryBounds.x + primaryBounds.width / 2;
  let changed = false;

  components.forEach((component) => {
    if (component === primary) return;
    const bounds = componentVisualBounds(component, candidatePositions);
    const centerX = bounds.x + bounds.width / 2;
    const dx = Number((primaryCenterX - centerX).toFixed(6));
    if (Math.abs(dx) <= ROUTE_EPSILON) return;
    translateConnectedComponent(
      component,
      candidatePositions,
      dx,
      0,
    );
    changed = true;
  });

  const verticalOrder = [...components].sort((a, b) => {
    const aBounds = componentVisualBounds(a, candidatePositions);
    const bBounds = componentVisualBounds(b, candidatePositions);
    return aBounds.y - bBounds.y || a.id.localeCompare(b.id);
  });
  let previousBottom: number | null = null;
  verticalOrder.forEach((component) => {
    const bounds = componentVisualBounds(component, candidatePositions);
    const minimumTop =
      previousBottom === null
        ? bounds.y
        : previousBottom + MIN_HORIZONTAL_LANE_GAP;
    const dy = Number(Math.max(0, minimumTop - bounds.y).toFixed(6));
    if (dy > ROUTE_EPSILON) {
      translateConnectedComponent(
        component,
        candidatePositions,
        0,
        dy,
      );
      changed = true;
    }
    previousBottom = bounds.y + dy + bounds.height;
  });

  if (
    !changed ||
    !nodeBoxesHaveClearance(candidatePositions) ||
    !routingIsCollisionFree(candidateEdges, candidatePositions)
  ) {
    return false;
  }

  candidatePositions.forEach((position, nodeId) => {
    positions.set(nodeId, position);
  });
  const candidateById = new Map(
    candidateEdges.map((edge) => [edge.id, edge]),
  );
  edges.forEach((edge) => {
    const candidate = candidateById.get(edge.id);
    if (edge.data && candidate?.data) {
      edge.data.routeY = candidate.data.routeY;
    }
  });
  return true;
}

function evaluateColumnGapCompaction({
  edges,
  positions,
  movedNodeIds,
  direction,
  shift,
  currentGap,
  resultingGap,
  preserveStraightPortYs,
  canonicalizeMovedPorts = false,
  stableKey,
}: {
  edges: TransferFlowEdge[];
  positions: Map<string, { x: number; y: number }>;
  movedNodeIds: Set<string>;
  direction: 1 | -1;
  shift: number;
  currentGap: number;
  resultingGap: number;
  preserveStraightPortYs: boolean;
  canonicalizeMovedPorts?: boolean;
  stableKey: string;
}) {
  const baselineProfiles = new Map(
    edges.map((edge) => [edge.id, edgeCurveProfile(edge, positions)]),
  );
  const baselineLabels = new Map(
    edges.map((edge) => [edge.id, routedEdgeLabel(edge, positions)]),
  );
  const candidatePositions = new Map(
    [...positions.entries()].map(([nodeId, position]) => [
      nodeId,
      movedNodeIds.has(nodeId)
        ? {
            ...position,
            y: position.y + direction * shift,
          }
        : { ...position },
    ]),
  );
  if (!nodeBoxesHaveClearance(candidatePositions)) return null;
  const candidateEdges = cloneRoutingEdges(edges);
  if (canonicalizeMovedPorts) {
    canonicalizeMovedLeafPortRatios(
      edges,
      candidateEdges,
      movedNodeIds,
    );
  }
  if (
    preserveStraightPortYs &&
    !preserveMovedStraightDynamicPortYs({
      edges,
      candidateEdges,
      movedNodeIds,
      positions,
      candidatePositions,
    })
  ) {
    return null;
  }
  assignRouteLanes(candidateEdges, candidatePositions);
  const candidateById = new Map(
    candidateEdges.map((edge) => [edge.id, edge]),
  );
  const preservesGeometry = edges.every((edge) => {
    const baseline = baselineProfiles.get(edge.id);
    const candidateEdge = candidateById.get(edge.id);
    const candidate = candidateEdge
      ? edgeCurveProfile(candidateEdge, candidatePositions)
      : null;
    if (!baseline || !candidate || !candidateEdge?.data || !edge.data) {
      return false;
    }
    if (
      baseline.sourceNeedsCurve !== candidate.sourceNeedsCurve ||
      baseline.targetNeedsCurve !== candidate.targetNeedsCurve ||
      baseline.sourceCurveMode !== candidate.sourceCurveMode ||
      baseline.targetCurveMode !== candidate.targetCurveMode
    ) {
      return false;
    }
    if (
      !movedNodeIds.has(edge.source) &&
      !movedNodeIds.has(edge.target) &&
      Math.abs(candidateEdge.data.routeY - edge.data.routeY) >
        ROUTE_EPSILON
    ) {
      return false;
    }
    return true;
  });
  if (
    !preservesGeometry ||
    !routingIsCollisionFree(candidateEdges, candidatePositions) ||
    !dynamicReciprocalBlocksAreContiguous(
      candidateEdges,
      candidatePositions,
    )
  ) {
    return null;
  }

  const labelShift = candidateEdges.reduce((total, edge) => {
    const baseline = baselineLabels.get(edge.id);
    const candidate = routedEdgeLabel(edge, candidatePositions);
    return total +
      (baseline && candidate
        ? Math.abs(candidate.center.x - baseline.center.x)
        : 0);
  }, 0);
  return {
    positions: candidatePositions,
    edges: candidateEdges,
    movedNodeIds,
    gapReduction: currentGap - resultingGap,
    remainingGap: resultingGap,
    displacement: shift * movedNodeIds.size,
    labelShift,
    stableKey,
  } satisfies ColumnGapCompactionCandidate;
}

function preservesAdaptiveColumnGapBoundaries({
  baselinePositions,
  candidatePositions,
  movedNodeIds,
  column,
}: {
  baselinePositions: Map<string, { x: number; y: number }>;
  candidatePositions: Map<string, { x: number; y: number }>;
  movedNodeIds: Set<string>;
  column: ComponentPositionColumn;
}) {
  const minimumGap = minimumColumnNodeTopGap(column.items.length);
  const orderedItems = [...column.items].sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.nodeId.localeCompare(b.nodeId),
  );

  const preservesComponentGaps = orderedItems
    .slice(0, -1)
    .every((item, index) => {
      const next = orderedItems[index + 1];
      if (
        !movedNodeIds.has(item.nodeId) &&
        !movedNodeIds.has(next.nodeId)
      ) {
        return true;
      }
      const baselineGap =
        baselinePositions.get(next.nodeId)!.y -
        baselinePositions.get(item.nodeId)!.y;
      const candidateGap =
        candidatePositions.get(next.nodeId)!.y -
        candidatePositions.get(item.nodeId)!.y;
      return (
        candidateGap + ROUTE_EPSILON >=
        Math.min(baselineGap, minimumGap)
      );
    });
  if (!preservesComponentGaps) return false;

  const physicalItems = [...column.physicalColumn.items].sort(
    (a, b) =>
      a.position.y - b.position.y ||
      a.nodeId.localeCompare(b.nodeId),
  );
  return physicalItems.slice(0, -1).every((item, index) => {
    const physicalNext = physicalItems[index + 1];
    if (
      !movedNodeIds.has(item.nodeId) &&
      !movedNodeIds.has(physicalNext.nodeId)
    ) {
      return true;
    }
    const baselineGap =
      baselinePositions.get(physicalNext.nodeId)!.y -
      baselinePositions.get(item.nodeId)!.y;
    const candidateGap =
      candidatePositions.get(physicalNext.nodeId)!.y -
      candidatePositions.get(item.nodeId)!.y;
    return (
      candidateGap + ROUTE_EPSILON >=
      Math.min(baselineGap, MIN_COLUMN_NODE_TOP_GAP)
    );
  });
}

function applyColumnGapCandidate(
  candidate: ColumnGapCompactionCandidate,
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  candidate.positions.forEach((position, nodeId) => {
    positions.set(nodeId, position);
  });
  const candidateById = new Map(
    candidate.edges.map((edge) => [edge.id, edge]),
  );
  edges.forEach((edge) => {
    const candidateEdge = candidateById.get(edge.id);
    if (edge.data && candidateEdge?.data) {
      Object.assign(edge.data, candidateEdge.data);
    }
  });
}

function syncNodePortRatios(
  nodes: AddressFlowNode[],
  edges: TransferFlowEdge[],
) {
  const ratiosByHandle = new Map<string, number>();
  edges.forEach((edge) => {
    if (edge.sourceHandle && edge.data) {
      ratiosByHandle.set(
        `${edge.source}:${edge.sourceHandle}`,
        edge.data.sourcePortRatio,
      );
    }
    if (edge.targetHandle && edge.data) {
      ratiosByHandle.set(
        `${edge.target}:${edge.targetHandle}`,
        edge.data.targetPortRatio,
      );
    }
  });
  nodes.forEach((node) => {
    node.data = {
      ...node.data,
      ports: node.data.ports.map((port) => ({
        ...port,
        ratio:
          ratiosByHandle.get(`${node.id}:${port.id}`) ?? port.ratio,
      })),
    };
  });
}

export function compactDynamicReciprocalColumnGaps(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
  nodes?: AddressFlowNode[],
) {
  let changed = false;

  while (true) {
    const dynamicPeerIds = dynamicReciprocalPeerIds(edges);
    const columns = buildComponentPositionColumns(
      edges,
      positions,
    ).filter((column) =>
      column.items.some((item) => dynamicPeerIds.has(item.nodeId)),
    );
    const candidates: ColumnGapCompactionCandidate[] = [];

    columns.forEach((column) => {
      const compressionThreshold = Math.max(
        COLUMN_GAP_COMPACTION_THRESHOLD,
        columnClusterThreshold(column.items.length),
      );
      const orderedItems = [...column.items].sort(
        (a, b) =>
          a.position.y - b.position.y ||
          a.nodeId.localeCompare(b.nodeId),
      );
      for (let index = 0; index < orderedItems.length - 1; index += 1) {
        const upper = orderedItems[index];
        const lower = orderedItems[index + 1];
        if (
          !dynamicPeerIds.has(upper.nodeId) ||
          !dynamicPeerIds.has(lower.nodeId)
        ) {
          continue;
        }
        const currentGap = lower.position.y - upper.position.y;
        if (
          currentGap <= compressionThreshold + ROUTE_EPSILON
        ) {
          continue;
        }
        const maxShift = currentGap - MIN_COLUMN_NODE_TOP_GAP;
        let upperBlockStart = index;
        while (
          upperBlockStart > 0 &&
            orderedItems[upperBlockStart].position.y -
              orderedItems[upperBlockStart - 1].position.y <=
            compressionThreshold + ROUTE_EPSILON
        ) {
          upperBlockStart -= 1;
        }
        let lowerBlockEnd = index + 1;
        while (
          lowerBlockEnd < orderedItems.length - 1 &&
            orderedItems[lowerBlockEnd + 1].position.y -
              orderedItems[lowerBlockEnd].position.y <=
            compressionThreshold + ROUTE_EPSILON
        ) {
          lowerBlockEnd += 1;
        }

        const moves = [
          {
            direction: 1 as const,
            movedNodeIds: new Set(
              orderedItems
                .slice(upperBlockStart, index + 1)
                .map((item) => item.nodeId),
            ),
            stableKey: `${column.x}:${column.componentId}:${upper.nodeId}:prefix`,
          },
          {
            direction: -1 as const,
            movedNodeIds: new Set(
              orderedItems
                .slice(index + 1, lowerBlockEnd + 1)
                .map((item) => item.nodeId),
            ),
            stableKey: `${column.x}:${column.componentId}:${lower.nodeId}:suffix`,
          },
        ];

        moves.forEach((move) => {
          if (
            !canShiftNodeBlockWithoutBreakingStraightEdge(
              move.movedNodeIds,
              edges,
              positions,
            )
          ) {
            return;
          }
          const shifts = compactionShiftCandidates({
            movedNodeIds: move.movedNodeIds,
            direction: move.direction,
            maxShift,
            edges,
            positions,
          });
          for (const shift of shifts) {
            const candidate = evaluateColumnGapCompaction({
              edges,
              positions,
              movedNodeIds: move.movedNodeIds,
              direction: move.direction,
              shift,
              currentGap,
              resultingGap: currentGap - shift,
              preserveStraightPortYs: false,
              stableKey: move.stableKey,
            });
            if (!candidate) continue;
            candidates.push(candidate);
            break;
          }
        });
      }
    });

    const best = candidates.sort(
      (a, b) =>
        b.gapReduction - a.gapReduction ||
        a.remainingGap - b.remainingGap ||
        a.movedNodeIds.size - b.movedNodeIds.size ||
        a.displacement - b.displacement ||
        a.labelShift - b.labelShift ||
        a.stableKey.localeCompare(b.stableKey),
    )[0];
    if (!best) break;

    applyColumnGapCandidate(best, edges, positions);
    changed = true;
  }

  while (true) {
    const dynamicPeerIds = dynamicReciprocalPeerIds(edges);
    const columns = buildComponentPositionColumns(
      edges,
      positions,
    ).filter((column) =>
      column.items.some((item) => dynamicPeerIds.has(item.nodeId)),
    );
    const candidates: ColumnGapCompactionCandidate[] = [];

    columns.forEach((column) => {
      const minimumGap = minimumColumnNodeTopGap(column.items.length);
      const clusterThreshold = columnClusterThreshold(
        column.items.length,
      );
      const orderedItems = [...column.items].sort(
        (a, b) =>
          a.position.y - b.position.y ||
          a.nodeId.localeCompare(b.nodeId),
      );

      for (let index = 0; index < orderedItems.length - 1; index += 1) {
        const upper = orderedItems[index];
        const lower = orderedItems[index + 1];
        if (
          !dynamicPeerIds.has(upper.nodeId) ||
          !dynamicPeerIds.has(lower.nodeId)
        ) {
          continue;
        }
        const currentGap = lower.position.y - upper.position.y;
        if (currentGap + ROUTE_EPSILON >= minimumGap) continue;

        const targetShift = minimumGap - currentGap;
        let upperBlockStart = index;
        while (
          upperBlockStart > 0 &&
          orderedItems[upperBlockStart].position.y -
            orderedItems[upperBlockStart - 1].position.y <=
            clusterThreshold + ROUTE_EPSILON
        ) {
          upperBlockStart -= 1;
        }
        let lowerBlockEnd = index + 1;
        while (
          lowerBlockEnd < orderedItems.length - 1 &&
          orderedItems[lowerBlockEnd + 1].position.y -
            orderedItems[lowerBlockEnd].position.y <=
            clusterThreshold + ROUTE_EPSILON
        ) {
          lowerBlockEnd += 1;
        }

        const moves = [
          {
            direction: -1 as const,
            movedNodeIds: new Set(
              orderedItems
                .slice(upperBlockStart, index + 1)
                .map((item) => item.nodeId),
            ),
            stableKey: `${column.x}:${column.componentId}:${upper.nodeId}:expand-prefix`,
          },
          {
            direction: 1 as const,
            movedNodeIds: new Set(
              orderedItems
                .slice(index + 1, lowerBlockEnd + 1)
                .map((item) => item.nodeId),
            ),
            stableKey: `${column.x}:${column.componentId}:${lower.nodeId}:expand-suffix`,
          },
        ];

        moves.forEach((move) => {
          if (
            !canShiftNodeBlockWithoutBreakingStraightEdge(
              move.movedNodeIds,
              edges,
              positions,
            )
          ) {
            return;
          }
          const shifts = expansionShiftCandidates({
            movedNodeIds: move.movedNodeIds,
            direction: move.direction,
            targetShift,
            edges,
            positions,
          });
          for (const shift of shifts) {
            const candidateWithStablePort =
              evaluateColumnGapCompaction({
                edges,
                positions,
                movedNodeIds: move.movedNodeIds,
                direction: move.direction,
                shift,
                currentGap,
                resultingGap: currentGap + shift,
                preserveStraightPortYs: true,
                stableKey: move.stableKey,
              });
            const candidate =
              candidateWithStablePort ??
              evaluateColumnGapCompaction({
                edges,
                positions,
                movedNodeIds: move.movedNodeIds,
                direction: move.direction,
                shift,
                currentGap,
                resultingGap: currentGap + shift,
                preserveStraightPortYs: false,
                canonicalizeMovedPorts: true,
                stableKey: move.stableKey,
              });
            if (
              candidate &&
              preservesAdaptiveColumnGapBoundaries({
                baselinePositions: positions,
                candidatePositions: candidate.positions,
                movedNodeIds: move.movedNodeIds,
                column,
              })
            ) {
              candidates.push(candidate);
              break;
            }
          }
        });
      }
    });

    const best = candidates.sort(
      (a, b) =>
        a.gapReduction - b.gapReduction ||
        a.movedNodeIds.size - b.movedNodeIds.size ||
        a.displacement - b.displacement ||
        a.labelShift - b.labelShift ||
        a.stableKey.localeCompare(b.stableKey),
    )[0];
    if (!best) break;

    applyColumnGapCandidate(best, edges, positions);
    changed = true;
  }

  if (nodes) syncNodePortRatios(nodes, edges);
  return changed;
}

export function assignRouteLanes(
  edges: TransferFlowEdge[],
  positions: Map<string, { x: number; y: number }>,
) {
  routeComponents(routeEntries(edges, positions)).forEach((component) => {
    assignComponentLanes(component, positions);
  });
}

export function edgeHorizontalRoute(
  edge: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  if (!edge.data || !edge.sourceHandle || !edge.targetHandle) return null;
  const sourcePosition = positions.get(edge.source);
  const targetPosition = positions.get(edge.target);
  if (!sourcePosition || !targetPosition) return null;

  const sourcePoint = portPoint(
    sourcePosition,
    edge.sourceHandle,
    edge.data.sourcePortRatio,
  );
  const targetPoint = portPoint(
    targetPosition,
    edge.targetHandle,
    edge.data.targetPortRatio,
  );
  return edgeRouteGeometry({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    routeY: edge.data.routeY,
    sourceCurveMode: edge.data.sourceCurveMode,
    targetCurveMode: edge.data.targetCurveMode,
  });
}

export function edgeNodeCollisions(
  edge: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const geometry = edgeHorizontalRoute(edge, positions);
  if (!geometry) return [];

  return [...positions.entries()].flatMap(([nodeId, position]) => {
    const isEndpoint = nodeId === edge.source || nodeId === edge.target;
    const intersects = pathIntersectsRect(
      geometry.segments,
      {
        ...position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
      isEndpoint ? -0.75 : NODE_ROUTE_CLEARANCE,
    );

    return intersects ? [nodeId] : [];
  });
}

export function horizontalRoutesConflict(
  a: TransferFlowEdge,
  b: TransferFlowEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const aRoute = edgeHorizontalRoute(a, positions);
  const bRoute = edgeHorizontalRoute(b, positions);
  if (!aRoute || !bRoute || !a.data || !b.data) return false;

  return (
    horizontalIntervalsOverlap(aRoute, bRoute) &&
    Math.abs(a.data.routeY - b.data.routeY) + 0.0001 < MIN_HORIZONTAL_LANE_GAP
  );
}

export async function layoutTrace(trace: TxTraceResponse) {
  const { nodes, edges } = toFlowElements(trace);
  const layoutEdges = buildLayoutEdges(trace);
  const positions = await layoutPositionsWithHorizontalCorridors(
    nodes,
    edges,
    layoutEdges,
  );
  const receiverId = trace.tx.to?.toLowerCase() ?? null;
  orderColumnPositionsByTransferIndex(edges, positions, receiverId);
  centerRightColumnsByLeftNeighbors(edges, positions, receiverId);
  alignColumnsForStraightRoutes(edges, positions, receiverId);
  assignEdgePorts(edges, positions);
  assignRouteLanes(edges, positions);
  const hasDynamicReciprocalPorts = assignReciprocalBundlePorts(
    nodes,
    edges,
    positions,
  );
  if (hasDynamicReciprocalPorts) {
    assignRouteLanes(edges, positions);
  }
  const hasMixedDirectionPorts = assignMixedDirectionFanoutPorts(
    nodes,
    edges,
    positions,
  );
  if (hasMixedDirectionPorts) {
    assignRouteLanes(edges, positions);
  }
  if (hasDynamicReciprocalPorts) {
    if (alignDynamicReciprocalLeafColumns(edges, positions)) {
      assignRouteLanes(edges, positions);
    }
    compactDynamicReciprocalColumnGaps(edges, positions, nodes);
  }
  equalizeComponentColumnSpacing(
    edges,
    positions,
    trace.tx.from.toLowerCase(),
  );
  alignDisconnectedComponents(
    edges,
    positions,
    trace.tx.from.toLowerCase(),
  );
  alignColumnPairLabels(edges, positions);

  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges,
  };
}
