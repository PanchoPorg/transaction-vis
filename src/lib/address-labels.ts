import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { toChecksumAddress } from "./tx/address";
import type { AddressProjectLabel, TxTraceResponse } from "./tx/types";

const DEFAULT_PRIORITY = 100;
const LOOKUP_CHUNK_SIZE = 800;

export const DEFAULT_ADDRESS_LABELS_DB_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "address-labels.sqlite",
);

export type AddressProjectLabelInput = {
  chainId: string;
  address: string;
  project: string;
  label?: string;
  source: string;
  priority?: number;
};

type AddressProjectLabelRow = {
  chain_id: string;
  address: string;
  checksum_address: string;
  project: string;
  label: string;
  source: string;
  priority: number;
};

let labelsDb: Database.Database | null | undefined;
let labelsDbPath: string | null = null;
let lookupWarningShown = false;

function addressLabelsDbPath() {
  return process.env.ADDRESS_LABELS_DB_PATH?.trim() || DEFAULT_ADDRESS_LABELS_DB_PATH;
}

function warnLookupFailure(error: unknown) {
  if (lookupWarningShown) return;
  lookupWarningShown = true;
  console.warn("Address labels lookup is disabled.", error);
}

function getLabelsDb() {
  const nextPath = addressLabelsDbPath();
  if (labelsDbPath !== nextPath && labelsDb?.open) {
    labelsDb.close();
    labelsDb = undefined;
  }
  labelsDbPath = nextPath;

  if (labelsDb !== undefined && labelsDb !== null) return labelsDb;

  if (!existsSync(/* turbopackIgnore: true */ nextPath)) {
    labelsDb = null;
    return labelsDb;
  }

  try {
    labelsDb = new Database(nextPath, { readonly: true, fileMustExist: true });
    labelsDb.pragma("query_only = ON");
  } catch (error) {
    labelsDb = null;
    warnLookupFailure(error);
  }

  return labelsDb;
}

export function ensureAddressLabelsSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS address_project_labels (
      chain_id TEXT NOT NULL,
      address TEXT NOT NULL,
      checksum_address TEXT NOT NULL,
      project TEXT NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT ${DEFAULT_PRIORITY},
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chain_id, address, project, source)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS address_project_labels_lookup_idx
      ON address_project_labels (chain_id, address, priority, project, label);
  `);
}

export function normalizeAddressProjectLabelInput(
  input: AddressProjectLabelInput,
): AddressProjectLabel | null {
  const chainId = input.chainId.trim();
  const project = input.project.trim();
  const source = input.source.trim();
  const label = input.label?.trim() || project;

  if (!chainId || !project || !source || !label) return null;

  let checksumAddress: string;
  try {
    checksumAddress = toChecksumAddress(input.address.trim());
  } catch {
    return null;
  }

  return {
    chainId,
    address: checksumAddress,
    project,
    label,
    source,
    priority: Number.isInteger(input.priority) ? input.priority ?? DEFAULT_PRIORITY : DEFAULT_PRIORITY,
  };
}

export function createAddressProjectLabelUpsert(db: Database.Database) {
  const statement = db.prepare<{
    chainId: string;
    address: string;
    checksumAddress: string;
    project: string;
    label: string;
    source: string;
    priority: number;
  }>(`
    INSERT INTO address_project_labels (
      chain_id,
      address,
      checksum_address,
      project,
      label,
      source,
      priority,
      updated_at
    )
    VALUES (
      @chainId,
      @address,
      @checksumAddress,
      @project,
      @label,
      @source,
      @priority,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (chain_id, address, project, source) DO UPDATE SET
      checksum_address = excluded.checksum_address,
      label = excluded.label,
      priority = excluded.priority,
      updated_at = CURRENT_TIMESTAMP
  `);

  return (input: AddressProjectLabelInput) => {
    const label = normalizeAddressProjectLabelInput(input);
    if (!label) return false;

    statement.run({
      chainId: label.chainId,
      address: label.address.toLowerCase(),
      checksumAddress: label.address,
      project: label.project,
      label: label.label,
      source: label.source,
      priority: label.priority,
    });
    return true;
  };
}

export function upsertAddressProjectLabel(db: Database.Database, input: AddressProjectLabelInput) {
  return createAddressProjectLabelUpsert(db)(input);
}

export function getAddressProjectLabels(chainId: string, addresses: string[]) {
  const db = getLabelsDb();
  const labelsByAddress = new Map<string, AddressProjectLabel[]>();
  if (!db || addresses.length === 0) return labelsByAddress;

  const addressKeys = [
    ...new Set(
      addresses
        .map((address) => {
          try {
            return toChecksumAddress(address).toLowerCase();
          } catch {
            return null;
          }
        })
        .filter((address): address is string => Boolean(address)),
    ),
  ];
  if (addressKeys.length === 0) return labelsByAddress;

  try {
    for (let index = 0; index < addressKeys.length; index += LOOKUP_CHUNK_SIZE) {
      const chunk = addressKeys.slice(index, index + LOOKUP_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = db
        .prepare<string[], AddressProjectLabelRow>(`
          SELECT
            chain_id,
            address,
            checksum_address,
            project,
            label,
            source,
            priority
          FROM address_project_labels
          WHERE chain_id = ? AND address IN (${placeholders})
          ORDER BY address, priority, project, label
        `)
        .all(chainId, ...chunk);

      rows.forEach((row) => {
        const key = row.address.toLowerCase();
        const labels = labelsByAddress.get(key) ?? [];
        labels.push({
          chainId: row.chain_id,
          address: row.checksum_address,
          project: row.project,
          label: row.label,
          source: row.source,
          priority: row.priority,
        });
        labelsByAddress.set(key, labels);
      });
    }
  } catch (error) {
    warnLookupFailure(error);
    return new Map();
  }

  return labelsByAddress;
}

export function enrichTraceWithAddressLabels(trace: TxTraceResponse): TxTraceResponse {
  const labelsByAddress = getAddressProjectLabels(
    trace.tx.chainId,
    trace.nodes.map((node) => node.address),
  );
  if (labelsByAddress.size === 0) return trace;

  return {
    ...trace,
    nodes: trace.nodes.map((node) => {
      const projectLabels = labelsByAddress.get(node.id);
      const projectLabel = projectLabels?.[0]?.label;
      if (!projectLabel || !projectLabels) return node;

      return {
        ...node,
        label: projectLabel,
        projectLabel,
        projectLabels,
      };
    }),
  };
}

export function __resetAddressLabelsForTests() {
  if (labelsDb?.open) labelsDb.close();
  labelsDb = undefined;
  labelsDbPath = null;
  lookupWarningShown = false;
}
