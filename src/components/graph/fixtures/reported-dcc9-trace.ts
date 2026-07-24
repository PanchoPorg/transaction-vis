import type {
  AddressNodeRecord,
  TransferEdgeRecord,
  TransferKind,
  TransferRecord,
  TxTraceResponse,
} from "@/lib/tx/types";

export const REPORTED_DCC9_HASH =
  "0xdcc9bdfd260f8ca233a846860438d40e911361449c1d9a9b7bf7543e46dd5452";

export const REPORTED_DCC9_ADDRESSES = {
  sender: "0xc0ffeebabe5d496b2dde509f9fa189c25cf29671",
  receiver: "0xe08d97e151473a848c3d9ca3f323cb720472d015",
  weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  ad5f97: "0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97",
  bbb: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  disconnectedSource: "0x6ee206148486b32b639498342231f98fcf352577",
  zero: "0x0000000000000000000000000000000000000000",
  cd71db: "0x59cd1c87501baa753d0b5b5ab5d8416a45cd71db",
  disconnectedLeaf: "0xb137e7d16564c81ae2b0c8ee6b55de81dd46ece5",
  c02ab1: "0xc02ab1a5eaa8d1b114ef786d9bde108cd4364359",
  f1445: "0x1445f32d1a74872ba41f3d8cf4022e9996120b31",
  f04c: "0x04c8577958ccc170eb3d2cca76f9d51bc6e42d8f",
  e08a90: "0x000000000004444c5dc75cb358380d2e3de08a90",
} as const;

function fixtureNode(
  id: string,
  label: string,
  roles: AddressNodeRecord["roles"],
  incomingCount: number,
  outgoingCount: number,
): AddressNodeRecord {
  return {
    id,
    address: id,
    shortAddress: id,
    label,
    roles,
    transferCount: incomingCount + outgoingCount,
    incomingCount,
    outgoingCount,
  };
}

function fixtureEdge(
  source: string,
  target: string,
  displayIndex: number | null,
  label: string,
  kind: TransferKind = "erc20",
): TransferEdgeRecord {
  const indexKey = displayIndex ?? "unknown";
  return {
    id: `reported:${indexKey}:${source}->${target}`,
    source,
    target,
    label,
    displayIndexes: [displayIndex],
    transferIds: [`reported-transfer:${indexKey}`],
    kinds: [kind],
    transferCount: 1,
    assets: [],
    hasFailed: false,
  };
}

function firstErc20Transfer(): TransferRecord {
  const { bbb, receiver } = REPORTED_DCC9_ADDRESSES;
  return {
    id: "reported-transfer:2",
    kind: "erc20",
    txHash: REPORTED_DCC9_HASH,
    from: bbb,
    to: receiver,
    assetKey: "erc20:usds",
    tokenAddress: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
    tokenName: "USDS",
    symbol: "USDS",
    decimals: 18,
    valueRaw: "995614251345923430",
    valueFormatted: "0.9956",
    label: "0.9956 USDS",
    index: 1293,
    displayIndex: 2,
    failed: false,
    metadataWarnings: [],
  };
}

export function reportedDcc9Trace(): TxTraceResponse {
  const a = REPORTED_DCC9_ADDRESSES;
  return {
    tx: {
      hash: REPORTED_DCC9_HASH,
      chainId: "1",
      from: a.sender,
      to: a.receiver,
      valueRaw: "92",
      status: "success",
      blockNumber: "0x1862b46",
    },
    transfers: [firstErc20Transfer()],
    nodes: [
      fixtureNode(a.sender, "Sender", ["sender", "internal"], 1, 1),
      fixtureNode(a.receiver, "Receiver", ["receiver", "internal"], 7, 8),
      fixtureNode(a.weth, "WETH", ["internal"], 1, 1),
      fixtureNode(a.ad5f97, "0x4838B1...AD5f97", ["internal"], 1, 0),
      fixtureNode(a.bbb, "0xBBBBBb...EEFFCb", ["internal"], 1, 1),
      fixtureNode(
        a.disconnectedSource,
        "0x6ee206...352577",
        ["internal"],
        0,
        3,
      ),
      fixtureNode(a.zero, "0x000000...000000", ["internal"], 2, 0),
      fixtureNode(a.cd71db, "0x59cD1C...cD71DB", ["internal"], 0, 1),
      fixtureNode(
        a.disconnectedLeaf,
        "0xb137E7...46ECe5",
        ["internal"],
        1,
        0,
      ),
      fixtureNode(a.c02ab1, "0xC02aB1...364359", ["internal"], 1, 0),
      fixtureNode(a.f1445, "0x1445F3...120b31", ["internal"], 1, 1),
      fixtureNode(a.f04c, "0x04c857...E42D8f", ["internal"], 1, 1),
      fixtureNode(a.e08a90, "0x000000...E08A90", ["internal"], 1, 1),
    ],
    edges: [
      fixtureEdge(a.sender, a.receiver, 1, "[1] 0.0000 ETH", "native"),
      fixtureEdge(a.weth, a.receiver, 15, "[15] 0.0000 ETH", "internal"),
      fixtureEdge(
        a.receiver,
        a.ad5f97,
        null,
        "[?] 0.0000 ETH",
        "internal",
      ),
      fixtureEdge(
        a.receiver,
        a.sender,
        null,
        "[?] 0.0000 ETH",
        "internal",
      ),
      fixtureEdge(a.bbb, a.receiver, 2, "[2] 0.9956 USDS"),
      fixtureEdge(
        a.disconnectedSource,
        a.zero,
        3,
        "[3] 0.9354 variableDebtUSDS",
      ),
      fixtureEdge(
        a.disconnectedSource,
        a.zero,
        4,
        "[4] 0.0005 spWETH",
      ),
      fixtureEdge(a.cd71db, a.receiver, 5, "[5] 0.0006 WETH"),
      fixtureEdge(
        a.disconnectedSource,
        a.disconnectedLeaf,
        6,
        "[6] 0.0000 spWETH",
      ),
      fixtureEdge(a.receiver, a.c02ab1, 7, "[7] 0.9956 USDS"),
      fixtureEdge(a.f1445, a.receiver, 8, "[8] 0.9958 USDC"),
      fixtureEdge(a.f04c, a.receiver, 9, "[9] 0.9963 USDT"),
      fixtureEdge(a.e08a90, a.receiver, 10, "[10] 0.9956 USDS"),
      fixtureEdge(a.receiver, a.e08a90, 11, "[11] 0.9963 USDT"),
      fixtureEdge(a.receiver, a.f04c, 12, "[12] 0.9958 USDC"),
      fixtureEdge(a.receiver, a.f1445, 13, "[13] 0.0005 WETH"),
      fixtureEdge(a.receiver, a.bbb, 14, "[14] 0.9956 USDS"),
      fixtureEdge(a.receiver, a.weth, 16, "[16] 0.0000 WETH"),
    ],
    warnings: [],
  };
}
