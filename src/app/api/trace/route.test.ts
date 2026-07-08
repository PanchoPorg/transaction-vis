import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import {
  __resetAddressLabelsForTests,
  createAddressProjectLabelUpsert,
  ensureAddressLabelsSchema,
} from "@/lib/address-labels";
import { __resetEtherscanForTests } from "@/lib/tx/etherscan";
import { __resetMetadataForTests } from "@/lib/tx/metadata";
import { __resetTraceCacheForTests } from "@/lib/tx/trace";
import { ERC20_TRANSFER_TOPIC } from "@/lib/tx/parse";

const TX_HASH = `0x${"b".repeat(64)}`;
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const FROM_TOPIC = `0x${"0".repeat(24)}${ALICE.slice(2)}`;
const TO_TOPIC = `0x${"0".repeat(24)}${BOB.slice(2)}`;

let tempDir: string;
let previousAddressLabelsDbPath: string | undefined;

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function metadataString(value: string) {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  const length = value.length.toString(16).padStart(64, "0");
  return `0x${"20".padStart(64, "0")}${length}${padded}`;
}

describe("GET /api/trace", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "tx-viz-route-labels-"));
    previousAddressLabelsDbPath = process.env.ADDRESS_LABELS_DB_PATH;
    process.env.ADDRESS_LABELS_DB_PATH = path.join(tempDir, "labels.sqlite");
    process.env.ETHERSCAN_API_KEY = "test-key";
    __resetEtherscanForTests();
    __resetMetadataForTests();
    __resetTraceCacheForTests();
    __resetAddressLabelsForTests();

    const db = new Database(process.env.ADDRESS_LABELS_DB_PATH);
    ensureAddressLabelsSchema(db);
    createAddressProjectLabelUpsert(db)({
      chainId: "1",
      address: BOB,
      project: "Uniswap V3",
      label: "Uniswap V3",
      source: "test",
      priority: 100,
    });
    db.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetAddressLabelsForTests();
    delete process.env.ETHERSCAN_API_KEY;
    if (previousAddressLabelsDbPath === undefined) delete process.env.ADDRESS_LABELS_DB_PATH;
    else process.env.ADDRESS_LABELS_DB_PATH = previousAddressLabelsDbPath;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a normalized trace and caches repeat requests", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const action = url.searchParams.get("action");
      const data = url.searchParams.get("data");

      if (action === "eth_getTransactionByHash") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { hash: TX_HASH, from: ALICE, to: BOB, value: "0x0", blockNumber: "0x1" },
        });
      }
      if (action === "eth_getTransactionReceipt") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            status: "0x1",
            blockNumber: "0x1",
            logs: [
              {
                address: TOKEN,
                topics: [ERC20_TRANSFER_TOPIC, FROM_TOPIC, TO_TOPIC],
                data: `0x${"0".repeat(62)}64`,
                logIndex: "0x2",
              },
            ],
          },
        });
      }
      if (action === "txlistinternal") {
        return jsonResponse({ status: "1", message: "OK", result: [] });
      }
      if (action === "eth_call" && data === "0x06fdde03") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: metadataString("USD Coin") });
      }
      if (action === "eth_call" && data === "0x95d89b41") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: metadataString("USDC") });
      }
      if (action === "eth_call" && data === "0x313ce567") {
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x06" });
      }

      return jsonResponse({ status: "0", message: "NOTOK", result: "unexpected call" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await GET(new Request(`http://localhost/api/trace?txHash=${TX_HASH}`));
    const second = await GET(new Request(`http://localhost/api/trace?txHash=${TX_HASH}`));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const body = await first.json();
    expect(body.edges).toHaveLength(2);
    expect(body.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: BOB,
          label: "Uniswap V3",
          projectLabel: "Uniswap V3",
        }),
      ]),
    );
    expect(body.transfers).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbol: "USDC", valueFormatted: "0.0001" })]),
    );
  });

  it("reports missing api key", async () => {
    delete process.env.ETHERSCAN_API_KEY;
    const response = await GET(new Request(`http://localhost/api/trace?txHash=${TX_HASH}`));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "missing-api-key" });
  });

  it("reports invalid tx hashes before any upstream fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/trace?txHash=0x123"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Etherscan rate limit errors to 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({ status: "0", message: "NOTOK", result: "Max rate limit reached" }),
      ),
    );

    const response = await GET(new Request(`http://localhost/api/trace?txHash=${TX_HASH}`));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "etherscan-rate-limit" });
  });
});
