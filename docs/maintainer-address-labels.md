# Address Labels Maintainer Flow

GitHub Releases are only the public distribution channel for ready-made address label database snapshots. Dataset construction happens locally.

## Local Import

Set local Dune credentials in `.env.local` or the shell, then merge new rows into the existing SQLite database:

```bash
npm run maintain:address-labels:import -- --query-id=7868214 --project="Uniswap V3" --label="Uniswap V3"
```

The import is an upsert into `data/address-labels.sqlite` by default. It creates the schema if needed, keeps unrelated local rows, and updates rows that match the table primary key.

Use `--db=/path/to/address-labels.sqlite` to update another database.

If Dune rate-limits a run, rerun the same command later. Already imported rows are updated in place rather than duplicated.

## Package

Package the current SQLite database into release assets:

```bash
npm run maintain:address-labels:package -- --version=YYYYMMDDTHHMMSSZ
```

This writes:

```text
dist/address-labels/address-labels.sqlite.gz
dist/address-labels/address-labels.manifest.json
```

The manifest contains only version, schema version, creation time, row count, checksums, and sizes.

## Publish

Publish the packaged assets to the stable release:

```bash
npm run maintain:address-labels:publish
```

The publish script requires an authenticated GitHub CLI session. It updates the `address-labels-latest` release notes and uploads `address-labels.sqlite.gz` plus `address-labels.manifest.json` with `--clobber`.
