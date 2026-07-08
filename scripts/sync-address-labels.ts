import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import {
  DEFAULT_ADDRESS_LABELS_DB_PATH,
  ensureAddressLabelsSchema,
} from "../src/lib/address-labels";

const DEFAULT_RELEASE_BASE_URL =
  "https://github.com/PanchoPorg/transaction-vis/releases/download/address-labels-latest";
const DEFAULT_MANIFEST_NAME = "address-labels.manifest.json";

type SyncMode = "merge" | "replace";

type ReleaseManifest = {
  version: string;
  schemaVersion: number;
  createdAt: string;
  source: string;
  rowCount: number;
  database: {
    file: string;
    compressedSha256: string;
    uncompressedSha256: string;
    compressedSize: number;
    uncompressedSize: number;
  };
};

type Options = {
  dbPath: string;
  mode: SyncMode;
  releaseBaseUrl: string;
  manifestUrl: string;
  backup: boolean;
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

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readMode(): SyncMode {
  const mode = readOption("mode") ?? "merge";
  if (mode === "merge" || mode === "replace") return mode;
  throw new Error(`Invalid --mode: ${mode}. Expected "merge" or "replace".`);
}

function joinReleaseUrl(baseUrl: string, fileName: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
}

function readOptions(): Options {
  const releaseBaseUrl =
    readOption("release-base-url") ??
    process.env.ADDRESS_LABELS_RELEASE_BASE_URL ??
    DEFAULT_RELEASE_BASE_URL;
  return {
    dbPath: readOption("db") ?? process.env.ADDRESS_LABELS_DB_PATH ?? DEFAULT_ADDRESS_LABELS_DB_PATH,
    mode: readMode(),
    releaseBaseUrl,
    manifestUrl: readOption("manifest-url") ?? joinReleaseUrl(releaseBaseUrl, DEFAULT_MANIFEST_NAME),
    backup: !hasFlag("no-backup"),
  };
}

async function downloadToFile(url: string, filePath: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/octet-stream, application/json;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`Download failed for ${url}: response body is empty`);
  }

  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
    createWriteStream(filePath),
  );
}

async function readManifest(url: string): Promise<ReleaseManifest> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Manifest request failed for ${url}: HTTP ${response.status}`);
  }

  const manifest = (await response.json()) as ReleaseManifest;
  if (manifest.schemaVersion !== 1 || !manifest.database?.file) {
    throw new Error("Unsupported address labels manifest.");
  }
  return manifest;
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function verifySha256(filePath: string, expected: string, label: string) {
  const actual = await sha256(filePath);
  if (actual !== expected) {
    throw new Error(`${label} sha256 mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function countRows(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT COUNT(*) FROM address_project_labels").pluck().get() as number;
  } finally {
    db.close();
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function replaceDatabase(options: Options, incomingDbPath: string) {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  if (existsSync(options.dbPath) && options.backup) {
    renameSync(options.dbPath, `${options.dbPath}.backup-${timestampForFile()}`);
  } else if (existsSync(options.dbPath)) {
    rmSync(options.dbPath);
  }

  renameSync(incomingDbPath, options.dbPath);
  return {
    mode: "replace" as const,
    localRowsBefore: 0,
    localRowsAfter: countRows(options.dbPath),
    insertedOrUpdated: countRows(options.dbPath),
  };
}

function mergeDatabase(options: Options, incomingDbPath: string) {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  const db = new Database(options.dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    ensureAddressLabelsSchema(db);

    const localRowsBefore = db
      .prepare("SELECT COUNT(*) FROM address_project_labels")
      .pluck()
      .get() as number;
    db.prepare("ATTACH DATABASE ? AS incoming").run(incomingDbPath);

    const incomingRows = db
      .prepare("SELECT COUNT(*) FROM incoming.address_project_labels")
      .pluck()
      .get() as number;
    const insertOrUpdate = db.prepare(`
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
      SELECT
        chain_id,
        address,
        checksum_address,
        project,
        label,
        source,
        priority,
        updated_at
      FROM incoming.address_project_labels
      WHERE true
      ON CONFLICT (chain_id, address, project, source) DO UPDATE SET
        checksum_address = excluded.checksum_address,
        label = excluded.label,
        priority = excluded.priority,
        updated_at = excluded.updated_at
    `);

    const result = db.transaction(() => insertOrUpdate.run())();
    db.prepare("DETACH DATABASE incoming").run();
    db.pragma("optimize");

    const localRowsAfter = db
      .prepare("SELECT COUNT(*) FROM address_project_labels")
      .pluck()
      .get() as number;

    return {
      mode: "merge" as const,
      incomingRows,
      localRowsBefore,
      localRowsAfter,
      insertedOrUpdated: result.changes,
    };
  } finally {
    if (db.open) db.close();
  }
}

async function main() {
  loadEnvConfig(projectRoot());

  const options = readOptions();
  const manifest = await readManifest(options.manifestUrl);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "transaction-vis-labels-"));
  const archivePath = path.join(tmpDir, manifest.database.file);
  const incomingDbPath = path.join(tmpDir, "address-labels.sqlite");

  try {
    const assetUrl = joinReleaseUrl(options.releaseBaseUrl, manifest.database.file);
    await writeFile(path.join(tmpDir, DEFAULT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    await downloadToFile(assetUrl, archivePath);
    await verifySha256(archivePath, manifest.database.compressedSha256, "Compressed database");

    await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(incomingDbPath));
    await verifySha256(incomingDbPath, manifest.database.uncompressedSha256, "Database");

    const result =
      options.mode === "replace"
        ? replaceDatabase(options, incomingDbPath)
        : mergeDatabase(options, incomingDbPath);

    console.log(
      JSON.stringify(
        {
          dbPath: options.dbPath,
          version: manifest.version,
          source: manifest.source,
          releaseBaseUrl: options.releaseBaseUrl,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
