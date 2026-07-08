import { describe, expect, it } from "vitest";
import {
  WETH_ADDRESS,
  WETH_DEPOSIT_TOPIC,
  WETH_WITHDRAWAL_TOPIC,
  extractErc20Transfers,
} from "./extract";
import { ERC20_TRANSFER_TOPIC } from "./parse";

const TX_HASH = `0x${"1".repeat(64)}`;
const FROM_TOPIC = `0x${"0".repeat(24)}1111111111111111111111111111111111111111`;
const TO_TOPIC = `0x${"0".repeat(24)}2222222222222222222222222222222222222222`;

describe("extractErc20Transfers", () => {
  it("keeps ERC20-compatible Transfer logs and ignores ERC721-like logs", () => {
    const transfers = extractErc20Transfers(TX_HASH, [
      {
        address: "0x3333333333333333333333333333333333333333",
        topics: [ERC20_TRANSFER_TOPIC, FROM_TOPIC, TO_TOPIC],
        data: `0x${"0".repeat(63)}a`,
        logIndex: "0x7",
      },
      {
        address: "0x4444444444444444444444444444444444444444",
        topics: [ERC20_TRANSFER_TOPIC, FROM_TOPIC, TO_TOPIC, `0x${"0".repeat(63)}1`],
        data: "0x",
        logIndex: "0x8",
      },
    ]);

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueRaw: "10",
      index: 7,
    });
  });

  it("converts WETH Deposit and Withdrawal logs into synthetic WETH transfers", () => {
    const transfers = extractErc20Transfers(TX_HASH, [
      {
        address: WETH_ADDRESS,
        topics: [WETH_DEPOSIT_TOPIC, FROM_TOPIC],
        data: `0x${"0".repeat(63)}f`,
        logIndex: "0x9",
      },
      {
        address: WETH_ADDRESS,
        topics: [WETH_WITHDRAWAL_TOPIC, TO_TOPIC],
        data: `0x${"0".repeat(63)}a`,
        logIndex: "0xa",
      },
      {
        address: "0x5555555555555555555555555555555555555555",
        topics: [WETH_DEPOSIT_TOPIC, FROM_TOPIC],
        data: `0x${"0".repeat(63)}1`,
        logIndex: "0xb",
      },
      {
        address: WETH_ADDRESS,
        topics: [WETH_WITHDRAWAL_TOPIC, FROM_TOPIC],
        data: `0x${"0".repeat(64)}`,
        logIndex: "0xc",
      },
    ]);

    expect(transfers).toEqual([
      expect.objectContaining({
        id: "weth-deposit:9",
        tokenAddress: WETH_ADDRESS,
        from: WETH_ADDRESS,
        to: "0x1111111111111111111111111111111111111111",
        valueRaw: "15",
        index: 9,
      }),
      expect.objectContaining({
        id: "weth-withdrawal:10",
        tokenAddress: WETH_ADDRESS,
        from: "0x2222222222222222222222222222222222222222",
        to: WETH_ADDRESS,
        valueRaw: "10",
        index: 10,
      }),
    ]);
  });
});
