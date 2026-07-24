import { describe, expect, it } from "vitest";
import {
  TRANSFER_ARROW_MARKER_HEIGHT,
  TRANSFER_ARROW_MARKER_WIDTH,
  GRAPH_COLORS,
  transferArrowMarkerId,
} from "./edge-style";
import {
  adaptiveColumnClearGap,
  alignColumnPairLabels,
  alignDisconnectedComponents,
  alignDynamicReciprocalLeafColumns,
  assignMixedDirectionFanoutPorts,
  assignReciprocalBundlePorts,
  assignRouteLanes,
  alignColumnsForStraightRoutes,
  buildLayoutEdges,
  centerRightColumnsByLeftNeighbors,
  compactDynamicReciprocalColumnGaps,
  edgeHasValidHorizontalCorridor,
  edgeHorizontalRoute,
  edgeNodeCollisions,
  equalizeComponentColumnSpacing,
  horizontalRoutesConflict,
  layoutTrace,
  orderColumnPositionsByTransferIndex,
  routingIsCollisionFree,
  toFlowElements,
} from "./layout";
import {
  DEFAULT_GRAPH_PORTS,
  MIN_HORIZONTAL_LANE_GAP,
  NODE_HEIGHT,
  NODE_ROUTE_CLEARANCE,
  NODE_WIDTH,
  defaultPortRatio,
  edgeLabelGeometry,
  horizontalIntervalsOverlap,
  pathIntersectsRect,
  pathsIntersect,
  portPoint,
  rectsIntersect,
} from "./geometry";
import type { AddressFlowNode, TransferFlowEdge } from "./types";
import type { AddressNodeRecord, TransferEdgeRecord, TransferRecord, TxTraceResponse } from "@/lib/tx/types";
import {
  REPORTED_DCC9_ADDRESSES,
  reportedDcc9Trace,
} from "./fixtures/reported-dcc9-trace";

const SENDER = "0x1111111111111111111111111111111111111111";
const RECEIVER = "0x2222222222222222222222222222222222222222";
const SUSHI = "0x3333333333333333333333333333333333333333";
const WETH = "0x4444444444444444444444444444444444444444";
const BUILDER = "0x5555555555555555555555555555555555555555";
const UPPER = "0x6666666666666666666666666666666666666666";
const LOWER = "0x7777777777777777777777777777777777777777";
const OTHER = "0x8888888888888888888888888888888888888888";

function node(address: string, roles: AddressNodeRecord["roles"]): AddressNodeRecord {
  return {
    id: address.toLowerCase(),
    address,
    shortAddress: address,
    label: roles[0] ?? "internal",
    roles,
    transferCount: 1,
    incomingCount: 1,
    outgoingCount: 1,
  };
}

function edge(source: string, target: string, index: number): TransferEdgeRecord {
  return {
    id: `edge:${source.toLowerCase()}->${target.toLowerCase()}:${index}`,
    source: source.toLowerCase(),
    target: target.toLowerCase(),
    label: `[${index}] transfer`,
    displayIndexes: [index],
    transferIds: [`transfer:${index}`],
    kinds: ["erc20"],
    transferCount: 1,
    assets: [],
    hasFailed: false,
  };
}

function transfer(
  kind: TransferRecord["kind"],
  from: string,
  to: string,
  index: number,
  displayIndex: number | null,
): TransferRecord {
  const isErc20 = kind === "erc20";

  return {
    id: `${kind}:${index}`,
    kind,
    txHash: `0x${"a".repeat(64)}`,
    from,
    to,
    assetKey: isErc20 ? "erc20:test" : "native:ETH",
    tokenAddress: isErc20 ? "0x9999999999999999999999999999999999999999" : null,
    tokenName: isErc20 ? "Test Token" : null,
    symbol: isErc20 ? "TEST" : "ETH",
    decimals: 18,
    valueRaw: "1",
    valueFormatted: isErc20 ? "1.00" : "0.00",
    label: isErc20 ? "1.00 TEST" : "0.00 ETH",
    index,
    displayIndex,
    failed: false,
    metadataWarnings: [],
  };
}

function trace(): TxTraceResponse {
  return {
    tx: {
      hash: `0x${"a".repeat(64)}`,
      chainId: "1",
      from: SENDER,
      to: RECEIVER,
      valueRaw: "0",
      status: "success",
      blockNumber: null,
    },
    nodes: [
      node(SENDER, ["sender"]),
      node(RECEIVER, ["receiver"]),
      node(SUSHI, ["internal"]),
      node(WETH, ["internal"]),
      node(BUILDER, ["internal"]),
    ],
    edges: [
      edge(SENDER, RECEIVER, 1),
      edge(SUSHI, RECEIVER, 2),
      edge(RECEIVER, SUSHI, 3),
      edge(WETH, RECEIVER, 4),
      edge(RECEIVER, WETH, 5),
      edge(RECEIVER, BUILDER, 6),
    ],
    transfers: [],
    warnings: [],
  };
}

function traceWithFirstNonNativeOutSource(): TxTraceResponse {
  return {
    ...trace(),
    edges: [
      edge(SENDER, RECEIVER, 1),
      edge(BUILDER, RECEIVER, 2),
      edge(SUSHI, RECEIVER, 3),
      edge(WETH, RECEIVER, 4),
    ],
    transfers: [
      transfer("topLevelCall", SENDER, RECEIVER, 0, 1),
      transfer("internal", BUILDER, RECEIVER, 1, null),
      transfer("erc20", SUSHI, RECEIVER, 2, 2),
      transfer("erc20", WETH, RECEIVER, 3, 3),
    ],
  };
}

function traceWithDisconnectedComponent(): TxTraceResponse {
  return {
    ...trace(),
    nodes: [
      node(SENDER, ["sender"]),
      node(RECEIVER, ["receiver"]),
      node(UPPER, ["internal"]),
      node(LOWER, ["internal"]),
      node(OTHER, ["internal"]),
    ],
    edges: [
      edge(SENDER, RECEIVER, 1),
      edge(UPPER, LOWER, 3),
      edge(UPPER, LOWER, 4),
      edge(UPPER, OTHER, 6),
    ],
    transfers: [],
  };
}

function traceWithDisconnectedCycle(): TxTraceResponse {
  return {
    ...traceWithDisconnectedComponent(),
    edges: [
      edge(SENDER, RECEIVER, 1),
      edge(UPPER, LOWER, 3),
      edge(LOWER, OTHER, 4),
      edge(OTHER, UPPER, 5),
    ],
  };
}

function flowEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  displayIndexes: Array<number | null> = [],
): TransferFlowEdge {
  const sourceId = source.toLowerCase();
  const targetId = target.toLowerCase();

  return {
    id,
    type: "transfer",
    source: sourceId,
    target: targetId,
    sourceHandle,
    targetHandle,
    markerEnd: transferArrowMarkerId(GRAPH_COLORS.erc20),
    data: {
      id,
      source: sourceId,
      target: targetId,
      label: id,
      displayIndexes,
      transferIds: [],
      kinds: ["erc20"],
      transferCount: 1,
      assets: [],
      hasFailed: false,
      transfers: [],
      fanoutHub: null,
      routeY: 0,
      labelBias: 0.5,
      sourceCurveMode: "default",
      targetCurveMode: "default",
      sourcePortRatio: defaultPortRatio(sourceHandle),
      targetPortRatio: defaultPortRatio(targetHandle),
      mixedDirectionGroups: [],
    },
  };
}

function flowNode(
  id: string,
  position: { x: number; y: number },
): AddressFlowNode {
  return {
    id,
    type: "address",
    position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      ...node(id, ["internal"]),
      ports: DEFAULT_GRAPH_PORTS.map((port) => ({ ...port })),
    },
  };
}

function routeY(edge: TransferFlowEdge) {
  return edge.data?.routeY ?? Number.NaN;
}

function cloneEdges(edges: TransferFlowEdge[]) {
  return edges.map((edge) => ({
    ...edge,
    data: edge.data ? { ...edge.data } : edge.data,
  }));
}

function reportedTopology() {
  const sender = SENDER.toLowerCase();
  const receiver = RECEIVER.toLowerCase();
  const preReceiver = SUSHI.toLowerCase();
  const hub = WETH.toLowerCase();
  const upper = BUILDER.toLowerCase();
  const middle = UPPER.toLowerCase();
  const lower = LOWER.toLowerCase();
  const bottom = OTHER.toLowerCase();
  const positions = new Map([
    [sender, { x: 0, y: 0 }],
    [receiver, { x: 720, y: 0 }],
    [preReceiver, { x: 0, y: 320 }],
    [hub, { x: 720, y: 320 }],
    [upper, { x: 1440, y: 88 }],
    [middle, { x: 1440, y: 320 }],
    [lower, { x: 1440, y: 552 }],
    [bottom, { x: 720, y: 552 }],
  ]);
  const edges = [
    flowEdge("initial-call", SENDER, RECEIVER, "out-right", "in-left", [1]),
    flowEdge("unknown-native", RECEIVER, SENDER, "out-left", "in-right", [null]),
    flowEdge("transfer-2", SUSHI, WETH, "out-right", "in-left", [2]),
    flowEdge("transfer-3", BUILDER, WETH, "out-left", "in-right", [3]),
    flowEdge("transfer-4", WETH, BUILDER, "out-right", "in-left", [4]),
    flowEdge("transfer-5", WETH, UPPER, "out-right", "in-left", [5]),
    flowEdge("transfer-6", WETH, LOWER, "out-right", "in-left", [6]),
    flowEdge("transfer-7", WETH, SUSHI, "out-left", "in-right", [7]),
    flowEdge("transfer-8", SUSHI, OTHER, "out-right", "in-left", [8]),
  ];

  return { positions, edges };
}

function reciprocalSpacingTopology() {
  const hub = "spacing-hub";
  const left = "spacing-left";
  const child11 = "spacing-child-11";
  const child13 = "spacing-child-13";
  const child15 = "spacing-child-15";
  const child17 = "spacing-child-17";
  const positions = new Map([
    [left, { x: 0, y: 1024 }],
    [hub, { x: 720, y: 908 }],
    [child11, { x: 1428, y: 805 }],
    [child13, { x: 1428, y: 1037 }],
    [child15, { x: 1428, y: 1269 }],
    [child17, { x: 1428, y: 1501 }],
  ]);
  const edges = [
    flowEdge("transfer-2", left, hub, "out-right", "in-left", [2]),
    flowEdge("transfer-10", hub, left, "out-left", "in-right", [10]),
    flowEdge("transfer-12", hub, child11, "out-right", "in-left", [12]),
    flowEdge("transfer-11", child11, hub, "out-left", "in-right", [11]),
    flowEdge("transfer-14", hub, child13, "out-right", "in-left", [14]),
    flowEdge("transfer-13", child13, hub, "out-left", "in-right", [13]),
    flowEdge("transfer-16", hub, child15, "out-right", "in-left", [16]),
    flowEdge("transfer-15", child15, hub, "out-left", "in-right", [15]),
    flowEdge("transfer-18", hub, child17, "out-right", "in-left", [18]),
    flowEdge("transfer-17", child17, hub, "out-left", "in-right", [17]),
  ];

  return { positions, edges };
}

function optimizedRoutingTopology() {
  const hub = "optimized-hub";
  const middle = "optimized-middle";
  const zero = "optimized-zero";
  const upper = "optimized-upper";
  const c841 = "optimized-c841";
  const right = "optimized-right";
  const positions = new Map([
    [hub, { x: 2136, y: 347 }],
    [middle, { x: 2844, y: 541 }],
    [zero, { x: 3552, y: 541 }],
    [upper, { x: 2844, y: 347 }],
    [c841, { x: 2844, y: 444 }],
    [right, { x: 3552, y: 444 }],
  ]);
  const edges = [
    flowEdge("left-unknown", hub, middle, "out-right", "in-left", [null]),
    flowEdge("transfer-6", zero, hub, "out-left", "in-right", [6]),
    flowEdge("transfer-7", hub, upper, "out-right", "in-left", [7]),
    flowEdge("transfer-10", c841, hub, "out-left", "in-right", [10]),
    flowEdge("right-unknown", middle, zero, "out-right", "in-left", [null]),
    flowEdge("transfer-8", upper, right, "out-right", "in-left", [8]),
    flowEdge("transfer-9", right, c841, "out-left", "in-right", [9]),
  ];
  edges.find((item) => item.id === "transfer-6")!.data!.label =
    "[6] 3,587.96 USDC";
  edges.find((item) => item.id === "left-unknown")!.data!.label =
    "[?] 2.06 ETH";
  edges.find((item) => item.id === "right-unknown")!.data!.label =
    "[?] 2.06 ETH";
  edges.find((item) => item.id === "transfer-9")!.data!.label =
    "[9] 3,587.96 USDC";

  return { positions, edges };
}

function mixedDirectionFanoutTopology() {
  const hub = "mixed-hub";
  const transfer5Peer = "mixed-transfer-5-peer";
  const transfer7Peer = "mixed-transfer-7-peer";
  const transfer13Peer = "mixed-transfer-13-peer";
  const transfer8Peer = "mixed-transfer-8-peer";
  const positions = new Map<string, { x: number; y: number }>([
    [hub, { x: 720, y: 679 }],
    [transfer5Peer, { x: 1428, y: 244 }],
    [transfer7Peer, { x: 1428, y: 341 }],
    [transfer13Peer, { x: 1428, y: 573 }],
    [transfer8Peer, { x: 1428, y: 805 }],
  ]);
  const edges = [
    flowEdge(
      "mixed-transfer-5",
      transfer5Peer,
      hub,
      "out-left",
      "in-right",
      [5],
    ),
    flowEdge(
      "mixed-transfer-7",
      hub,
      transfer7Peer,
      "out-right",
      "in-left",
      [7],
    ),
    flowEdge(
      "mixed-transfer-13",
      hub,
      transfer13Peer,
      "out-right",
      "in-left",
      [13],
    ),
    flowEdge(
      "mixed-transfer-8",
      transfer8Peer,
      hub,
      "out-left",
      "in-right",
      [8],
    ),
  ];
  const nodes = [...positions.entries()].map(([id, position]) =>
    flowNode(id, position),
  );

  return { hub, positions, nodes, edges };
}

function mixedDirectionFanoutRangeTopology(edgeCount: number) {
  const hub = `mixed-range-hub-${edgeCount}`;
  const positions = new Map<string, { x: number; y: number }>([
    [hub, { x: 720, y: 679 }],
  ]);
  const peerYs = [244, 341, 573];
  const edges = Array.from({ length: edgeCount }, (_, index) => {
    const peer = `mixed-range-peer-${edgeCount}-${index}`;
    positions.set(peer, {
      x: 1428,
      y: peerYs[index] ?? 805 + (index - 3) * 97,
    });
    return index === 0
      ? flowEdge(
          `mixed-range-${edgeCount}-${index}`,
          peer,
          hub,
          "out-left",
          "in-right",
          [5],
        )
      : flowEdge(
          `mixed-range-${edgeCount}-${index}`,
          hub,
          peer,
          "out-right",
          "in-left",
          [6 + index],
        );
  });
  const nodes = [...positions.entries()].map(([id, position]) =>
    flowNode(id, position),
  );

  return { positions, nodes, edges };
}

function admissibleFallbackRoutingTopology() {
  const sender = "fallback-live-sender";
  const receiver = "fallback-live-receiver";
  const lowerLeft = "fallback-live-lower-left";
  const middle = "fallback-live-middle";
  const upperRight = "fallback-live-upper-right";
  const lowerRight = "fallback-live-lower-right";
  const farRight = "fallback-live-far-right";
  const positions = new Map([
    [sender, { x: 12, y: 163 }],
    [receiver, { x: 720, y: 163 }],
    [lowerLeft, { x: 12, y: 395 }],
    [middle, { x: 1428, y: 163 }],
    [upperRight, { x: 2136, y: 163 }],
    [lowerRight, { x: 2136, y: 408 }],
    [farRight, { x: 2844, y: 134.5 }],
  ]);
  const edges = [
    flowEdge("fallback-live-1", sender, receiver, "out-right", "in-left", [1]),
    flowEdge("fallback-live-2", lowerLeft, receiver, "out-right", "in-left", [2]),
    flowEdge("fallback-live-3", receiver, lowerLeft, "out-left", "in-right", [3]),
    flowEdge("fallback-live-4", upperRight, receiver, "out-left", "in-right", [4]),
    flowEdge("fallback-live-5", middle, upperRight, "out-right", "in-left", [5]),
    flowEdge("fallback-live-6", receiver, middle, "out-right", "in-left", [6]),
    flowEdge("fallback-live-7", lowerRight, receiver, "out-left", "in-right", [7]),
    flowEdge("fallback-live-8", farRight, lowerRight, "out-left", "in-right", [8]),
    flowEdge("fallback-live-9", upperRight, farRight, "out-right", "in-left", [9]),
    flowEdge("fallback-live-10", receiver, upperRight, "out-right", "in-left", [10]),
  ];

  return { positions, edges, receiver, farRight };
}

function reciprocalBundleTopology(pairCount = 2, includeUnknown = false) {
  const hub = "bundle-hub";
  const hubY = pairCount * 232 + 200;
  const positions = new Map<string, { x: number; y: number }>([
    [hub, { x: 0, y: hubY }],
  ]);
  const edges: TransferFlowEdge[] = [];

  for (let index = 0; index < pairCount; index += 1) {
    const peer = `bundle-peer-${index}`;
    positions.set(peer, { x: 708, y: index * 232 });
    edges.push(
      flowEdge(
        `bundle-forward-${index}`,
        hub,
        peer,
        "out-right",
        "in-left",
        [index * 2 + 1],
      ),
      flowEdge(
        `bundle-reverse-${index}`,
        peer,
        hub,
        "out-left",
        "in-right",
        [index * 2 + 2],
      ),
    );
  }

  if (includeUnknown) {
    const unknownPeer = "bundle-unknown";
    positions.set(unknownPeer, { x: 708, y: pairCount * 232 });
    edges.push(
      flowEdge(
        "bundle-unknown-edge",
        hub,
        unknownPeer,
        "out-right",
        "in-left",
        [null],
      ),
    );
  }

  const nodes = [...positions.entries()].map(([id, position]) =>
    flowNode(id, position),
  );
  return { hub, positions, nodes, edges };
}

function reportedReciprocalBundleTopology() {
  const hub = "reported-bundle-hub";
  const columnContext = "reported-bundle-column-context";
  const upper = "reported-bundle-upper";
  const lower = "reported-bundle-lower";
  const unknown = "reported-bundle-unknown";
  const positions = new Map<string, { x: number; y: number }>([
    [hub, { x: 720, y: 622 }],
    [columnContext, { x: 1428, y: 12 }],
    [upper, { x: 1428, y: 244 }],
    [lower, { x: 1428, y: 476 }],
    [unknown, { x: 1428, y: 573 }],
  ]);
  const edges = [
    flowEdge("reported-8", hub, upper, "out-right", "in-left", [8]),
    flowEdge("reported-5", upper, hub, "out-left", "in-right", [5]),
    flowEdge("reported-11", hub, lower, "out-right", "in-left", [11]),
    flowEdge("reported-10", lower, hub, "out-left", "in-right", [10]),
    flowEdge(
      "reported-unknown",
      hub,
      unknown,
      "out-right",
      "in-left",
      [null],
    ),
  ];
  const nodes = [...positions.entries()].map(([id, position]) =>
    flowNode(id, position),
  );
  return { hub, positions, nodes, edges };
}

function sparseAdaptiveSpacingTopology() {
  const hub = "adaptive-spacing-hub";
  const upper = "adaptive-spacing-upper";
  const lower = "adaptive-spacing-lower";
  const positions = new Map<string, { x: number; y: number }>([
    [hub, { x: 0, y: 200 }],
    [upper, { x: 708, y: 0 }],
    [lower, { x: 708, y: 112 }],
  ]);
  const edges = [
    flowEdge(
      "adaptive-spacing-upper-edge",
      hub,
      upper,
      "dynamic:adaptive-upper",
      "in-left",
      [1],
    ),
    flowEdge(
      "adaptive-spacing-lower-edge",
      hub,
      lower,
      "dynamic:adaptive-lower",
      "in-left",
      [2],
    ),
  ];
  edges[0].data!.sourcePortRatio = 0.36;
  edges[1].data!.sourcePortRatio = 0.64;
  return { hub, upper, lower, positions, edges };
}

function applyReportedReciprocalSpacing(
  topology: ReturnType<typeof reportedReciprocalBundleTopology>,
) {
  assignRouteLanes(topology.edges, topology.positions);
  expect(
    assignReciprocalBundlePorts(
      topology.nodes,
      topology.edges,
      topology.positions,
    ),
  ).toBe(true);
  assignRouteLanes(topology.edges, topology.positions);
  expect(
    alignDynamicReciprocalLeafColumns(
      topology.edges,
      topology.positions,
    ),
  ).toBe(true);
  assignRouteLanes(topology.edges, topology.positions);
  expect(
    compactDynamicReciprocalColumnGaps(
      topology.edges,
      topology.positions,
      topology.nodes,
    ),
  ).toBe(true);
}

describe("graph layout", () => {
  it("anchors receiver before every non-sender address in the layout skeleton", () => {
    const layoutEdges = buildLayoutEdges(trace()).map(
      (layoutEdge) => `${layoutEdge.sources[0]}->${layoutEdge.targets[0]}`,
    );
    const sender = SENDER.toLowerCase();
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const weth = WETH.toLowerCase();
    const builder = BUILDER.toLowerCase();

    expect(layoutEdges).toContain(`${sender}->${receiver}`);
    expect(layoutEdges).toContain(`${receiver}->${sushi}`);
    expect(layoutEdges).toContain(`${receiver}->${weth}`);
    expect(layoutEdges).toContain(`${receiver}->${builder}`);
    expect(layoutEdges).not.toContain(`${sushi}->${receiver}`);
    expect(layoutEdges).not.toContain(`${weth}->${receiver}`);
  });

  it("places every non-sender address to the right of receiver", async () => {
    const layouted = await layoutTrace(trace());
    const positions = new Map(layouted.nodes.map((layoutNode) => [layoutNode.id, layoutNode.position.x]));
    const receiverX = positions.get(RECEIVER.toLowerCase()) ?? 0;

    expect(positions.get(SENDER.toLowerCase()) ?? 0).toBeLessThan(receiverX);
    expect(positions.get(SUSHI.toLowerCase()) ?? 0).toBeGreaterThan(receiverX);
    expect(positions.get(WETH.toLowerCase()) ?? 0).toBeGreaterThan(receiverX);
    expect(positions.get(BUILDER.toLowerCase()) ?? 0).toBeGreaterThan(receiverX);
  });

  it("anchors the first non-native out source before receiver and ignores earlier native ETH", () => {
    const layoutEdges = buildLayoutEdges(traceWithFirstNonNativeOutSource()).map(
      (layoutEdge) => `${layoutEdge.sources[0]}->${layoutEdge.targets[0]}`,
    );
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const weth = WETH.toLowerCase();
    const builder = BUILDER.toLowerCase();

    expect(layoutEdges).toContain(`${sushi}->${receiver}`);
    expect(layoutEdges).toContain(`${receiver}->${builder}`);
    expect(layoutEdges).toContain(`${receiver}->${weth}`);
    expect(layoutEdges).not.toContain(`${receiver}->${sushi}`);
    expect(layoutEdges).not.toContain(`${builder}->${receiver}`);
  });

  it("places the first non-native out source to the left of receiver", async () => {
    const layouted = await layoutTrace(traceWithFirstNonNativeOutSource());
    const positions = new Map(layouted.nodes.map((layoutNode) => [layoutNode.id, layoutNode.position.x]));
    const receiverX = positions.get(RECEIVER.toLowerCase()) ?? 0;

    expect(positions.get(SUSHI.toLowerCase()) ?? 0).toBeLessThan(receiverX);
    expect(positions.get(WETH.toLowerCase()) ?? 0).toBeGreaterThan(receiverX);
    expect(positions.get(BUILDER.toLowerCase()) ?? 0).toBeGreaterThan(receiverX);
  });

  it("orders same-column addresses by their minimum transfer index with receiver", () => {
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const weth = WETH.toLowerCase();
    const builder = BUILDER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 100 }],
      [weth, { x: 740, y: 0 }],
      [builder, { x: 740, y: 160 }],
      [sushi, { x: 740, y: 320 }],
    ]);
    const edges = [
      flowEdge("weth-late", RECEIVER, WETH, "out-right", "in-left", [7]),
      flowEdge("builder-unknown", RECEIVER, BUILDER, "out-right", "in-left", [null]),
      flowEdge("sushi-early", RECEIVER, SUSHI, "out-right", "in-left", [2, 4]),
    ];

    orderColumnPositionsByTransferIndex(edges, positions, receiver);

    expect(positions.get(sushi)).toEqual({ x: 740, y: 0 });
    expect(positions.get(weth)).toEqual({ x: 740, y: 160 });
    expect(positions.get(builder)).toEqual({ x: 740, y: 320 });
    expect(positions.get(receiver)).toEqual({ x: 300, y: 100 });
  });

  it("keeps same-column spacing and falls back to incident transfer order without receiver pair", () => {
    const receiver = RECEIVER.toLowerCase();
    const upper = UPPER.toLowerCase();
    const lower = LOWER.toLowerCase();
    const other = OTHER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 100 }],
      [upper, { x: 980, y: 22 }],
      [lower, { x: 980.5, y: 250 }],
      [other, { x: 1280, y: 480 }],
    ]);
    const edges = [
      flowEdge("upper-incident-late", upper, other, "out-right", "in-left", [8]),
      flowEdge("lower-incident-early", lower, other, "out-right", "in-left", [3]),
    ];

    orderColumnPositionsByTransferIndex(edges, positions, receiver);

    expect(positions.get(lower)).toEqual({ x: 980.5, y: 22 });
    expect(positions.get(upper)).toEqual({ x: 980, y: 250 });
    expect(positions.get(other)).toEqual({ x: 1280, y: 480 });
  });

  it("centers a single right-side child on its connected left address", () => {
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const other = OTHER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 100 }],
      [sushi, { x: 740, y: 240 }],
      [other, { x: 1180, y: 20 }],
    ]);
    const edges = [
      flowEdge("receiver-sushi", RECEIVER, SUSHI, "out-right", "in-left", [2]),
      flowEdge("sushi-other", SUSHI, OTHER, "out-right", "in-left", [8]),
    ];

    centerRightColumnsByLeftNeighbors(edges, positions, receiver);

    expect(positions.get(other)?.y).toBe(positions.get(sushi)?.y);
  });

  it("aligns one preferred child in an even sibling group with its left address", () => {
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const upper = UPPER.toLowerCase();
    const lower = LOWER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 100 }],
      [sushi, { x: 740, y: 240 }],
      [lower, { x: 1180, y: 0 }],
      [upper, { x: 1180, y: 232 }],
    ]);
    const edges = [
      flowEdge("receiver-sushi", RECEIVER, SUSHI, "out-right", "in-left", [2]),
      flowEdge("sushi-upper", SUSHI, UPPER, "out-right", "in-left", [9]),
      flowEdge("sushi-lower", SUSHI, LOWER, "out-right", "in-left", [3]),
    ];

    centerRightColumnsByLeftNeighbors(edges, positions, receiver);

    expect(positions.get(lower)?.y).toBe(240);
    expect(positions.get(upper)?.y).toBe(472);
    expect(positions.get(lower)?.y).toBe(positions.get(sushi)?.y);
  });

  it("prefers a reciprocal child for even sibling alignment before transfer order", () => {
    const receiver = RECEIVER.toLowerCase();
    const sushi = SUSHI.toLowerCase();
    const upper = UPPER.toLowerCase();
    const lower = LOWER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 100 }],
      [sushi, { x: 740, y: 240 }],
      [upper, { x: 1180, y: 0 }],
      [lower, { x: 1180, y: 232 }],
    ]);
    const edges = [
      flowEdge("receiver-sushi", RECEIVER, SUSHI, "out-right", "in-left", [1]),
      flowEdge("sushi-upper", SUSHI, UPPER, "out-right", "in-left", [2]),
      flowEdge("sushi-lower", SUSHI, LOWER, "out-right", "in-left", [8]),
      flowEdge("lower-sushi", LOWER, SUSHI, "out-left", "in-right", [9]),
    ];

    centerRightColumnsByLeftNeighbors(edges, positions, receiver);

    expect(positions.get(lower)?.y).toBe(positions.get(sushi)?.y);
    expect(positions.get(upper)?.y).toBe(8);
  });

  it("aligns whole columns to maximize safe straight routes with index tie-breaking", () => {
    const sender = "align-sender";
    const other = "align-other";
    const receiver = "align-receiver";
    const positions = new Map([
      [sender, { x: 0, y: 231 }],
      [other, { x: 0, y: 463 }],
      [receiver, { x: 720, y: 347 }],
    ]);
    const edges = [
      flowEdge("align-1", sender, receiver, "out-right", "in-left", [1]),
      flowEdge("align-2", other, receiver, "out-right", "in-left", [2]),
    ];

    alignColumnsForStraightRoutes(edges, positions, receiver);

    expect(positions.get(sender)?.y).toBe(347);
    expect(positions.get(other)?.y).toBe(579);
    expect(
      (positions.get(other)?.y ?? 0) - (positions.get(sender)?.y ?? 0),
    ).toBe(232);
  });

  it("chooses the two-straight-route shift for a 3-to-2 column boundary", () => {
    const upper = "column-upper";
    const middle = "column-middle";
    const lower = "column-lower";
    const rightUpper = "column-right-upper";
    const rightLower = "column-right-lower";
    const positions = new Map([
      [upper, { x: 0, y: -85 }],
      [middle, { x: 0, y: 12 }],
      [lower, { x: 0, y: 109 }],
      [rightUpper, { x: 708, y: -36.5 }],
      [rightLower, { x: 708, y: 60.5 }],
    ]);
    const edges = [
      flowEdge("column-8", upper, rightUpper, "out-right", "in-left", [8]),
      flowEdge("column-9", rightUpper, middle, "out-left", "in-right", [9]),
      flowEdge("column-unknown", lower, rightLower, "out-right", "in-left", [null]),
    ];

    alignColumnsForStraightRoutes(edges, positions, middle);

    expect(positions.get(rightUpper)?.y).toBe(12);
    expect(positions.get(rightLower)?.y).toBe(109);
  });

  it("falls back to the best admissible straight-route alignment", () => {
    const anchorUpper = "fallback-anchor-upper";
    const anchorLower = "fallback-anchor-lower";
    const movable = "fallback-movable";
    const positions = new Map([
      [anchorUpper, { x: 0, y: 163 }],
      [anchorLower, { x: 0, y: 408 }],
      [movable, { x: 708, y: 134.5 }],
    ]);
    const edges = [
      flowEdge(
        "fallback-8",
        movable,
        anchorLower,
        "out-left",
        "in-right",
        [8],
      ),
      flowEdge(
        "fallback-9",
        anchorUpper,
        movable,
        "out-right",
        "in-left",
        [9],
      ),
    ];

    alignColumnsForStraightRoutes(edges, positions, anchorUpper);

    expect(positions.get(movable)?.y).toBe(163);
    const transfer8Source = portPoint(
      positions.get(movable)!,
      "out-left",
    );
    const transfer8Target = portPoint(
      positions.get(anchorLower)!,
      "in-right",
    );
    const transfer9Source = portPoint(
      positions.get(anchorUpper)!,
      "out-right",
    );
    const transfer9Target = portPoint(
      positions.get(movable)!,
      "in-left",
    );

    expect(transfer9Source.y).toBe(transfer9Target.y);
    expect(transfer8Source.y).not.toBe(transfer8Target.y);
  });

  it("keeps the fallback transaction safe and deterministic", () => {
    const forward = admissibleFallbackRoutingTopology();
    const reverse = admissibleFallbackRoutingTopology();
    reverse.edges.reverse();

    [forward, reverse].forEach(({ positions, edges, receiver }) => {
      alignColumnsForStraightRoutes(edges, positions, receiver);
      assignRouteLanes(edges, positions);
    });

    expect(forward.positions.get(forward.farRight)?.y).toBe(163);
    const expectedCurveCounts = new Map([
      [1, 0],
      [2, 2],
      [3, 1],
      [4, 2],
      [5, 0],
      [6, 0],
      [7, 1],
      [8, 1],
      [9, 0],
      [10, 2],
    ]);
    const forwardById = new Map(
      forward.edges.map((edge) => [edge.id, edge]),
    );

    forward.edges.forEach((edge, index) => {
      const transferIndex = edge.data!.displayIndexes[0]!;
      const route = edgeHorizontalRoute(edge, forward.positions)!;
      expect(
        Number(route.sourceNeedsCurve) + Number(route.targetNeedsCurve),
        `transfer ${transferIndex} has the wrong curve count`,
      ).toBe(expectedCurveCounts.get(transferIndex));
      expect(edgeNodeCollisions(edge, forward.positions)).toEqual([]);

      forward.edges.slice(index + 1).forEach((other) => {
        expect(
          horizontalRoutesConflict(edge, other, forward.positions),
          `${edge.id} conflicts with ${other.id}`,
        ).toBe(false);
      });
    });
    reverse.edges.forEach((edge) => {
      const forwardEdge = forwardById.get(edge.id)!;
      expect(edge.data?.routeY).toBe(forwardEdge.data?.routeY);
      expect(edge.data?.sourceCurveMode).toBe(
        forwardEdge.data?.sourceCurveMode,
      );
      expect(edge.data?.targetCurveMode).toBe(
        forwardEdge.data?.targetCurveMode,
      );
    });
  });

  it("adds horizontal corridors for a disconnected transfer component", async () => {
    const layouted = await layoutTrace(traceWithDisconnectedComponent());
    const positions = new Map(
      layouted.nodes.map((layoutNode) => [layoutNode.id, layoutNode.position]),
    );

    layouted.edges.forEach((layoutEdge) => {
      expect(
        edgeHasValidHorizontalCorridor(layoutEdge, positions),
        `${layoutEdge.id} has no horizontal corridor`,
      ).toBe(true);
      expect(
        edgeNodeCollisions(layoutEdge, positions),
        `${layoutEdge.id} crosses an address box`,
      ).toEqual([]);
    });

    const transfer3 = layouted.edges.find((layoutEdge) =>
      layoutEdge.data?.displayIndexes.includes(3),
    )!;
    const transfer4 = layouted.edges.find((layoutEdge) =>
      layoutEdge.data?.displayIndexes.includes(4),
    )!;
    const transfer6 = layouted.edges.find((layoutEdge) =>
      layoutEdge.data?.displayIndexes.includes(6),
    )!;

    expect(positions.get(transfer3.source)?.x).not.toBe(positions.get(transfer3.target)?.x);
    expect(positions.get(transfer4.source)?.x).not.toBe(positions.get(transfer4.target)?.x);
    expect(positions.get(transfer6.source)?.x).not.toBe(positions.get(transfer6.target)?.x);
  });

  it("keeps disconnected cycle layout deterministic and collision-free", async () => {
    const forwardTrace = traceWithDisconnectedCycle();
    const reverseTrace = {
      ...traceWithDisconnectedCycle(),
      edges: [...traceWithDisconnectedCycle().edges].reverse(),
    };
    const [forward, reverse] = await Promise.all([
      layoutTrace(forwardTrace),
      layoutTrace(reverseTrace),
    ]);
    const forwardPositions = new Map(
      forward.nodes.map((layoutNode) => [layoutNode.id, layoutNode.position]),
    );
    const reversePositions = new Map(
      reverse.nodes.map((layoutNode) => [layoutNode.id, layoutNode.position]),
    );
    const reverseRoutes = new Map(
      reverse.edges.map((layoutEdge) => [layoutEdge.id, routeY(layoutEdge)]),
    );

    forward.nodes.forEach((layoutNode) => {
      expect(layoutNode.position).toEqual(reversePositions.get(layoutNode.id));
    });
    forward.edges.forEach((layoutEdge) => {
      expect(edgeHasValidHorizontalCorridor(layoutEdge, forwardPositions)).toBe(true);
      expect(edgeNodeCollisions(layoutEdge, forwardPositions)).toEqual([]);
      expect(routeY(layoutEdge)).toBe(reverseRoutes.get(layoutEdge.id));
    });
  });

  it("centers equal disconnected components on the primary graph deterministically", () => {
    const primaryLeft = "component-primary-left";
    const primaryRight = "component-primary-right";
    const upperLeft = "component-upper-left";
    const upperRight = "component-upper-right";
    const makeTopology = () => {
      const positions = new Map([
        [primaryLeft, { x: 0, y: 300 }],
        [primaryRight, { x: 708, y: 300 }],
        [upperLeft, { x: 1416, y: 0 }],
        [upperRight, { x: 2124, y: 0 }],
      ]);
      const edges = [
        flowEdge(
          "component-primary-edge",
          primaryLeft,
          primaryRight,
          "out-right",
          "in-left",
          [1],
        ),
        flowEdge(
          "component-upper-edge",
          upperLeft,
          upperRight,
          "out-right",
          "in-left",
          [2],
        ),
      ];
      assignRouteLanes(edges, positions);
      return { positions, edges };
    };
    const forward = makeTopology();
    const reverse = makeTopology();
    reverse.edges.reverse();
    assignRouteLanes(reverse.edges, reverse.positions);
    const primaryBaseline = new Map(
      [primaryLeft, primaryRight].map((nodeId) => [
        nodeId,
        { ...forward.positions.get(nodeId)! },
      ]),
    );
    const upperRouteY = routeY(
      forward.edges.find((edge) => edge.id === "component-upper-edge")!,
    );

    expect(
      alignDisconnectedComponents(
        forward.edges,
        forward.positions,
        primaryLeft,
      ),
    ).toBe(true);
    expect(
      alignDisconnectedComponents(
        reverse.edges,
        reverse.positions,
        primaryLeft,
      ),
    ).toBe(true);
    expect(forward.positions.get(primaryLeft)).toEqual(
      primaryBaseline.get(primaryLeft),
    );
    expect(forward.positions.get(primaryRight)).toEqual(
      primaryBaseline.get(primaryRight),
    );
    expect(forward.positions.get(upperLeft)).toEqual({ x: 0, y: 0 });
    expect(forward.positions.get(upperRight)).toEqual({
      x: 708,
      y: 0,
    });
    expect(
      routeY(
        forward.edges.find(
          (edge) => edge.id === "component-upper-edge",
        )!,
      ),
    ).toBe(upperRouteY);
    expect(reverse.positions).toEqual(forward.positions);
    const reverseById = new Map(
      reverse.edges.map((edge) => [edge.id, edge]),
    );
    forward.edges.forEach((edge) => {
      expect(routeY(reverseById.get(edge.id)!)).toBe(routeY(edge));
    });
  });

  it("centers disconnected components with different visual widths", () => {
    const positions = new Map([
      ["wide-left", { x: 0, y: 300 }],
      ["wide-middle", { x: 708, y: 300 }],
      ["wide-right", { x: 1416, y: 300 }],
      ["narrow-left", { x: 2000, y: 0 }],
      ["narrow-right", { x: 2708, y: 0 }],
    ]);
    const edges = [
      flowEdge(
        "wide-edge-left",
        "wide-left",
        "wide-middle",
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "wide-edge-right",
        "wide-middle",
        "wide-right",
        "out-right",
        "in-left",
        [2],
      ),
      flowEdge(
        "narrow-edge",
        "narrow-left",
        "narrow-right",
        "out-right",
        "in-left",
        [3],
      ),
    ];
    assignRouteLanes(edges, positions);

    expect(
      alignDisconnectedComponents(edges, positions, "wide-left"),
    ).toBe(true);
    expect(positions.get("wide-left")?.x).toBe(0);
    expect(positions.get("wide-middle")?.x).toBe(708);
    expect(positions.get("wide-right")?.x).toBe(1416);
    expect(positions.get("narrow-left")?.x).toBe(354);
    expect(positions.get("narrow-right")?.x).toBe(1062);
  });

  it("stacks vertically overlapping components with a 56px visual gap", () => {
    const positions = new Map([
      ["primary-a", { x: 0, y: 0 }],
      ["primary-b", { x: 708, y: 0 }],
      ["secondary-a", { x: 1416, y: 0 }],
      ["secondary-b", { x: 2124, y: 0 }],
    ]);
    const edges = [
      flowEdge(
        "primary-overlap-edge",
        "primary-a",
        "primary-b",
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "secondary-overlap-edge",
        "secondary-a",
        "secondary-b",
        "out-right",
        "in-left",
        [2],
      ),
    ];
    assignRouteLanes(edges, positions);
    const secondary = edges.find(
      (edge) => edge.id === "secondary-overlap-edge",
    )!;
    const secondaryRouteY = routeY(secondary);

    expect(
      alignDisconnectedComponents(edges, positions, "primary-a"),
    ).toBe(true);
    expect(positions.get("primary-a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("secondary-a")).toEqual({
      x: 0,
      y: NODE_HEIGHT + MIN_HORIZONTAL_LANE_GAP,
    });
    expect(routeY(secondary)).toBe(
      secondaryRouteY + NODE_HEIGHT + MIN_HORIZONTAL_LANE_GAP,
    );
    edges.forEach((edge, index) => {
      expect(edgeNodeCollisions(edge, positions)).toEqual([]);
      edges.slice(index + 1).forEach((other) => {
        expect(horizontalRoutesConflict(edge, other, positions)).toBe(
          false,
        );
      });
    });
  });

  it("leaves an already centered or single connected component unchanged", () => {
    const centeredPositions = new Map([
      ["centered-primary-a", { x: 0, y: 0 }],
      ["centered-primary-b", { x: 708, y: 0 }],
      ["centered-upper-a", { x: 0, y: 300 }],
      ["centered-upper-b", { x: 708, y: 300 }],
    ]);
    const centeredEdges = [
      flowEdge(
        "centered-primary-edge",
        "centered-primary-a",
        "centered-primary-b",
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "centered-upper-edge",
        "centered-upper-a",
        "centered-upper-b",
        "out-right",
        "in-left",
        [2],
      ),
    ];
    assignRouteLanes(centeredEdges, centeredPositions);
    const centeredBaseline = new Map(
      [...centeredPositions.entries()].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );
    expect(
      alignDisconnectedComponents(
        centeredEdges,
        centeredPositions,
        "centered-primary-a",
      ),
    ).toBe(false);
    expect(centeredPositions).toEqual(centeredBaseline);

    const singlePositions = new Map([
      ["single-a", { x: 0, y: 0 }],
      ["single-b", { x: 708, y: 0 }],
    ]);
    const singleEdges = [
      flowEdge(
        "single-edge",
        "single-a",
        "single-b",
        "out-right",
        "in-left",
        [1],
      ),
    ];
    assignRouteLanes(singleEdges, singlePositions);
    expect(
      alignDisconnectedComponents(
        singleEdges,
        singlePositions,
        "single-a",
      ),
    ).toBe(false);
  });

  it("moves a long horizontal route around an intermediate address box", () => {
    const source = SENDER.toLowerCase();
    const target = RECEIVER.toLowerCase();
    const blocker = UPPER.toLowerCase();
    const positions = new Map([
      [source, { x: 0, y: 200 }],
      [blocker, { x: 720, y: 200 }],
      [target, { x: 1440, y: 200 }],
    ]);
    const longEdge = flowEdge(
      "long-edge",
      source,
      target,
      "out-right",
      "in-left",
      [1],
    );

    assignRouteLanes([longEdge], positions);

    expect(edgeNodeCollisions(longEdge, positions)).toEqual([]);
    expect(routeY(longEdge) < 176 || routeY(longEdge) > 300).toBe(true);
  });

  it("rejects same-column and too-narrow endpoint corridors", () => {
    const source = SENDER.toLowerCase();
    const target = RECEIVER.toLowerCase();
    const testEdge = flowEdge(
      "corridor",
      source,
      target,
      "out-right",
      "in-left",
      [1],
    );

    expect(
      edgeHasValidHorizontalCorridor(
        testEdge,
        new Map([
          [source, { x: 0, y: 0 }],
          [target, { x: 0, y: 200 }],
        ]),
      ),
    ).toBe(false);
    expect(
      edgeHasValidHorizontalCorridor(
        testEdge,
        new Map([
          [source, { x: 0, y: 0 }],
          [target, { x: 430, y: 200 }],
        ]),
      ),
    ).toBe(false);
    expect(
      edgeHasValidHorizontalCorridor(
        testEdge,
        new Map([
          [source, { x: 0, y: 0 }],
          [target, { x: 708, y: 200 }],
        ]),
      ),
    ).toBe(true);
  });

  it("satisfies all reported transaction routing invariants", () => {
    const { positions, edges } = reportedTopology();
    const nodes = [...positions.entries()].map(([id, position]) =>
      flowNode(id, position),
    );
    assignRouteLanes(edges, positions);
    if (assignMixedDirectionFanoutPorts(nodes, edges, positions)) {
      assignRouteLanes(edges, positions);
    }
    const byId = new Map(edges.map((edge) => [edge.id, edge]));
    const initialCall = byId.get("initial-call")!;
    const unknownNative = byId.get("unknown-native")!;
    const transfer2 = byId.get("transfer-2")!;
    const transfer3 = byId.get("transfer-3")!;
    const transfer4 = byId.get("transfer-4")!;
    const transfer5 = byId.get("transfer-5")!;

    expect(routeY(transfer4)).toBeLessThan(routeY(transfer3));
    expect(Math.abs(routeY(transfer4) - routeY(transfer5))).toBeGreaterThanOrEqual(
      MIN_HORIZONTAL_LANE_GAP,
    );

    const transfer2Route = edgeHorizontalRoute(transfer2, positions);
    expect(transfer2Route?.sourceNeedsCurve).toBe(false);
    expect(transfer2Route?.targetNeedsCurve).toBe(false);

    const initialRoute = edgeHorizontalRoute(initialCall, positions);
    const unknownRoute = edgeHorizontalRoute(unknownNative, positions);
    expect(routeY(unknownNative)).toBeGreaterThan(routeY(initialCall));
    expect(initialRoute?.sourceNeedsCurve).toBe(false);
    expect(initialRoute?.targetNeedsCurve).toBe(false);
    expect(unknownRoute?.sourceNeedsCurve).toBe(true);
    expect(unknownRoute?.targetNeedsCurve).toBe(true);
    expect(routeY(unknownNative)).toBeGreaterThan(
      Math.max(
        portPoint(positions.get(SENDER.toLowerCase())!, "in-right").y,
        portPoint(positions.get(RECEIVER.toLowerCase())!, "out-left").y,
      ),
    );

    edges.forEach((edge, index) => {
      edges.slice(index + 1).forEach((other) => {
        expect(
          horizontalRoutesConflict(edge, other, positions),
          `${edge.id} (${routeY(edge)}) conflicts with ${other.id} (${routeY(other)})`,
        ).toBe(false);
      });
    });
  });

  it("assigns deterministic lanes independently of input edge order", () => {
    const forward = reportedTopology();
    const reverse = reportedTopology();
    reverse.edges.reverse();

    [forward, reverse].forEach(({ edges, positions }) => {
      const nodes = [...positions.entries()].map(([id, position]) =>
        flowNode(id, position),
      );
      assignRouteLanes(edges, positions);
      if (assignMixedDirectionFanoutPorts(nodes, edges, positions)) {
        assignRouteLanes(edges, positions);
      }
    });

    const forwardRoutes = new Map(forward.edges.map((edge) => [edge.id, routeY(edge)]));
    reverse.edges.forEach((edge) => {
      expect(routeY(edge)).toBe(forwardRoutes.get(edge.id));
    });
  });

  it("repairs mixed fan-in/fan-out inversions while keeping one straight endpoint per edge", () => {
    const forward = mixedDirectionFanoutTopology();
    const reverse = mixedDirectionFanoutTopology();
    reverse.edges.reverse();

    [forward, reverse].forEach(({ nodes, edges, positions }) => {
      assignRouteLanes(edges, positions);
      const byId = new Map(edges.map((edge) => [edge.id, edge]));
      const transfer5 = byId.get("mixed-transfer-5")!;
      const transfer7 = byId.get("mixed-transfer-7")!;
      const before5 = edgeHorizontalRoute(transfer5, positions)!;
      const before7 = edgeHorizontalRoute(transfer7, positions)!;
      expect(
        pathsIntersect(before5.segments, before7.segments),
      ).toBe(true);

      expect(
        assignMixedDirectionFanoutPorts(nodes, edges, positions),
      ).toBe(true);
      assignRouteLanes(edges, positions);
    });

    const byId = new Map(
      forward.edges.map((edge) => [edge.id, edge]),
    );
    const transfer5 = byId.get("mixed-transfer-5")!;
    const transfer7 = byId.get("mixed-transfer-7")!;
    const transfer13 = byId.get("mixed-transfer-13")!;
    const transfer8 = byId.get("mixed-transfer-8")!;
    const transfer5Route = edgeHorizontalRoute(
      transfer5,
      forward.positions,
    )!;
    const transfer7Route = edgeHorizontalRoute(
      transfer7,
      forward.positions,
    )!;
    const transfer13Route = edgeHorizontalRoute(
      transfer13,
      forward.positions,
    )!;
    const transfer8Route = edgeHorizontalRoute(
      transfer8,
      forward.positions,
    )!;

    expect(transfer5Route.sourceNeedsCurve).toBe(false);
    expect(transfer5Route.targetNeedsCurve).toBe(true);
    expect(transfer5.data?.targetCurveMode).toBe("compact");
    expect(transfer7Route.sourceNeedsCurve).toBe(true);
    expect(transfer7Route.targetNeedsCurve).toBe(false);
    expect(transfer13Route.sourceNeedsCurve).toBe(true);
    expect(transfer13Route.targetNeedsCurve).toBe(false);
    expect(transfer8Route.sourceNeedsCurve).toBe(false);
    expect(transfer8Route.targetNeedsCurve).toBe(true);
    expect(routeY(transfer5)).toBeLessThan(routeY(transfer7));
    expect(routeY(transfer7)).toBeLessThan(routeY(transfer13));
    forward.edges.forEach((edge) => {
      const geometry = edgeHorizontalRoute(edge, forward.positions)!;
      expect(
        Number(geometry.sourceNeedsCurve) +
          Number(geometry.targetNeedsCurve),
        `${edge.id} lost both straight endpoints`,
      ).toBeLessThanOrEqual(1);
    });

    const orderedHubRatios = [
      transfer5.data!.targetPortRatio,
      transfer7.data!.sourcePortRatio,
      transfer13.data!.sourcePortRatio,
      transfer8.data!.targetPortRatio,
    ];
    expect(orderedHubRatios).toEqual(
      [...orderedHubRatios].sort((a, b) => a - b),
    );
    const hubNode = forward.nodes.find(
      (node) => node.id === forward.hub,
    )!;
    forward.edges.forEach((edge) => {
      const sourceAtHub = edge.source === forward.hub;
      const handle = sourceAtHub
        ? edge.sourceHandle
        : edge.targetHandle;
      const ratio = sourceAtHub
        ? edge.data!.sourcePortRatio
        : edge.data!.targetPortRatio;
      expect(
        hubNode.data.ports.find((port) => port.id === handle)?.ratio,
      ).toBe(ratio);
    });

    forward.edges.forEach((edge, index) => {
      const geometry = edgeHorizontalRoute(edge, forward.positions)!;
      forward.edges.slice(index + 1).forEach((other) => {
        const otherGeometry = edgeHorizontalRoute(
          other,
          forward.positions,
        )!;
        expect(
          pathsIntersect(geometry.segments, otherGeometry.segments),
          `${edge.id} crosses ${other.id}`,
        ).toBe(false);
      });
    });

    const reverseById = new Map(
      reverse.edges.map((edge) => [edge.id, edge]),
    );
    forward.edges.forEach((edge) => {
      const reversed = reverseById.get(edge.id)!;
      expect(reversed.data?.routeY).toBe(edge.data?.routeY);
      expect(reversed.sourceHandle).toBe(edge.sourceHandle);
      expect(reversed.targetHandle).toBe(edge.targetHandle);
      expect(reversed.data?.sourcePortRatio).toBe(
        edge.data?.sourcePortRatio,
      );
      expect(reversed.data?.targetPortRatio).toBe(
        edge.data?.targetPortRatio,
      );
      expect(reversed.data?.sourceCurveMode).toBe(
        edge.data?.sourceCurveMode,
      );
      expect(reversed.data?.targetCurveMode).toBe(
        edge.data?.targetCurveMode,
      );
    });
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 3))(
    "keeps one straight endpoint across a mixed side with %i routes",
    (edgeCount) => {
      const topology = mixedDirectionFanoutRangeTopology(edgeCount);
      assignRouteLanes(topology.edges, topology.positions);
      expect(
        assignMixedDirectionFanoutPorts(
          topology.nodes,
          topology.edges,
          topology.positions,
        ),
      ).toBe(true);
      assignRouteLanes(topology.edges, topology.positions);

      topology.edges.forEach((edge, index) => {
        const geometry = edgeHorizontalRoute(
          edge,
          topology.positions,
        )!;
        expect(
          Number(geometry.sourceNeedsCurve) +
            Number(geometry.targetNeedsCurve),
          `${edge.id} lost both straight endpoints`,
        ).toBeLessThanOrEqual(1);
        topology.edges.slice(index + 1).forEach((other) => {
          const otherGeometry = edgeHorizontalRoute(
            other,
            topology.positions,
          )!;
          expect(
            pathsIntersect(
              geometry.segments,
              otherGeometry.segments,
            ),
            `${edge.id} crosses ${other.id}`,
          ).toBe(false);
        });
      });
    },
  );

  it("optimizes direct routes, pairwise lanes, compact curves, and label slots together", () => {
    const { positions, edges } = optimizedRoutingTopology();
    const nodes = [...positions.entries()].map(([id, position]) =>
      flowNode(id, position),
    );
    assignRouteLanes(edges, positions);
    if (assignMixedDirectionFanoutPorts(nodes, edges, positions)) {
      assignRouteLanes(edges, positions);
    }
    const byId = new Map(edges.map((edge) => [edge.id, edge]));
    const transfer6 = byId.get("transfer-6")!;
    const transfer9 = byId.get("transfer-9")!;
    const leftUnknown = byId.get("left-unknown")!;
    const rightUnknown = byId.get("right-unknown")!;
    const transfer6Route = edgeHorizontalRoute(transfer6, positions)!;
    const transfer9Route = edgeHorizontalRoute(transfer9, positions)!;
    const leftUnknownRoute = edgeHorizontalRoute(leftUnknown, positions)!;
    const rightUnknownRoute = edgeHorizontalRoute(rightUnknown, positions)!;

    expect(transfer9Route.sourceNeedsCurve).toBe(false);
    expect(transfer9Route.targetNeedsCurve).toBe(false);
    expect(rightUnknownRoute.sourceNeedsCurve).toBe(false);
    expect(rightUnknownRoute.targetNeedsCurve).toBe(false);
    expect(leftUnknownRoute.sourceNeedsCurve).toBe(true);
    expect(leftUnknownRoute.targetNeedsCurve).toBe(false);
    expect(routeY(leftUnknown)).toBe(routeY(rightUnknown));
    expect(transfer6.data?.targetCurveMode).toBe("compact");
    expect(
      pathsIntersect(transfer6Route.segments, leftUnknownRoute.segments),
    ).toBe(false);
    expect(
      pathsIntersect(transfer6Route.segments, rightUnknownRoute.segments),
    ).toBe(false);

    const label = edgeLabelGeometry({
      label: transfer6.data!.label,
      horizontalStartX: transfer6Route.horizontalStartX,
      horizontalEndX: transfer6Route.horizontalEndX,
      routeY: transfer6.data!.routeY,
      labelBias: transfer6.data!.labelBias,
    });
    positions.forEach((position) => {
      expect(
        rectsIntersect(label.rect, {
          x: position.x - NODE_ROUTE_CLEARANCE,
          y: position.y - NODE_ROUTE_CLEARANCE,
          width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
          height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
        }),
      ).toBe(false);
    });
    edges.forEach((edge, index) => {
      expect(edgeNodeCollisions(edge, positions)).toEqual([]);
      edges.slice(index + 1).forEach((other) => {
        expect(horizontalRoutesConflict(edge, other, positions)).toBe(false);
      });
    });
  });

  it("compacts only oversized reciprocal gaps without adding curves", () => {
    const forward = reciprocalSpacingTopology();
    const reverse = reciprocalSpacingTopology();
    reverse.edges.reverse();

    assignRouteLanes(forward.edges, forward.positions);
    assignRouteLanes(reverse.edges, reverse.positions);

    const byIndex = new Map(
      forward.edges.flatMap((edge) =>
        (edge.data?.displayIndexes ?? []).map((index) => [index, edge] as const),
      ),
    );
    const pairGap = (a: number, b: number) =>
      Math.abs(routeY(byIndex.get(a)!) - routeY(byIndex.get(b)!));
    expect(pairGap(15, 16)).toBe(MIN_HORIZONTAL_LANE_GAP);
    expect(pairGap(17, 18)).toBe(MIN_HORIZONTAL_LANE_GAP);
    expect(pairGap(13, 14)).toBeCloseTo(73);
    expect(pairGap(2, 10)).toBeCloseTo(137.28);
    expect(pairGap(11, 12)).toBeCloseTo(124.28);

    [2, 10, 11, 12].forEach((index) => {
      const route = edgeHorizontalRoute(byIndex.get(index)!, forward.positions);
      expect(
        Number(route?.sourceNeedsCurve) + Number(route?.targetNeedsCurve),
        `transfer ${index} gained a curve`,
      ).toBe(1);
    });

    forward.edges.forEach((edge, index) => {
      expect(edgeNodeCollisions(edge, forward.positions)).toEqual([]);
      forward.edges.slice(index + 1).forEach((other) => {
        expect(
          horizontalRoutesConflict(edge, other, forward.positions),
          `${edge.id} conflicts with ${other.id}`,
        ).toBe(false);
      });
    });

    const reverseRoutes = new Map(
      reverse.edges.map((edge) => [edge.id, routeY(edge)]),
    );
    forward.edges.forEach((edge) => {
      expect(routeY(edge)).toBe(reverseRoutes.get(edge.id));
    });
  });

  it("forms safe deterministic reciprocal blocks with dynamic ports", () => {
    const forward = reportedReciprocalBundleTopology();
    const reverse = reportedReciprocalBundleTopology();
    reverse.edges.reverse();
    const baselineCurveCounts = new Map<string, number>();
    const preCompactionProfiles = new Map<
      string,
      {
        sourceNeedsCurve: boolean;
        targetNeedsCurve: boolean;
        sourceCurveMode: string;
        targetCurveMode: string;
      }
    >();

    [forward, reverse].forEach((topology) => {
      const { nodes, edges, positions } = topology;
      assignRouteLanes(edges, positions);
      if (topology === forward) {
        edges.forEach((edge) => {
          const route = edgeHorizontalRoute(edge, positions)!;
          baselineCurveCounts.set(
            edge.id,
            Number(route.sourceNeedsCurve) +
              Number(route.targetNeedsCurve),
          );
        });
      }
      expect(
        assignReciprocalBundlePorts(nodes, edges, positions),
      ).toBe(true);
      assignRouteLanes(edges, positions);
      expect(
        alignDynamicReciprocalLeafColumns(edges, positions),
      ).toBe(true);
      assignRouteLanes(edges, positions);
      if (topology === forward) {
        edges.forEach((edge) => {
          const route = edgeHorizontalRoute(edge, positions)!;
          preCompactionProfiles.set(edge.id, {
            sourceNeedsCurve: route.sourceNeedsCurve,
            targetNeedsCurve: route.targetNeedsCurve,
            sourceCurveMode: edge.data!.sourceCurveMode,
            targetCurveMode: edge.data!.targetCurveMode,
          });
        });
      }
      expect(
        compactDynamicReciprocalColumnGaps(edges, positions, nodes),
      ).toBe(true);
      expect(
        compactDynamicReciprocalColumnGaps(edges, positions, nodes),
      ).toBe(false);
    });

    const byIndex = new Map(
      forward.edges.flatMap((edge) =>
        edge.data!.displayIndexes.map((index) => [index, edge] as const),
      ),
    );
    const pairs = [
      [8, 5],
      [11, 10],
    ] as const;
    pairs.forEach(([forwardIndex, reverseIndex]) => {
      const upper = byIndex.get(forwardIndex)!;
      const lower = byIndex.get(reverseIndex)!;
      expect(routeY(lower) - routeY(upper)).toBe(
        MIN_HORIZONTAL_LANE_GAP,
      );
      const minY = Math.min(routeY(upper), routeY(lower));
      const maxY = Math.max(routeY(upper), routeY(lower));
      const upperRoute = edgeHorizontalRoute(upper, forward.positions)!;
      const lowerRoute = edgeHorizontalRoute(lower, forward.positions)!;
      const intervening = forward.edges.filter((edge) => {
        if (edge === upper || edge === lower) return false;
        if (routeY(edge) <= minY || routeY(edge) >= maxY) return false;
        const route = edgeHorizontalRoute(edge, forward.positions)!;
        return (
          horizontalIntervalsOverlap(route, upperRoute) ||
          horizontalIntervalsOverlap(route, lowerRoute)
        );
      });
      expect(intervening).toEqual([]);
    });
    expect(routeY(byIndex.get(null)!)).toBeGreaterThan(
      Math.max(routeY(byIndex.get(5)!), routeY(byIndex.get(10)!)),
    );
    const transfer11Geometry = edgeHorizontalRoute(
      byIndex.get(11)!,
      forward.positions,
    )!;
    expect(transfer11Geometry.sourceNeedsCurve).toBe(false);
    expect(transfer11Geometry.targetNeedsCurve).toBe(false);
    const unknownGeometry = edgeHorizontalRoute(
      byIndex.get(null)!,
      forward.positions,
    )!;
    expect(unknownGeometry.sourceNeedsCurve).toBe(true);
    expect(unknownGeometry.targetNeedsCurve).toBe(false);
    expect(forward.positions.get("reported-bundle-upper")?.y).toBeCloseTo(
      443.24,
    );
    expect(forward.positions.get("reported-bundle-lower")?.y).toBeCloseTo(
      632.64,
    );
    expect(forward.positions.get("reported-bundle-unknown")?.y).toBeCloseTo(
      822.04,
    );
    expect(
      forward.positions.get("reported-bundle-lower")!.y -
        forward.positions.get("reported-bundle-upper")!.y,
    ).toBeCloseTo(189.4);
    expect(
      forward.positions.get("reported-bundle-lower")!.y -
        forward.positions.get("reported-bundle-upper")!.y -
        NODE_HEIGHT,
    ).toBeCloseTo(113.4);
    expect(
      forward.positions.get("reported-bundle-unknown")!.y -
        forward.positions.get("reported-bundle-lower")!.y -
        NODE_HEIGHT,
    ).toBeCloseTo(113.4);
    expect(routeY(byIndex.get(8)!)).toBeCloseTo(470.6);
    expect(routeY(byIndex.get(5)!)).toBeCloseTo(526.6);
    expect(routeY(byIndex.get(11)!)).toBeCloseTo(660);
    expect(routeY(byIndex.get(10)!)).toBeCloseTo(716);
    expect(routeY(byIndex.get(null)!)).toBeCloseTo(849.4);
    [byIndex.get(8)!, byIndex.get(null)!].forEach((edge) => {
      const targetNode = forward.nodes.find(
        (node) => node.id === edge.target,
      )!;
      const renderedPort = targetNode.data.ports.find(
        (port) => port.id === edge.targetHandle,
      )!;
      expect(renderedPort.ratio).toBeCloseTo(
        edge.data!.targetPortRatio,
      );
    });
    forward.edges.forEach((edge) => {
      const route = edgeHorizontalRoute(edge, forward.positions)!;
      expect({
        sourceNeedsCurve: route.sourceNeedsCurve,
        targetNeedsCurve: route.targetNeedsCurve,
        sourceCurveMode: edge.data!.sourceCurveMode,
        targetCurveMode: edge.data!.targetCurveMode,
      }).toEqual(preCompactionProfiles.get(edge.id));
    });

    const geometries = new Map(
      forward.edges.map((edge) => [
        edge,
        edgeHorizontalRoute(edge, forward.positions)!,
      ]),
    );
    const labels = new Map(
      forward.edges.map((edge) => {
        const route = geometries.get(edge)!;
        return [
          edge,
          edgeLabelGeometry({
            label: edge.data!.label,
            horizontalStartX: route.horizontalStartX,
            horizontalEndX: route.horizontalEndX,
            routeY: routeY(edge),
            labelBias: edge.data!.labelBias,
          }),
        ];
      }),
    );

    forward.edges.forEach((edge, index) => {
      expect(edgeNodeCollisions(edge, forward.positions)).toEqual([]);
      const geometry = geometries.get(edge)!;
      const label = labels.get(edge)!;
      forward.positions.forEach((position) => {
        expect(
          rectsIntersect(label.rect, {
            x: position.x - NODE_ROUTE_CLEARANCE,
            y: position.y - NODE_ROUTE_CLEARANCE,
            width: NODE_WIDTH + NODE_ROUTE_CLEARANCE * 2,
            height: NODE_HEIGHT + NODE_ROUTE_CLEARANCE * 2,
          }),
        ).toBe(false);
      });

      forward.edges.slice(index + 1).forEach((other) => {
        const otherGeometry = geometries.get(other)!;
        const otherLabel = labels.get(other)!;
        const allowedSharedPoints = [
          {
            aNode: edge.source,
            aHandle: edge.sourceHandle,
            aPoint: geometry.segments[0].from,
          },
          {
            aNode: edge.target,
            aHandle: edge.targetHandle,
            aPoint: geometry.segments.at(-1)!.to,
          },
        ].flatMap((endpoint) =>
          [
            {
              node: other.source,
              handle: other.sourceHandle,
              point: otherGeometry.segments[0].from,
            },
            {
              node: other.target,
              handle: other.targetHandle,
              point: otherGeometry.segments.at(-1)!.to,
            },
          ].flatMap((otherEndpoint) =>
            endpoint.aNode === otherEndpoint.node &&
            endpoint.aHandle === otherEndpoint.handle
              ? [endpoint.aPoint]
              : [],
          ),
        );

        expect(
          pathsIntersect(
            geometry.segments,
            otherGeometry.segments,
            allowedSharedPoints,
          ),
          `${edge.id} crosses ${other.id}`,
        ).toBe(false);
        expect(rectsIntersect(label.rect, otherLabel.rect)).toBe(false);
        expect(
          pathIntersectsRect(geometry.segments, otherLabel.rect),
        ).toBe(false);
        expect(
          pathIntersectsRect(otherGeometry.segments, label.rect),
        ).toBe(false);
        expect(
          horizontalRoutesConflict(edge, other, forward.positions),
        ).toBe(false);
      });
    });

    const hub = forward.nodes.find((node) => node.id === forward.hub)!;
    const dynamicPorts = hub.data.ports.filter((port) =>
      port.id.startsWith("dynamic:"),
    );
    expect(dynamicPorts).toHaveLength(5);
    forward.edges.forEach((edge) => {
      const port = hub.data.ports.find(
        (candidate) =>
          candidate.id ===
          (edge.source === forward.hub
            ? edge.sourceHandle
            : edge.targetHandle),
      );
      expect(port?.ratio).toBe(
        edge.source === forward.hub
          ? edge.data?.sourcePortRatio
          : edge.data?.targetPortRatio,
      );
    });

    pairs.forEach(([forwardIndex, reverseIndex]) => {
      const pairEdges = [
        byIndex.get(forwardIndex)!,
        byIndex.get(reverseIndex)!,
      ];
      const currentCurveCount = pairEdges.reduce((count, edge) => {
        const route = edgeHorizontalRoute(edge, forward.positions)!;
        return (
          count +
          Number(route.sourceNeedsCurve) +
          Number(route.targetNeedsCurve)
        );
      }, 0);
      const baselineCurveCount = pairEdges.reduce(
        (count, edge) => count + baselineCurveCounts.get(edge.id)!,
        0,
      );
      expect(currentCurveCount).toBeLessThanOrEqual(
        baselineCurveCount + 1,
      );
    });

    const reverseById = new Map(
      reverse.edges.map((edge) => [edge.id, edge]),
    );
    forward.edges.forEach((edge) => {
      const reversed = reverseById.get(edge.id)!;
      expect(routeY(reversed)).toBe(routeY(edge));
      expect(reversed.sourceHandle).toBe(edge.sourceHandle);
      expect(reversed.targetHandle).toBe(edge.targetHandle);
      expect(reversed.data?.sourcePortRatio).toBe(
        edge.data?.sourcePortRatio,
      );
      expect(reversed.data?.targetPortRatio).toBe(
        edge.data?.targetPortRatio,
      );
    });
    forward.positions.forEach((position, nodeId) => {
      expect(reverse.positions.get(nodeId)).toEqual(position);
    });
  });

  it("matches the reported disconnected transaction spacing and centered component layout", () => {
    const topology = reportedReciprocalBundleTopology();
    const sender = "reported-bundle-sender";
    const upperMiddle = "reported-bundle-upper-middle";
    const upperRight = "reported-bundle-upper-right";
    topology.positions.set(sender, { x: 12, y: 622 });
    topology.positions.set(upperMiddle, { x: 2136, y: 12 });
    topology.positions.set(upperRight, { x: 2844, y: 12 });
    topology.nodes.push(
      flowNode(sender, topology.positions.get(sender)!),
      flowNode(upperMiddle, topology.positions.get(upperMiddle)!),
      flowNode(upperRight, topology.positions.get(upperRight)!),
    );
    topology.edges.push(
      flowEdge(
        "reported-bundle-initial",
        sender,
        topology.hub,
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "reported-bundle-upper-left-edge",
        "reported-bundle-column-context",
        upperMiddle,
        "out-right",
        "in-left",
        [3],
      ),
      flowEdge(
        "reported-bundle-upper-right-edge",
        upperMiddle,
        upperRight,
        "out-right",
        "in-left",
        [6],
      ),
    );

    applyReportedReciprocalSpacing(topology);
    expect(
      alignDisconnectedComponents(
        topology.edges,
        topology.positions,
        sender,
      ),
    ).toBe(true);

    expect(
      topology.positions.get("reported-bundle-column-context"),
    ).toEqual({ x: 12, y: 12 });
    expect(topology.positions.get(upperMiddle)).toEqual({
      x: 720,
      y: 12,
    });
    expect(topology.positions.get(upperRight)).toEqual({
      x: 1428,
      y: 12,
    });
    expect(
      topology.positions.get("reported-bundle-upper")?.y,
    ).toBeCloseTo(443.24);
    expect(
      topology.positions.get("reported-bundle-lower")?.y,
    ).toBeCloseTo(632.64);
    expect(
      topology.positions.get("reported-bundle-unknown")?.y,
    ).toBeCloseTo(822.04);

    const byIndex = new Map(
      topology.edges.flatMap((edge) =>
        edge.data!.displayIndexes.map((index) => [index, edge] as const),
      ),
    );
    expect(routeY(byIndex.get(8)!)).toBeCloseTo(470.6);
    expect(routeY(byIndex.get(5)!)).toBeCloseTo(526.6);
    expect(routeY(byIndex.get(11)!)).toBeCloseTo(660);
    expect(routeY(byIndex.get(10)!)).toBeCloseTo(716);
    expect(routeY(byIndex.get(null)!)).toBeCloseTo(849.4);
    const transfer11 = edgeHorizontalRoute(
      byIndex.get(11)!,
      topology.positions,
    )!;
    const transfer8 = edgeHorizontalRoute(
      byIndex.get(8)!,
      topology.positions,
    )!;
    const unknown = edgeHorizontalRoute(
      byIndex.get(null)!,
      topology.positions,
    )!;
    expect(transfer11.sourceNeedsCurve).toBe(false);
    expect(transfer11.targetNeedsCurve).toBe(false);
    expect(transfer8.targetNeedsCurve).toBe(false);
    expect(unknown.targetNeedsCurve).toBe(false);
    topology.edges.forEach((edge, index) => {
      expect(edgeNodeCollisions(edge, topology.positions)).toEqual([]);
      topology.edges.slice(index + 1).forEach((other) => {
        expect(
          horizontalRoutesConflict(edge, other, topology.positions),
        ).toBe(false);
      });
    });
  }, 15_000);

  it("scales clear column spacing from 5x for sparse columns to 1.3x for dense columns", () => {
    expect(adaptiveColumnClearGap(2)).toBeCloseTo(180);
    expect(adaptiveColumnClearGap(3)).toBeCloseTo(113.4);
    expect(adaptiveColumnClearGap(4)).toBeCloseTo(46.8);
    expect(adaptiveColumnClearGap(12)).toBeCloseTo(46.8);
  });

  it("chooses a deterministic straight anchor for a disconnected pair", () => {
    const makeTopology = (reverse = false) => {
      const primary = "anchor-primary";
      const sourceTop = "anchor-source-top";
      const sourceBottom = "anchor-source-bottom";
      const pairTop = "anchor-a";
      const pairBottom = "anchor-b";
      const positions = new Map([
        [primary, { x: 2500, y: 1000 }],
        [sourceTop, { x: 0, y: 0 }],
        [sourceBottom, { x: 708, y: 300 }],
        [pairTop, { x: 1416, y: 0 }],
        [pairBottom, { x: 1416, y: 300 }],
      ]);
      const edges = [
        flowEdge(
          "anchor-bridge",
          sourceTop,
          sourceBottom,
          "out-right",
          "in-left",
          [0],
        ),
        flowEdge(
          "anchor-top-edge",
          sourceTop,
          pairTop,
          "out-right",
          "in-left",
          [1],
        ),
        flowEdge(
          "anchor-bottom-edge",
          sourceBottom,
          pairBottom,
          "out-right",
          "in-left",
          [2],
        ),
      ];
      if (reverse) edges.reverse();
      assignRouteLanes(edges, positions);
      return {
        primary,
        pairTop,
        pairBottom,
        positions,
        edges,
      };
    };
    const forward = makeTopology();
    const reverse = makeTopology(true);

    expect(
      equalizeComponentColumnSpacing(
        forward.edges,
        forward.positions,
        forward.primary,
      ),
    ).toBe(true);
    expect(
      equalizeComponentColumnSpacing(
        reverse.edges,
        reverse.positions,
        reverse.primary,
      ),
    ).toBe(true);
    expect(forward.positions).toEqual(reverse.positions);
    expect(forward.positions.get(forward.pairTop)?.y).toBe(0);
    expect(
      forward.positions.get(forward.pairBottom)!.y -
        forward.positions.get(forward.pairTop)!.y,
    ).toBeCloseTo(
      NODE_HEIGHT + adaptiveColumnClearGap(4),
    );
    expect(
      edgeHorizontalRoute(
        forward.edges.find(
          (edge) => edge.id === "anchor-top-edge",
        )!,
        forward.positions,
      )?.sourceNeedsCurve,
    ).toBe(false);
    expect(
      edgeHorizontalRoute(
        forward.edges.find(
          (edge) => edge.id === "anchor-top-edge",
        )!,
        forward.positions,
      )?.targetNeedsCurve,
    ).toBe(false);
  });

  it("leaves an anchored disconnected pair unchanged when compaction is unsafe", () => {
    const primary = "unsafe-anchor-blocker";
    const source = "unsafe-anchor-source";
    const pairTop = "unsafe-anchor-top";
    const pairBottom = "unsafe-anchor-bottom";
    const positions = new Map([
      [primary, { x: 708, y: 140 }],
      [source, { x: 0, y: 0 }],
      [pairTop, { x: 708, y: 0 }],
      [pairBottom, { x: 708, y: 535 }],
    ]);
    const edges = [
      flowEdge(
        "unsafe-anchor-straight",
        source,
        pairTop,
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "unsafe-anchor-lower",
        source,
        pairBottom,
        "out-right",
        "in-left",
        [2],
      ),
    ];
    assignRouteLanes(edges, positions);
    const positionBaseline = new Map(
      [...positions.entries()].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );
    const routeBaseline = new Map(
      edges.map((edge) => [edge.id, routeY(edge)]),
    );

    expect(
      equalizeComponentColumnSpacing(edges, positions, primary),
    ).toBe(false);
    expect(positions).toEqual(positionBaseline);
    edges.forEach((edge) => {
      expect(routeY(edge)).toBe(routeBaseline.get(edge.id));
    });
  });

  it("retains centered compaction for a disconnected pair without a straight anchor", () => {
    const primary = "center-fallback-primary";
    const source = "center-fallback-source";
    const pairTop = "center-fallback-top";
    const pairBottom = "center-fallback-bottom";
    const positions = new Map([
      [primary, { x: 2000, y: 1000 }],
      [source, { x: 0, y: 200 }],
      [pairTop, { x: 708, y: 0 }],
      [pairBottom, { x: 708, y: 535 }],
    ]);
    const edges = [
      flowEdge(
        "center-fallback-upper",
        source,
        pairTop,
        "out-right",
        "in-left",
        [1],
      ),
      flowEdge(
        "center-fallback-lower",
        source,
        pairBottom,
        "out-right",
        "in-left",
        [2],
      ),
    ];
    assignRouteLanes(edges, positions);
    const pairCenter =
      (positions.get(pairTop)!.y + positions.get(pairBottom)!.y) / 2;

    expect(
      equalizeComponentColumnSpacing(edges, positions, primary),
    ).toBe(true);
    expect(
      (positions.get(pairTop)!.y + positions.get(pairBottom)!.y) / 2,
    ).toBeCloseTo(pairCenter);
    expect(
      positions.get(pairBottom)!.y - positions.get(pairTop)!.y,
    ).toBeCloseTo(
      NODE_HEIGHT + adaptiveColumnClearGap(4),
    );
    expect(routingIsCollisionFree(edges, positions)).toBe(true);
  });

  it("keeps component-local spacing unchanged when an unrelated column component is added or removed", () => {
    const withUnrelatedComponent = reportedReciprocalBundleTopology();
    const unrelatedSource = "reported-bundle-unrelated-source";
    const unrelatedLeaf = "reported-bundle-column-context";
    withUnrelatedComponent.positions.set(unrelatedSource, {
      x: 720,
      y: 12,
    });
    withUnrelatedComponent.nodes.push(
      flowNode(
        unrelatedSource,
        withUnrelatedComponent.positions.get(unrelatedSource)!,
      ),
    );
    withUnrelatedComponent.edges.push(
      flowEdge(
        "reported-bundle-unrelated-edge",
        unrelatedSource,
        unrelatedLeaf,
        "out-right",
        "in-left",
        [3],
      ),
    );

    const withoutUnrelatedComponent =
      reportedReciprocalBundleTopology();
    withoutUnrelatedComponent.positions.delete(unrelatedLeaf);
    withoutUnrelatedComponent.nodes =
      withoutUnrelatedComponent.nodes.filter(
        (node) => node.id !== unrelatedLeaf,
      );
    withoutUnrelatedComponent.edges.reverse();

    applyReportedReciprocalSpacing(withUnrelatedComponent);
    applyReportedReciprocalSpacing(withoutUnrelatedComponent);

    expect(
      withUnrelatedComponent.positions.get(unrelatedSource)?.y,
    ).toBe(12);
    expect(
      withUnrelatedComponent.positions.get(unrelatedLeaf)?.y,
    ).toBe(12);
    [
      "reported-bundle-upper",
      "reported-bundle-lower",
      "reported-bundle-unknown",
    ].forEach((nodeId) => {
      expect(
        withUnrelatedComponent.positions.get(nodeId),
      ).toEqual(withoutUnrelatedComponent.positions.get(nodeId));
    });

    const withoutById = new Map(
      withoutUnrelatedComponent.edges.map((edge) => [edge.id, edge]),
    );
    withUnrelatedComponent.edges
      .filter((edge) => edge.id !== "reported-bundle-unrelated-edge")
      .forEach((edge) => {
        const withoutEdge = withoutById.get(edge.id)!;
        expect(routeY(edge)).toBe(routeY(withoutEdge));
        expect(edge.data?.sourcePortRatio).toBe(
          withoutEdge.data?.sourcePortRatio,
        );
        expect(edge.data?.targetPortRatio).toBe(
          withoutEdge.data?.targetPortRatio,
        );
      });
  }, 15_000);

  it(
    "expands a safe sparse two-address column up to the 5x cap",
    () => {
      const topology = sparseAdaptiveSpacingTopology();
      assignRouteLanes(topology.edges, topology.positions);
      const baselineProfiles = new Map(
        topology.edges.map((edge) => [
          edge.id,
          edgeHorizontalRoute(edge, topology.positions),
        ]),
      );

      expect(
        compactDynamicReciprocalColumnGaps(
          topology.edges,
          topology.positions,
        ),
      ).toBe(true);
      expect(
        topology.positions.get(topology.lower)!.y -
          topology.positions.get(topology.upper)!.y,
      ).toBeCloseTo(NODE_HEIGHT + 180);
      topology.edges.forEach((edge) => {
        const baseline = baselineProfiles.get(edge.id)!;
        const final = edgeHorizontalRoute(edge, topology.positions)!;
        expect(final.sourceNeedsCurve).toBe(
          baseline!.sourceNeedsCurve,
        );
        expect(final.targetNeedsCurve).toBe(
          baseline!.targetNeedsCurve,
        );
      });
      expect(
        compactDynamicReciprocalColumnGaps(
          topology.edges,
          topology.positions,
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "uses the largest safe component-local gap when unrelated obstacles block the target",
    () => {
      const topology = sparseAdaptiveSpacingTopology();
      const upperObstacle = "adaptive-spacing-upper-obstacle";
      const lowerObstacle = "adaptive-spacing-lower-obstacle";
      topology.positions.set(upperObstacle, { x: 999, y: -130 });
      topology.positions.set(lowerObstacle, { x: 999, y: 242 });
      assignRouteLanes(topology.edges, topology.positions);
      const baselineProfiles = new Map(
        topology.edges.map((edge) => {
          const route = edgeHorizontalRoute(edge, topology.positions)!;
          return [
            edge.id,
            {
              sourceNeedsCurve: route.sourceNeedsCurve,
              targetNeedsCurve: route.targetNeedsCurve,
              sourceCurveMode: edge.data!.sourceCurveMode,
              targetCurveMode: edge.data!.targetCurveMode,
            },
          ];
        }),
      );

      expect(
        compactDynamicReciprocalColumnGaps(
          topology.edges,
          topology.positions,
        ),
      ).toBe(true);
      expect(topology.positions.get(upperObstacle)?.y).toBe(-130);
      expect(topology.positions.get(lowerObstacle)?.y).toBe(242);
      expect(
        topology.positions.get(topology.lower)!.y -
          topology.positions.get(topology.upper)!.y -
          NODE_HEIGHT,
      ).toBeCloseTo(96);
      expect(
        adaptiveColumnClearGap(2),
      ).toBeGreaterThan(96);
      topology.edges.forEach((edge) => {
        const route = edgeHorizontalRoute(edge, topology.positions)!;
        expect({
          sourceNeedsCurve: route.sourceNeedsCurve,
          targetNeedsCurve: route.targetNeedsCurve,
          sourceCurveMode: edge.data!.sourceCurveMode,
          targetCurveMode: edge.data!.targetCurveMode,
        }).toEqual(baselineProfiles.get(edge.id));
        expect(edgeNodeCollisions(edge, topology.positions)).toEqual([]);
      });
      expect(
        compactDynamicReciprocalColumnGaps(
          topology.edges,
          topology.positions,
        ),
      ).toBe(false);
    },
    15_000,
  );

  it("does not align a reciprocal suffix by curving an unrelated straight route", () => {
    const topology = reportedReciprocalBundleTopology();
    const foreignHub = "foreign-straight-hub";
    const foreignLeaf = "foreign-straight-leaf";
    topology.positions.set(foreignHub, { x: 0, y: 800 });
    topology.positions.set(foreignLeaf, { x: 1428, y: 800 });
    topology.nodes.push(
      flowNode(foreignHub, topology.positions.get(foreignHub)!),
      flowNode(foreignLeaf, topology.positions.get(foreignLeaf)!),
    );
    const foreignEdge = flowEdge(
      "foreign-straight",
      foreignHub,
      foreignLeaf,
      "out-right",
      "in-left",
      [20],
    );
    topology.edges.push(foreignEdge);

    assignRouteLanes(topology.edges, topology.positions);
    expect(
      assignReciprocalBundlePorts(
        topology.nodes,
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    const baselinePositions = new Map(
      [...topology.positions.entries()].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );
    const baselineForeignGeometry = edgeHorizontalRoute(
      foreignEdge,
      topology.positions,
    )!;
    expect(baselineForeignGeometry.sourceNeedsCurve).toBe(false);
    expect(baselineForeignGeometry.targetNeedsCurve).toBe(false);

    expect(
      alignDynamicReciprocalLeafColumns(
        topology.edges,
        topology.positions,
      ),
    ).toBe(false);
    expect(topology.positions).toEqual(baselinePositions);
    const finalForeignGeometry = edgeHorizontalRoute(
      foreignEdge,
      topology.positions,
    )!;
    expect(finalForeignGeometry.sourceNeedsCurve).toBe(false);
    expect(finalForeignGeometry.targetNeedsCurve).toBe(false);
  });

  it("does not drag an unrelated nearby address with the component block", () => {
    const topology = reportedReciprocalBundleTopology();
    const companion = "reported-bundle-upper-companion";
    topology.positions.set(companion, { x: 1428, y: 144 });
    topology.nodes.push(
      flowNode(companion, topology.positions.get(companion)!),
    );

    assignRouteLanes(topology.edges, topology.positions);
    expect(
      assignReciprocalBundlePorts(
        topology.nodes,
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    expect(
      alignDynamicReciprocalLeafColumns(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    const companionY = topology.positions.get(companion)!.y;
    const upperY = topology.positions.get("reported-bundle-upper")!.y;

    expect(
      compactDynamicReciprocalColumnGaps(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    const companionShift =
      topology.positions.get(companion)!.y - companionY;
    const upperShift =
      topology.positions.get("reported-bundle-upper")!.y - upperY;
    expect(companionShift).toBe(0);
    expect(upperShift).not.toBe(0);
    expect(topology.positions.get(companion)!.y).toBe(144);
    expect(
      topology.positions.get("reported-bundle-lower")!.y -
        topology.positions.get("reported-bundle-upper")!.y,
    ).toBeCloseTo(189.4);
  });

  it("does not merge a distant upper column group into the compacted block", () => {
    const topology = reportedReciprocalBundleTopology();
    const distantSource = "reported-bundle-distant-source";
    const distantLeaf = "reported-bundle-column-context";
    topology.positions.set(distantSource, { x: 720, y: 12 });
    topology.nodes.push(
      flowNode(distantSource, topology.positions.get(distantSource)!),
    );
    topology.edges.push(
      flowEdge(
        "reported-bundle-distant-straight",
        distantSource,
        distantLeaf,
        "out-right",
        "in-left",
        [3],
      ),
    );

    assignRouteLanes(topology.edges, topology.positions);
    expect(
      assignReciprocalBundlePorts(
        topology.nodes,
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    expect(
      alignDynamicReciprocalLeafColumns(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);

    expect(
      compactDynamicReciprocalColumnGaps(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    expect(topology.positions.get(distantSource)?.y).toBeCloseTo(12);
    expect(topology.positions.get(distantLeaf)?.y).toBeCloseTo(12);
    expect(
      topology.positions.get("reported-bundle-upper")?.y,
    ).toBeCloseTo(443.24);
    expect(
      topology.positions.get("reported-bundle-lower")!.y -
        topology.positions.get("reported-bundle-upper")!.y,
    ).toBeCloseTo(189.4);
  });

  it("keeps a protected straight group fixed while spacing other peers", () => {
    const topology = reportedReciprocalBundleTopology();
    const foreignHub = "compaction-foreign-hub";
    const foreignLeaf = "compaction-foreign-leaf";
    topology.positions.set(foreignHub, { x: 0, y: 144 });
    topology.positions.set(foreignLeaf, { x: 1428, y: 144 });
    topology.nodes.push(
      flowNode(foreignHub, topology.positions.get(foreignHub)!),
      flowNode(foreignLeaf, topology.positions.get(foreignLeaf)!),
    );
    topology.edges.push(
      flowEdge(
        "compaction-foreign-straight",
        foreignHub,
        foreignLeaf,
        "out-right",
        "in-left",
        [20],
      ),
    );

    assignRouteLanes(topology.edges, topology.positions);
    expect(
      assignReciprocalBundlePorts(
        topology.nodes,
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    expect(
      alignDynamicReciprocalLeafColumns(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    assignRouteLanes(topology.edges, topology.positions);
    const baselinePositions = new Map(
      [...topology.positions.entries()].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );

    expect(
      compactDynamicReciprocalColumnGaps(
        topology.edges,
        topology.positions,
      ),
    ).toBe(true);
    expect(topology.positions.get(foreignHub)).toEqual(
      baselinePositions.get(foreignHub),
    );
    expect(topology.positions.get(foreignLeaf)).toEqual(
      baselinePositions.get(foreignLeaf),
    );
    const finalForeignGeometry = edgeHorizontalRoute(
      topology.edges.find(
        (edge) => edge.id === "compaction-foreign-straight",
      )!,
      topology.positions,
    )!;
    expect(finalForeignGeometry.sourceNeedsCurve).toBe(false);
    expect(finalForeignGeometry.targetNeedsCurve).toBe(false);
  });

  it("leaves columns unchanged when reciprocal edges do not use dynamic ports", () => {
    const { edges, positions } = reportedReciprocalBundleTopology();
    assignRouteLanes(edges, positions);
    const baselinePositions = new Map(
      [...positions.entries()].map(([nodeId, position]) => [
        nodeId,
        { ...position },
      ]),
    );

    expect(
      alignDynamicReciprocalLeafColumns(edges, positions),
    ).toBe(false);
    expect(positions).toEqual(baselinePositions);
  });

  it.each([2, 3, 4, 5, 6])(
    "keeps %i reciprocal leaf bundles contiguous",
    (pairCount) => {
      const { nodes, edges, positions } =
        reciprocalBundleTopology(pairCount);
      assignRouteLanes(edges, positions);
      expect(
        assignReciprocalBundlePorts(nodes, edges, positions),
      ).toBe(true);
      assignRouteLanes(edges, positions);

      for (let index = 0; index < pairCount; index += 1) {
        const forward = edges.find(
          (edge) => edge.id === `bundle-forward-${index}`,
        )!;
        const reverse = edges.find(
          (edge) => edge.id === `bundle-reverse-${index}`,
        )!;
        expect(routeY(reverse) - routeY(forward)).toBeCloseTo(
          MIN_HORIZONTAL_LANE_GAP,
        );
      }
    },
    15_000,
  );

  it("keeps the established ports for hubs denser than six bundles", () => {
    const { nodes, edges, positions } = reciprocalBundleTopology(7);
    edges.forEach((edge, index) => {
      edge.data!.routeY =
        index % 2 === 0 ? index * MIN_HORIZONTAL_LANE_GAP : 1200 + index;
    });

    expect(
      assignReciprocalBundlePorts(nodes, edges, positions),
    ).toBe(false);
    expect(
      assignMixedDirectionFanoutPorts(nodes, edges, positions),
    ).toBe(false);
    nodes.forEach((node) => {
      expect(
        node.data.ports.some((port) => port.id.startsWith("dynamic:")),
      ).toBe(false);
    });
  });

  it("does not compact reciprocal routes through an intermediate address box", () => {
    const left = "blocked-left";
    const blocker = "blocked-middle";
    const right = "blocked-right";
    const positions = new Map([
      [left, { x: 0, y: 200 }],
      [blocker, { x: 720, y: 200 }],
      [right, { x: 1440, y: 200 }],
    ]);
    const edges = [
      flowEdge("blocked-forward", left, right, "out-right", "in-left", [1]),
      flowEdge("blocked-reverse", right, left, "out-left", "in-right", [2]),
    ];
    const reversedEdges = cloneEdges(edges).reverse();

    assignRouteLanes(edges, positions);
    assignRouteLanes(reversedEdges, positions);

    expect(Math.abs(routeY(edges[0]) - routeY(edges[1]))).toBeGreaterThan(
      MIN_HORIZONTAL_LANE_GAP + NODE_ROUTE_CLEARANCE,
    );
    edges.forEach((edge) => {
      expect(edgeNodeCollisions(edge, positions)).toEqual([]);
    });
    expect(horizontalRoutesConflict(edges[0], edges[1], positions)).toBe(false);

    const reversedRoutes = new Map(
      reversedEdges.map((edge) => [edge.id, routeY(edge)]),
    );
    edges.forEach((edge) => {
      expect(routeY(edge)).toBe(reversedRoutes.get(edge.id));
    });
  });

  it.each(Array.from({ length: 11 }, (_, index) => index + 2))(
    "keeps %i fan-out routes separated while preserving a straight route",
    (edgeCount) => {
      const hub = "hub";
      const positions = new Map<string, { x: number; y: number }>([
        [hub, { x: 0, y: 0 }],
      ]);
      const edges = Array.from({ length: edgeCount }, (_, index) => {
        const target = `target-${index}`;
        positions.set(target, { x: 720, y: index * 112 });
        return flowEdge(
          `fanout-${index}`,
          hub,
          target,
          "out-right",
          "in-left",
          [index + 1],
        );
      });
      const reversedEdges = cloneEdges(edges).reverse();

      assignRouteLanes(edges, positions);
      assignRouteLanes(reversedEdges, positions);

      const firstPortY = portPoint(positions.get(hub)!, "out-right").y;
      expect(routeY(edges[0])).toBe(firstPortY);
      edges.slice(1).forEach((edge, index) => {
        expect(routeY(edges[index])).toBeLessThan(routeY(edge));
      });
      edges.forEach((edge, index) => {
        edges.slice(index + 1).forEach((other) => {
          expect(
            horizontalRoutesConflict(edge, other, positions),
            `${edge.id} conflicts with ${other.id}`,
          ).toBe(false);
        });
      });
      const reversedRoutes = new Map(reversedEdges.map((edge) => [edge.id, routeY(edge)]));
      edges.forEach((edge) => {
        expect(routeY(edge)).toBe(reversedRoutes.get(edge.id));
      });
    },
  );

  it.each(Array.from({ length: 11 }, (_, index) => index + 2))(
    "keeps physical port order for %i reciprocal routes",
    (edgeCount) => {
      const left = "left";
      const right = "right";
      const positions = new Map([
        [left, { x: 0, y: 160 }],
        [right, { x: 720, y: 160 }],
      ]);
      const edges = Array.from({ length: edgeCount }, (_, index) => {
        const forward = index % 2 === 0;
        return forward
          ? flowEdge(`reciprocal-${index}`, left, right, "out-right", "in-left", [index + 1])
          : flowEdge(`reciprocal-${index}`, right, left, "out-left", "in-right", [index + 1]);
      });
      const reversedEdges = cloneEdges(edges).reverse();

      assignRouteLanes(edges, positions);
      assignRouteLanes(reversedEdges, positions);

      const upperRoutes = edges.filter((_, index) => index % 2 === 0).map(routeY);
      const lowerRoutes = edges.filter((_, index) => index % 2 === 1).map(routeY);
      expect(Math.max(...upperRoutes)).toBeLessThan(Math.min(...lowerRoutes));
      expect(
        edges.some((edge) => {
          const route = edgeHorizontalRoute(edge, positions);
          return route && !route.sourceNeedsCurve && !route.targetNeedsCurve;
        }),
      ).toBe(true);
      edges.forEach((edge, index) => {
        edges.slice(index + 1).forEach((other) => {
          expect(
            horizontalRoutesConflict(edge, other, positions),
            `${edge.id} conflicts with ${other.id}`,
          ).toBe(false);
        });
      });
      const reversedRoutes = new Map(reversedEdges.map((edge) => [edge.id, routeY(edge)]));
      edges.forEach((edge) => {
        expect(routeY(edge)).toBe(reversedRoutes.get(edge.id));
      });
    },
  );

  it(
    "keeps the reported dcc9 component uniform, direct, compact, aligned, and collision-free",
    async () => {
      const forwardTrace = reportedDcc9Trace();
      const reverseTrace = reportedDcc9Trace();
      reverseTrace.edges.reverse();
      const [forward, reverse] = await Promise.all([
        layoutTrace(forwardTrace),
        layoutTrace(reverseTrace),
      ]);
      const positions = new Map(
        forward.nodes.map((layoutNode) => [
          layoutNode.id,
          layoutNode.position,
        ]),
      );
      const reversePositions = new Map(
        reverse.nodes.map((layoutNode) => [
          layoutNode.id,
          layoutNode.position,
        ]),
      );
      const a = REPORTED_DCC9_ADDRESSES;
      const mainRightColumn = [
        a.cd71db,
        a.c02ab1,
        a.f1445,
        a.f04c,
        a.e08a90,
        a.weth,
        a.ad5f97,
      ]
        .map((nodeId) => positions.get(nodeId)!)
        .sort((left, right) => left.y - right.y);
      const gaps = mainRightColumn.slice(1).map(
        (position, index) =>
          position.y - mainRightColumn[index].y,
      );
      gaps.forEach((gap) => expect(gap).toBeCloseTo(gaps[0]));
      expect(
        positions.get(a.disconnectedLeaf)!.y -
          positions.get(a.zero)!.y,
      ).toBeCloseTo(
        NODE_HEIGHT + adaptiveColumnClearGap(4),
      );
      expect(
        positions.get(a.disconnectedSource)?.x,
      ).not.toBe(positions.get(a.cd71db)?.x);
      expect(
        mainRightColumn.some(
          (position) =>
            position.y === positions.get(a.disconnectedSource)?.y,
        ),
      ).toBe(false);

      const byIndex = new Map(
        forward.edges.flatMap((edge) =>
          edge.data!.displayIndexes.map(
            (index) => [index, edge] as const,
          ),
        ),
      );
      expect(
        positions.get(a.disconnectedSource)!.y,
      ).toBeCloseTo(positions.get(a.zero)!.y);
      const routeAtPeerIsStraight = (
        edge: TransferFlowEdge,
        peerId: string,
      ) => {
        const geometry = edgeHorizontalRoute(edge, positions)!;
        const portY =
          edge.source === peerId
            ? geometry.segments[0].from.y
            : geometry.segments.at(-1)!.to.y;
        return Math.abs(edge.data!.routeY - portY) < 1;
      };
      const transfer3Geometry = edgeHorizontalRoute(
        byIndex.get(3)!,
        positions,
      )!;
      expect(transfer3Geometry.sourceNeedsCurve).toBe(false);
      expect(transfer3Geometry.targetNeedsCurve).toBe(false);
      expect(byIndex.get(3)!.data!.routeY).toBeCloseTo(
        transfer3Geometry.segments[0].from.y,
      );
      expect(byIndex.get(3)!.data!.routeY).toBeCloseTo(
        transfer3Geometry.segments.at(-1)!.to.y,
      );
      const transfer4Geometry = edgeHorizontalRoute(
        byIndex.get(4)!,
        positions,
      )!;
      expect(transfer4Geometry.sourceNeedsCurve).toBe(true);
      expect(transfer4Geometry.targetNeedsCurve).toBe(true);
      const transfer6Geometry = edgeHorizontalRoute(
        byIndex.get(6)!,
        positions,
      )!;
      expect(transfer6Geometry.sourceNeedsCurve).toBe(true);
      expect(transfer6Geometry.targetNeedsCurve).toBe(false);
      expect(byIndex.get(6)!.data!.routeY).toBeCloseTo(
        transfer6Geometry.segments.at(-1)!.to.y,
      );
      [
        [a.e08a90, [byIndex.get(10)!, byIndex.get(11)!]],
        [a.weth, [byIndex.get(15)!, byIndex.get(16)!]],
        [
          a.ad5f97,
          forward.edges.filter(
            (edge) =>
              edge.source === a.ad5f97 ||
              edge.target === a.ad5f97,
          ),
        ],
      ].forEach(([peerId, peerEdges]) => {
        expect(
          (peerEdges as TransferFlowEdge[]).some((edge) =>
            routeAtPeerIsStraight(edge, peerId as string)
          ),
        ).toBe(true);
      });
      expect(
        Math.abs(
          byIndex.get(10)!.data!.routeY -
            byIndex.get(11)!.data!.routeY,
        ),
      ).toBeCloseTo(MIN_HORIZONTAL_LANE_GAP);
      expect(
        Math.abs(
          byIndex.get(15)!.data!.routeY -
            byIndex.get(16)!.data!.routeY,
        ),
      ).toBeCloseTo(MIN_HORIZONTAL_LANE_GAP);
      expect(
        Math.abs(
          byIndex.get(3)!.data!.routeY -
            byIndex.get(4)!.data!.routeY,
        ),
      ).toBeCloseTo(MIN_HORIZONTAL_LANE_GAP);

      const receiverX = positions.get(a.receiver)!.x;
      const rightX = positions.get(a.cd71db)!.x;
      const alignedLabelXs = forward.edges
        .filter((edge) => {
          const sourceX = positions.get(edge.source)!.x;
          const targetX = positions.get(edge.target)!.x;
          return (
            Math.min(sourceX, targetX) ===
              Math.min(receiverX, rightX) &&
            Math.max(sourceX, targetX) ===
              Math.max(receiverX, rightX)
          );
        })
        .map((edge) => {
          const route = edgeHorizontalRoute(edge, positions)!;
          return edgeLabelGeometry({
            label: edge.data!.label,
            horizontalStartX: route.horizontalStartX,
            horizontalEndX: route.horizontalEndX,
            routeY: edge.data!.routeY,
            labelBias: edge.data!.labelBias,
          }).rect.x;
        });
      alignedLabelXs.forEach((labelX) =>
        expect(labelX).toBeCloseTo(alignedLabelXs[0])
      );
      const disconnectedLabelXs = [3, 4, 6].map((index) => {
        const edge = byIndex.get(index)!;
        const route = edgeHorizontalRoute(edge, positions)!;
        return edgeLabelGeometry({
          label: edge.data!.label,
          horizontalStartX: route.horizontalStartX,
          horizontalEndX: route.horizontalEndX,
          routeY: edge.data!.routeY,
          labelBias: edge.data!.labelBias,
        }).rect.x;
      });
      disconnectedLabelXs.forEach((labelX) =>
        expect(labelX).toBeCloseTo(disconnectedLabelXs[0])
      );
      expect(
        routingIsCollisionFree(forward.edges, positions),
      ).toBe(true);

      const receiverRightEdges = forward.edges
        .filter(
          (edge) =>
            (edge.source === a.receiver ||
              edge.target === a.receiver) &&
            positions.get(
              edge.source === a.receiver
                ? edge.target
                : edge.source,
            )!.x > receiverX,
        )
        .map((edge) => {
          const peerId =
            edge.source === a.receiver
              ? edge.target
              : edge.source;
          return {
            peerY: positions.get(peerId)!.y,
            portRatio:
              edge.source === a.receiver
                ? edge.data!.sourcePortRatio
                : edge.data!.targetPortRatio,
          };
        })
        .sort(
          (left, right) =>
            left.peerY - right.peerY ||
            left.portRatio - right.portRatio,
        );
      expect(receiverRightEdges.map(({ portRatio }) => portRatio))
        .toEqual(
          receiverRightEdges
            .map(({ portRatio }) => portRatio)
            .sort((left, right) => left - right),
        );

      expect(reversePositions).toEqual(positions);
      const reverseEdges = new Map(
        reverse.edges.map((edge) => [edge.id, edge]),
      );
      forward.edges.forEach((edge) => {
        const reversed = reverseEdges.get(edge.id)!;
        expect({
          routeY: reversed.data!.routeY,
          labelBias: reversed.data!.labelBias,
          sourceCurveMode: reversed.data!.sourceCurveMode,
          targetCurveMode: reversed.data!.targetCurveMode,
          sourcePortRatio: reversed.data!.sourcePortRatio,
          targetPortRatio: reversed.data!.targetPortRatio,
          sourceHandle: reversed.sourceHandle,
          targetHandle: reversed.targetHandle,
        }).toEqual({
          routeY: edge.data!.routeY,
          labelBias: edge.data!.labelBias,
          sourceCurveMode: edge.data!.sourceCurveMode,
          targetCurveMode: edge.data!.targetCurveMode,
          sourcePortRatio: edge.data!.sourcePortRatio,
          targetPortRatio: edge.data!.targetPortRatio,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        });
      });
      expect(
        reversePositions.get(a.disconnectedSource),
      ).toEqual(positions.get(a.disconnectedSource));
      expect(
        reversePositions.get(a.zero),
      ).toEqual(positions.get(a.zero));
      expect(
        reversePositions.get(a.disconnectedLeaf),
      ).toEqual(positions.get(a.disconnectedLeaf));

      const routingSnapshot = (edge: TransferFlowEdge) => ({
        routeY: edge.data!.routeY,
        labelBias: edge.data!.labelBias,
        sourceCurveMode: edge.data!.sourceCurveMode,
        targetCurveMode: edge.data!.targetCurveMode,
        sourcePortRatio: edge.data!.sourcePortRatio,
        targetPortRatio: edge.data!.targetPortRatio,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      const expandedPositions = new Map(
        [...positions.entries()].map(([nodeId, position]) => [
          nodeId,
          { ...position },
        ]),
      );
      const disconnectedSourceY =
        expandedPositions.get(a.disconnectedSource)!.y;
      expandedPositions.set(a.zero, {
        ...positions.get(a.zero)!,
        y: disconnectedSourceY,
      });
      expandedPositions.set(a.disconnectedLeaf, {
        ...positions.get(a.disconnectedLeaf)!,
        y: disconnectedSourceY + 535,
      });
      const expandedEdges = cloneEdges(forward.edges);
      const disconnectedNodeIds = new Set([
        a.disconnectedSource,
        a.zero,
        a.disconnectedLeaf,
      ]);
      const expandedDisconnectedEdges = expandedEdges.filter(
        (edge) =>
          disconnectedNodeIds.has(edge.source) &&
          disconnectedNodeIds.has(edge.target),
      );
      assignRouteLanes(
        expandedDisconnectedEdges,
        expandedPositions,
      );
      alignColumnPairLabels(
        expandedDisconnectedEdges,
        expandedPositions,
      );
      const expandedByIndex = new Map(
        expandedEdges.flatMap((edge) =>
          edge.data!.displayIndexes.map(
            (index) => [index, edge] as const,
          ),
        ),
      );
      const transfer3Baseline = routingSnapshot(
        expandedByIndex.get(3)!,
      );
      const transfer4Baseline = routingSnapshot(
        expandedByIndex.get(4)!,
      );
      const {
        routeY: transfer6BaselineRouteY,
        ...transfer6BaselineRouting
      } = routingSnapshot(expandedByIndex.get(6)!);
      const disconnectedSourceBaseline = {
        ...expandedPositions.get(a.disconnectedSource)!,
      };
      const anchoredZeroBaseline = {
        ...expandedPositions.get(a.zero)!,
      };
      const primaryPositionBaseline = new Map(
        [...expandedPositions.entries()]
          .filter(([nodeId]) => !disconnectedNodeIds.has(nodeId))
          .map(([nodeId, position]) => [
            nodeId,
            { ...position },
          ]),
      );
      const primaryRoutingBaseline = new Map(
        expandedEdges
          .filter(
            (edge) =>
              !disconnectedNodeIds.has(edge.source) &&
              !disconnectedNodeIds.has(edge.target),
          )
          .map((edge) => [edge.id, routingSnapshot(edge)]),
      );

      expect(
        equalizeComponentColumnSpacing(
          expandedEdges,
          expandedPositions,
          a.sender,
        ),
      ).toBe(true);
      alignDisconnectedComponents(
        expandedEdges,
        expandedPositions,
        a.sender,
      );
      expect(
        expandedPositions.get(a.disconnectedSource),
      ).toEqual(disconnectedSourceBaseline);
      expect(expandedPositions.get(a.zero)).toEqual(
        anchoredZeroBaseline,
      );
      expect(
        expandedPositions.get(a.disconnectedLeaf)!.y -
          expandedPositions.get(a.zero)!.y,
      ).toBeCloseTo(
        NODE_HEIGHT + adaptiveColumnClearGap(4),
      );
      primaryPositionBaseline.forEach((position, nodeId) => {
        expect(expandedPositions.get(nodeId)).toEqual(position);
      });
      primaryRoutingBaseline.forEach((routing, edgeId) => {
        expect(
          routingSnapshot(
            expandedEdges.find((edge) => edge.id === edgeId)!,
          ),
        ).toEqual(routing);
      });
      const compactedByIndex = new Map(
        expandedEdges.flatMap((edge) =>
          edge.data!.displayIndexes.map(
            (index) => [index, edge] as const,
          ),
        ),
      );
      expect(
        routingSnapshot(compactedByIndex.get(3)!),
      ).toEqual(transfer3Baseline);
      expect(
        routingSnapshot(compactedByIndex.get(4)!),
      ).toEqual(transfer4Baseline);
      const {
        routeY: transfer6CompactedRouteY,
        ...transfer6CompactedRouting
      } = routingSnapshot(compactedByIndex.get(6)!);
      expect(transfer6CompactedRouting).toEqual(
        transfer6BaselineRouting,
      );
      expect(transfer6CompactedRouteY).toBeLessThan(
        transfer6BaselineRouteY,
      );
      const compactedTransfer6Geometry = edgeHorizontalRoute(
        compactedByIndex.get(6)!,
        expandedPositions,
      )!;
      expect(compactedTransfer6Geometry.targetNeedsCurve).toBe(false);
      expect(transfer6CompactedRouteY).toBeCloseTo(
        compactedTransfer6Geometry.segments.at(-1)!.to.y,
      );
      expect(
        routingIsCollisionFree(
          expandedEdges,
          expandedPositions,
        ),
      ).toBe(true);
    },
    60_000,
  );

  it("uses same-length custom arrow markers for transfer edges", () => {
    const { edges } = toFlowElements(trace());

    expect(edges[0].markerEnd).toBe(transferArrowMarkerId(GRAPH_COLORS.erc20));
    expect(TRANSFER_ARROW_MARKER_WIDTH).toBe(22);
    expect(TRANSFER_ARROW_MARKER_HEIGHT).toBe(16);
  });
});
