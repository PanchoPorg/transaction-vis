import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import {
  DEFAULT_ADDRESS_LABELS_DB_PATH,
  createAddressProjectLabelUpsert,
  ensureAddressLabelsSchema,
  type AddressProjectLabelInput,
} from "../src/lib/address-labels";
import { ETHEREUM_MAINNET } from "../src/lib/tx/chains";

const DEFAULT_QUERY_ID = 7868214;
const DEFAULT_PROJECT = "Uniswap V3";
const DEFAULT_PAGE_SIZE = 5_000;
const ADDRESS_COLUMN = "project_contract_address";

type DuneRow = {
  [ADDRESS_COLUMN]?: unknown;
};

type DuneResultPage = {
  state?: string;
  next_offset?: number | null;
  error?: { message?: string };
  result?: {
    metadata?: {
      row_count?: number;
      total_row_count?: number;
    };
    rows?: DuneRow[];
  };
};

type ImportOptions = {
  queryId: number;
  dbPath: string;
  project: string;
  label: string;
  pageSize: number;
};

function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function readOption(name: string) {
  const prefix = `--${name}=`;
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readNumberOption(name: string, fallback: number) {
  const value = readOption(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${value}`);
  }
  return parsed;
}

function readOptions(): ImportOptions {
  return {
    queryId: readNumberOption("query-id", DEFAULT_QUERY_ID),
    dbPath: readOption("db") ?? process.env.ADDRESS_LABELS_DB_PATH ?? DEFAULT_ADDRESS_LABELS_DB_PATH,
    project: readOption("project") ?? DEFAULT_PROJECT,
    label: readOption("label") ?? DEFAULT_PROJECT,
    pageSize: readNumberOption("page-size", DEFAULT_PAGE_SIZE),
  };
}

function getDuneApiKey() {
  const key = process.env.DUNE_API_KEY?.trim();
  if (!key) {
    throw new Error("DUNE_API_KEY is not set. Add it to .env.local or the shell environment.");
  }
  return key;
}

async function getDuneResultPage(options: {
  apiKey: string;
  queryId: number;
  offset: number;
  limit: number;
}) {
  const url = new URL(`https://api.dune.com/api/v1/query/${options.queryId}/results`);
  url.searchParams.set("columns", ADDRESS_COLUMN);
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("offset", String(options.offset));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-DUNE-API-KEY": options.apiKey,
    },
  });
  const body = (await response.json()) as DuneResultPage;

  if (!response.ok) {
    throw new Error(body.error?.message ?? `Dune returned HTTP ${response.status}.`);
  }
  if (body.state && body.state !== "QUERY_STATE_COMPLETED") {
    throw new Error(`Dune query result is not completed. Current state: ${body.state}.`);
  }

  return body;
}

async function main() {
  loadEnvConfig(projectRoot());

  const options = readOptions();
  const apiKey = getDuneApiKey();
  mkdirSync(path.dirname(options.dbPath), { recursive: true });

  const db = new Database(options.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureAddressLabelsSchema(db);

  const upsertLabel = createAddressProjectLabelUpsert(db);
  const importBatch = db.transaction((rows: DuneRow[]) => {
    let imported = 0;
    let skipped = 0;

    rows.forEach((row) => {
      const input: AddressProjectLabelInput = {
        chainId: ETHEREUM_MAINNET.id,
        address: String(row[ADDRESS_COLUMN] ?? ""),
        project: options.project,
        label: options.label,
        source: `dune:query:${options.queryId}`,
        priority: 100,
      };

      if (upsertLabel(input)) imported += 1;
      else skipped += 1;
    });

    return { imported, skipped };
  });

  let offset = 0;
  let fetched = 0;
  let imported = 0;
  let skipped = 0;
  let totalRows: number | null = null;

  for (;;) {
    const page = await getDuneResultPage({
      apiKey,
      queryId: options.queryId,
      offset,
      limit: options.pageSize,
    });
    const rows = page.result?.rows ?? [];
    const batch = importBatch(rows);

    fetched += rows.length;
    imported += batch.imported;
    skipped += batch.skipped;
    totalRows = page.result?.metadata?.total_row_count ?? totalRows;

    console.log(
      `Imported ${imported} labels from ${fetched}/${totalRows ?? "unknown"} fetched rows.`,
    );

    if (page.next_offset === null || page.next_offset === undefined || rows.length === 0) break;
    offset = page.next_offset;
  }

  db.pragma("optimize");
  db.close();

  console.log(
    JSON.stringify(
      {
        dbPath: options.dbPath,
        queryId: options.queryId,
        fetched,
        imported,
        skipped,
        totalRows,
        label: options.label,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
