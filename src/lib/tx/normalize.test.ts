import { describe, expect, it } from "vitest";
import { WETH_ADDRESS } from "./extract";
import { normalizeTrace } from "./normalize";
import type { TokenMetadata } from "./types";

const TX_HASH = `0x${"a".repeat(64)}`;
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

function metadata(): Map<string, TokenMetadata> {
  return new Map([
    [
      TOKEN.toLowerCase(),
      {
        address: TOKEN,
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        warnings: [],
      },
    ],
    [
      WETH_ADDRESS.toLowerCase(),
      {
        address: WETH_ADDRESS,
        name: "Wrapped Ether",
        symbol: "WETH",
        decimals: 18,
        warnings: [],
      },
    ],
  ]);
}

describe("normalizeTrace", () => {
  it("aggregates same-direction transfers per asset into separate edges", () => {
    const trace = normalizeTrace({
      chainId: "1",
      transaction: {
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: "0x0",
        blockNumber: "0x1",
      },
      receipt: { status: "0x1", blockNumber: "0x1" },
      internalTxs: [{ from: ALICE, to: BOB, value: "1000000000000000000", isError: "0" }],
      erc20Transfers: [
        {
          id: "erc20:1",
          txHash: TX_HASH,
          tokenAddress: TOKEN,
          from: ALICE,
          to: BOB,
          valueRaw: "2500000",
          index: 1,
        },
        {
          id: "erc20:2",
          txHash: TX_HASH,
          tokenAddress: TOKEN,
          from: ALICE,
          to: BOB,
          valueRaw: "500000",
          index: 2,
        },
      ],
      tokenMetadata: metadata(),
    });

    expect(trace.transfers).toHaveLength(4);
    expect(trace.edges).toHaveLength(3);
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "[1] 0.00 ETH",
          displayIndexes: [1],
          transferCount: 1,
          kinds: ["topLevelCall"],
        }),
        expect.objectContaining({
          label: "[?] 1.00 ETH",
          displayIndexes: [null],
          transferCount: 1,
          kinds: ["internal"],
        }),
        expect.objectContaining({
          label: "[2-3] 3.00 USDC · 2 txs",
          displayIndexes: [2, 3],
          transferCount: 2,
          assets: [
            expect.objectContaining({
              symbol: "USDC",
              valueRaw: "3000000",
              valueFormatted: "3.00",
              transferCount: 2,
            }),
          ],
        }),
      ]),
    );
  });

  it("does not count unordered native transfers when numbering event-based transfers", () => {
    const trace = normalizeTrace({
      chainId: "1",
      transaction: {
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: "0x0",
      },
      receipt: { status: "0x1" },
      internalTxs: [{ from: BOB, to: ALICE, value: "1000000000000000000", isError: "0" }],
      erc20Transfers: [
        {
          id: "erc20:10",
          txHash: TX_HASH,
          tokenAddress: TOKEN,
          from: ALICE,
          to: BOB,
          valueRaw: "2500000",
          index: 10,
        },
      ],
      tokenMetadata: metadata(),
    });

    expect(trace.transfers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "topLevelCall", displayIndex: 1 }),
        expect.objectContaining({ kind: "internal", displayIndex: null }),
        expect.objectContaining({ kind: "erc20", displayIndex: 2 }),
      ]),
    );
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: ["internal"], label: "[?] 1.00 ETH", displayIndexes: [null] }),
        expect.objectContaining({ kinds: ["erc20"], label: "[2] 2.50 USDC", displayIndexes: [2] }),
      ]),
    );
  });

  it("keeps failed transactions as failed top-level calls without completed transfer events", () => {
    const trace = normalizeTrace({
      chainId: "1",
      transaction: {
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: "0xde0b6b3a7640000",
      },
      receipt: { status: "0x0" },
      internalTxs: [{ from: ALICE, to: BOB, value: "100", isError: "0" }],
      erc20Transfers: [
        {
          id: "erc20:1",
          txHash: TX_HASH,
          tokenAddress: TOKEN,
          from: ALICE,
          to: BOB,
          valueRaw: "2500000",
          index: 1,
        },
      ],
      tokenMetadata: metadata(),
    });

    expect(trace.tx.status).toBe("failed");
    expect(trace.transfers).toHaveLength(1);
    expect(trace.transfers[0]).toMatchObject({ kind: "topLevelCall", failed: true });
    expect(trace.edges[0]).toMatchObject({ hasFailed: true, label: "[1] failed call" });
  });

  it("normalizes synthetic WETH wrap events as ERC20-compatible WETH transfers", () => {
    const trace = normalizeTrace({
      chainId: "1",
      transaction: {
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: "0x0",
      },
      receipt: { status: "0x1" },
      internalTxs: [
        {
          from: WETH_ADDRESS,
          to: ALICE,
          value: "1000000000000000000",
          isError: "0",
        },
      ],
      erc20Transfers: [
        {
          id: "weth-withdrawal:2",
          txHash: TX_HASH,
          tokenAddress: WETH_ADDRESS,
          from: ALICE,
          to: WETH_ADDRESS,
          valueRaw: "1000000000000000000",
          index: 2,
        },
      ],
      tokenMetadata: metadata(),
    });

    expect(trace.transfers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "weth-withdrawal:2",
          kind: "erc20",
          from: ALICE,
          to: WETH_ADDRESS,
          symbol: "WETH",
          valueFormatted: "1.00",
          displayIndex: 3,
        }),
      ]),
    );
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "[3] 1.00 WETH",
          kinds: ["erc20"],
          assets: [
            expect.objectContaining({
              symbol: "WETH",
              valueRaw: "1000000000000000000",
            }),
          ],
        }),
      ]),
    );
  });

  it("orders WETH native legs by the matching Deposit or Withdrawal event index", () => {
    const trace = normalizeTrace({
      chainId: "1",
      transaction: {
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: "0x0",
      },
      receipt: { status: "0x1" },
      internalTxs: [
        {
          from: WETH_ADDRESS,
          to: ALICE,
          value: "1000000000000000000",
          isError: "0",
        },
      ],
      erc20Transfers: [
        {
          id: "erc20:10",
          txHash: TX_HASH,
          tokenAddress: TOKEN,
          from: BOB,
          to: ALICE,
          valueRaw: "2500000",
          index: 10,
        },
        {
          id: "weth-withdrawal:20",
          txHash: TX_HASH,
          tokenAddress: WETH_ADDRESS,
          from: ALICE,
          to: WETH_ADDRESS,
          valueRaw: "1000000000000000000",
          index: 20,
        },
      ],
      tokenMetadata: metadata(),
    });

    expect(
      [...trace.transfers].sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0)).map((transfer) => ({
        kind: transfer.kind,
        symbol: transfer.symbol,
        from: transfer.from,
        to: transfer.to,
        displayIndex: transfer.displayIndex,
      })),
    ).toEqual([
      expect.objectContaining({ kind: "topLevelCall", displayIndex: 1 }),
      expect.objectContaining({ kind: "erc20", symbol: "USDC", displayIndex: 2 }),
      expect.objectContaining({
        kind: "internal",
        symbol: "ETH",
        from: WETH_ADDRESS,
        to: ALICE,
        displayIndex: 3,
      }),
      expect.objectContaining({
        kind: "erc20",
        symbol: "WETH",
        from: ALICE,
        to: WETH_ADDRESS,
        displayIndex: 4,
      }),
    ]);
  });
});
