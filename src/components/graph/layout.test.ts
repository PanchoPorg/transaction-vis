import { describe, expect, it } from "vitest";
import {
  TRANSFER_ARROW_MARKER_HEIGHT,
  TRANSFER_ARROW_MARKER_WIDTH,
  transferArrowMarkerId,
} from "./edge-style";
import {
  assignStraightEndpointRoutes,
  buildLayoutEdges,
  centerRightColumnsByLeftNeighbors,
  layoutTrace,
  orderColumnPositionsByTransferIndex,
  toFlowElements,
} from "./layout";
import type { TransferFlowEdge } from "./types";
import type { AddressNodeRecord, TransferEdgeRecord, TransferRecord, TxTraceResponse } from "@/lib/tx/types";

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
    markerEnd: transferArrowMarkerId("#d1883a"),
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
      laneIndex: 0,
      laneCount: 1,
      fanoutIndex: 0,
      fanoutCount: 1,
      fanoutHub: null,
      fanoutOffset: 0,
      straightSource: false,
      straightTarget: false,
      sourceRouteOffset: null,
      targetRouteOffset: null,
    },
  };
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

  it("centers multiple right-side children as a group around their connected left address", () => {
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

    expect(positions.get(lower)?.y).toBe(124);
    expect(positions.get(upper)?.y).toBe(356);
    expect(((positions.get(lower)?.y ?? 0) + (positions.get(upper)?.y ?? 0)) / 2).toBe(
      positions.get(sushi)?.y,
    );
  });

  it("prefers out-left and in-right as straight endpoints for upper nodes", () => {
    const receiver = RECEIVER.toLowerCase();
    const upper = UPPER.toLowerCase();
    const other = OTHER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 160 }],
      [upper, { x: 600, y: 0 }],
      [other, { x: 960, y: 0 }],
    ]);
    const upperOutLeft = flowEdge("upper-out-left", UPPER, RECEIVER, "out-left", "in-right");
    const upperInLeft = flowEdge("upper-in-left", RECEIVER, UPPER, "out-right", "in-left");
    const upperOutRight = flowEdge("upper-out-right", UPPER, OTHER, "out-right", "in-left");
    const upperInRight = flowEdge("upper-in-right", OTHER, UPPER, "out-left", "in-right");
    const edges = [upperOutLeft, upperInLeft, upperOutRight, upperInRight];

    assignStraightEndpointRoutes(edges, positions, receiver);

    expect(upperOutLeft.data?.straightSource).toBe(true);
    expect(upperOutLeft.data?.sourceRouteOffset).toBe(0);
    expect(upperInLeft.data?.straightTarget).toBe(false);
    expect(upperInLeft.data?.targetRouteOffset).not.toBe(0);

    expect(upperInRight.data?.straightTarget).toBe(true);
    expect(upperInRight.data?.targetRouteOffset).toBe(0);
    expect(upperOutRight.data?.straightSource).toBe(false);
    expect(upperOutRight.data?.sourceRouteOffset).not.toBe(0);
  });

  it("mirrors straight endpoint preferences for lower nodes", () => {
    const receiver = RECEIVER.toLowerCase();
    const lower = LOWER.toLowerCase();
    const other = OTHER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 160 }],
      [lower, { x: 600, y: 340 }],
      [other, { x: 960, y: 340 }],
    ]);
    const lowerOutLeft = flowEdge("lower-out-left", LOWER, RECEIVER, "out-left", "in-right");
    const lowerInLeft = flowEdge("lower-in-left", RECEIVER, LOWER, "out-right", "in-left");
    const lowerOutRight = flowEdge("lower-out-right", LOWER, OTHER, "out-right", "in-left");
    const lowerInRight = flowEdge("lower-in-right", OTHER, LOWER, "out-left", "in-right");
    const edges = [lowerOutLeft, lowerInLeft, lowerOutRight, lowerInRight];

    assignStraightEndpointRoutes(edges, positions, receiver);

    expect(lowerInLeft.data?.straightTarget).toBe(true);
    expect(lowerInLeft.data?.targetRouteOffset).toBe(0);
    expect(lowerOutLeft.data?.straightSource).toBe(false);
    expect(lowerOutLeft.data?.sourceRouteOffset).not.toBe(0);

    expect(lowerOutRight.data?.straightSource).toBe(true);
    expect(lowerOutRight.data?.sourceRouteOffset).toBe(0);
    expect(lowerInRight.data?.straightTarget).toBe(false);
    expect(lowerInRight.data?.targetRouteOffset).not.toBe(0);
  });

  it("keeps receiver neutral while forcing one straight endpoint per non-receiver side", () => {
    const receiver = RECEIVER.toLowerCase();
    const upper = UPPER.toLowerCase();
    const lower = LOWER.toLowerCase();
    const positions = new Map([
      [receiver, { x: 300, y: 160 }],
      [upper, { x: 0, y: 0 }],
      [lower, { x: 0, y: 340 }],
    ]);
    const upperToReceiver = flowEdge("upper-to-receiver", UPPER, RECEIVER, "out-right", "in-left");
    const lowerToReceiver = flowEdge("lower-to-receiver", LOWER, RECEIVER, "out-right", "in-left");
    const receiverToUpper = flowEdge("receiver-to-upper", RECEIVER, UPPER, "out-left", "in-right");
    const receiverToLower = flowEdge("receiver-to-lower", RECEIVER, LOWER, "out-left", "in-right");
    const edges = [upperToReceiver, lowerToReceiver, receiverToUpper, receiverToLower];

    assignStraightEndpointRoutes(edges, positions, receiver);

    expect(upperToReceiver.data?.straightTarget).toBe(false);
    expect(lowerToReceiver.data?.straightTarget).toBe(false);
    expect(receiverToUpper.data?.straightSource).toBe(false);
    expect(receiverToLower.data?.straightSource).toBe(false);

    expect(receiverToUpper.data?.straightTarget).toBe(true);
    expect(upperToReceiver.data?.straightSource).toBe(false);
    expect(receiverToLower.data?.straightTarget).toBe(false);
    expect(lowerToReceiver.data?.straightSource).toBe(true);
  });

  it("keeps the pre-receiver pair on separate straight handles so receiver routes do not cross", () => {
    const receiver = RECEIVER.toLowerCase();
    const preReceiverSource = SUSHI.toLowerCase();
    const positions = new Map([
      [receiver, { x: 720, y: 160 }],
      [preReceiverSource, { x: 0, y: 132 }],
    ]);
    const firstInbound = flowEdge("inbound-2", SUSHI, RECEIVER, "out-right", "in-left", [2]);
    const receiverOutbound = flowEdge("receiver-out", RECEIVER, SUSHI, "out-left", "in-right", [31]);
    const laterInbound = flowEdge("inbound-40", SUSHI, RECEIVER, "out-right", "in-left", [40]);
    const edges = [laterInbound, receiverOutbound, firstInbound];

    assignStraightEndpointRoutes(edges, positions, receiver, preReceiverSource);

    expect(firstInbound.data?.straightSource).toBe(true);
    expect(firstInbound.data?.sourceRouteOffset).toBe(0);
    expect(receiverOutbound.data?.straightTarget).toBe(false);
    expect(receiverOutbound.data?.targetRouteOffset).toBeGreaterThan(30);
    expect(receiverOutbound.data?.targetRouteOffset).toBeLessThan(40);
    expect(laterInbound.data?.straightSource).toBe(false);
    expect(laterInbound.data?.sourceRouteOffset).toBe(112);
  });

  it("uses same-length custom arrow markers for transfer edges", () => {
    const { edges } = toFlowElements(trace());

    expect(edges[0].markerEnd).toBe(transferArrowMarkerId("#d1883a"));
    expect(TRANSFER_ARROW_MARKER_WIDTH).toBe(22);
    expect(TRANSFER_ARROW_MARKER_HEIGHT).toBe(16);
  });
});
