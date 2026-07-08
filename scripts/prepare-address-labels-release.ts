import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import Database from "better-sqlite3";
import { DEFAULT_ADDRESS_LABELS_DB_PATH } from "../src/lib/address-labels";

const DEFAULT_OUT_DIR = path.join(process.cwd(), "dist", "address-labels");
const DEFAULT_ASSET_NAME = "address-labels.sqlite.gz";
const DEFAULT_MANIFEST_NAME = "address-labels.manifest.json";
const DEFAULT_SOURCE = "dune:query:7868214";

type Options = {
  dbPath: string;
  outDir: string;
  version: string;
  source: string;
  assetName: string;
  manifestName: string;
};

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

function readOption(name: string) {
  const prefix = `--${name}=`;
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function defaultVersion() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readOptions(): Options {
  return {
    dbPath: readOption("db") ?? process.env.ADDRESS_LABELS_DB_PATH ?? DEFAULT_ADDRESS_LABELS_DB_PATH,
    outDir: readOption("out-dir") ?? DEFAULT_OUT_DIR,
    version: readOption("version") ?? defaultVersion(),
    source: readOption("source") ?? DEFAULT_SOURCE,
    assetName: readOption("asset-name") ?? DEFAULT_ASSET_NAME,
    manifestName: readOption("manifest-name") ?? DEFAULT_MANIFEST_NAME,
  };
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

function readRowCount(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").pluck().get();
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity_check failed: ${String(integrity)}`);
    }

    return db.prepare("SELECT COUNT(*) FROM address_project_labels").pluck().get() as number;
  } finally {
    db.close();
  }
}

async function main() {
  const options = readOptions();
  if (!existsSync(options.dbPath)) {
    throw new Error(`Address labels database does not exist: ${options.dbPath}`);
  }

  mkdirSync(options.outDir, { recursive: true });

  const assetPath = path.join(options.outDir, options.assetName);
  const manifestPath = path.join(options.outDir, options.manifestName);
  const rowCount = readRowCount(options.dbPath);

  await pipeline(
    createReadStream(options.dbPath),
    createGzip({ level: 9 }),
    createWriteStream(assetPath),
  );

  const manifest: ReleaseManifest = {
    version: options.version,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: options.source,
    rowCount,
    database: {
      file: options.assetName,
      compressedSha256: await sha256(assetPath),
      uncompressedSha256: await sha256(options.dbPath),
      compressedSize: statSync(assetPath).size,
      uncompressedSize: statSync(options.dbPath).size,
    },
  };

  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  );

  console.log(
    JSON.stringify(
      {
        assetPath,
        manifestPath,
        version: manifest.version,
        rowCount: manifest.rowCount,
        compressedSize: manifest.database.compressedSize,
        uncompressedSize: manifest.database.uncompressedSize,
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
