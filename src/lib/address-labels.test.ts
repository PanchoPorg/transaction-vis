import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetAddressLabelsForTests,
  createAddressProjectLabelUpsert,
  enrichTraceWithAddressLabels,
  ensureAddressLabelsSchema,
  normalizeAddressProjectLabelInput,
} from "./address-labels";
import { toChecksumAddress } from "./tx/address";
import type { TxTraceResponse } from "./tx/types";

const ALICE = "0x1111111111111111111111111111111111111111";
const POOL = "0x2da1eae7f7260ae69ea393ee84955359c6f020fd";

function trace(): TxTraceResponse {
  return {
    tx: {
      hash: `0x${"a".repeat(64)}`,
      chainId: "1",
      from: ALICE,
      to: POOL,
      valueRaw: "0",
      status: "success",
      blockNumber: null,
    },
    transfers: [],
    nodes: [
      {
        id: ALICE.toLowerCase(),
        address: ALICE,
        shortAddress: "0x111111...111111",
        label: "Sender",
        roles: ["sender"],
        transferCount: 1,
        incomingCount: 0,
        outgoingCount: 1,
      },
      {
        id: POOL.toLowerCase(),
        address: POOL,
        shortAddress: "0x2da1ea...f020fd",
        label: "Receiver",
        roles: ["receiver"],
        transferCount: 1,
        incomingCount: 1,
        outgoingCount: 0,
      },
    ],
    edges: [],
    warnings: [],
  };
}

describe("address labels", () => {
  let tempDir: string;
  let previousDbPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "tx-viz-labels-"));
    previousDbPath = process.env.ADDRESS_LABELS_DB_PATH;
    __resetAddressLabelsForTests();
  });

  afterEach(() => {
    __resetAddressLabelsForTests();
    if (previousDbPath === undefined) delete process.env.ADDRESS_LABELS_DB_PATH;
    else process.env.ADDRESS_LABELS_DB_PATH = previousDbPath;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps traces unchanged when the local database is missing", () => {
    process.env.ADDRESS_LABELS_DB_PATH = path.join(tempDir, "missing.sqlite");

    const originalTrace = trace();
    const enriched = enrichTraceWithAddressLabels(originalTrace);

    expect(enriched).toBe(originalTrace);
    expect(enriched.nodes[1].label).toBe("Receiver");
    expect(enriched.nodes[1].projectLabel).toBeUndefined();
  });

  it("picks up the database if it is created after an initial missing lookup", () => {
    const dbPath = path.join(tempDir, "labels.sqlite");
    process.env.ADDRESS_LABELS_DB_PATH = dbPath;

    expect(enrichTraceWithAddressLabels(trace()).nodes[1].label).toBe("Receiver");

    const db = new Database(dbPath);
    ensureAddressLabelsSchema(db);
    createAddressProjectLabelUpsert(db)({
      chainId: "1",
      address: POOL,
      project: "Uniswap V3",
      label: "Uniswap V3",
      source: "test",
    });
    db.close();

    expect(enrichTraceWithAddressLabels(trace()).nodes[1]).toMatchObject({
      label: "Uniswap V3",
      projectLabel: "Uniswap V3",
    });
  });

  it("skips invalid addresses before upsert", () => {
    const dbPath = path.join(tempDir, "labels.sqlite");
    const db = new Database(dbPath);
    ensureAddressLabelsSchema(db);
    const upsert = createAddressProjectLabelUpsert(db);

    expect(
      normalizeAddressProjectLabelInput({
        chainId: "1",
        address: "not-an-address",
        project: "Uniswap V3",
        label: "Uniswap V3",
        source: "test",
      }),
    ).toBeNull();
    expect(
      upsert({
        chainId: "1",
        address: "not-an-address",
        project: "Uniswap V3",
        label: "Uniswap V3",
        source: "test",
      }),
    ).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM address_project_labels").get()).toEqual({
      count: 0,
    });

    db.close();
  });

  it("uses the latest duplicate upsert and exposes project metadata", () => {
    const dbPath = path.join(tempDir, "labels.sqlite");
    process.env.ADDRESS_LABELS_DB_PATH = dbPath;

    const db = new Database(dbPath);
    ensureAddressLabelsSchema(db);
    const upsert = createAddressProjectLabelUpsert(db);
    expect(
      upsert({
        chainId: "1",
        address: POOL,
        project: "Uniswap V3",
        label: "Old label",
        source: "test",
        priority: 100,
      }),
    ).toBe(true);
    expect(
      upsert({
        chainId: "1",
        address: `0x${POOL.slice(2).toUpperCase()}`,
        project: "Uniswap V3",
        label: "Uniswap V3",
        source: "test",
        priority: 50,
      }),
    ).toBe(true);
    db.close();

    const enriched = enrichTraceWithAddressLabels(trace());
    const poolNode = enriched.nodes.find((node) => node.id === POOL.toLowerCase());

    expect(poolNode).toMatchObject({
      label: "Uniswap V3",
      projectLabel: "Uniswap V3",
      projectLabels: [
        expect.objectContaining({
          address: toChecksumAddress(POOL),
          project: "Uniswap V3",
          label: "Uniswap V3",
          source: "test",
          priority: 50,
        }),
      ],
    });
  });
});
