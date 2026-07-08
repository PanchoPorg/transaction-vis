import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REPOSITORY = "PanchoPorg/transaction-vis";
const DEFAULT_RELEASE_TAG = "address-labels-latest";
const DEFAULT_RELEASE_TITLE = "Address labels latest";
const DEFAULT_OUT_DIR = path.join(process.cwd(), "dist", "address-labels");
const DEFAULT_ASSET_NAME = "address-labels.sqlite.gz";
const DEFAULT_MANIFEST_NAME = "address-labels.manifest.json";

type ReleaseManifest = {
  version: string;
  schemaVersion: number;
  createdAt: string;
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
  repository: string;
  tag: string;
  title: string;
  outDir: string;
};

function readOption(name: string) {
  const prefix = `--${name}=`;
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readOptions(): Options {
  return {
    repository: readOption("repo") ?? DEFAULT_REPOSITORY,
    tag: readOption("tag") ?? DEFAULT_RELEASE_TAG,
    title: readOption("title") ?? DEFAULT_RELEASE_TITLE,
    outDir: readOption("out-dir") ?? DEFAULT_OUT_DIR,
  };
}

function run(command: string, args: string[], options: { capture?: boolean } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr.trim() : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  return result.stdout?.trim() ?? "";
}

function releaseExists(options: Options) {
  const result = spawnSync(
    "gh",
    ["release", "view", options.tag, "--repo", options.repository],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

function readManifest(manifestPath: string): ReleaseManifest {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest;
  if (manifest.schemaVersion !== 1 || manifest.database.file !== DEFAULT_ASSET_NAME) {
    throw new Error("Unsupported address labels manifest.");
  }
  return manifest;
}

function writeReleaseNotes(options: Options, manifest: ReleaseManifest, notesPath: string) {
  const downloadUrl = `https://github.com/${options.repository}/releases/download/${options.tag}/${DEFAULT_ASSET_NAME}`;
  writeFileSync(
    notesPath,
    [
      "Current address labels snapshot for Transaction Vis.",
      "",
      `- Version: ${manifest.version}`,
      `- Rows: ${manifest.rowCount}`,
      `- Asset: ${DEFAULT_ASSET_NAME}`,
      `- Manifest: ${DEFAULT_MANIFEST_NAME}`,
      "",
      "Stable download URL:",
      downloadUrl,
      "",
    ].join("\n"),
    "utf8",
  );
}

function ensureFile(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Required release asset does not exist: ${filePath}`);
  }
}

function main() {
  const options = readOptions();
  const assetPath = path.join(options.outDir, DEFAULT_ASSET_NAME);
  const manifestPath = path.join(options.outDir, DEFAULT_MANIFEST_NAME);

  ensureFile(assetPath);
  ensureFile(manifestPath);
  run("gh", ["auth", "status"]);

  const manifest = readManifest(manifestPath);
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "transaction-vis-release-"));
  const notesPath = path.join(tmpDir, "address-labels-release-notes.md");

  try {
    writeReleaseNotes(options, manifest, notesPath);

    if (releaseExists(options)) {
      run("gh", [
        "release",
        "edit",
        options.tag,
        "--repo",
        options.repository,
        "--title",
        options.title,
        "--notes-file",
        notesPath,
        "--latest",
      ]);
    } else {
      const target = run("git", ["rev-parse", "HEAD"], { capture: true });
      run("gh", [
        "release",
        "create",
        options.tag,
        "--repo",
        options.repository,
        "--target",
        target,
        "--title",
        options.title,
        "--notes-file",
        notesPath,
        "--latest",
      ]);
    }

    run("gh", [
      "release",
      "upload",
      options.tag,
      assetPath,
      manifestPath,
      "--repo",
      options.repository,
      "--clobber",
    ]);

    console.log(
      JSON.stringify(
        {
          repository: options.repository,
          tag: options.tag,
          version: manifest.version,
          rowCount: manifest.rowCount,
          uploaded: [assetPath, manifestPath],
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
