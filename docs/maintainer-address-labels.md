# Address Labels Maintainer Flow

GitHub Releases are only the public distribution channel for ready-made address label database snapshots. Dataset construction happens locally.

## Local Dataset

Build or update the address label dataset outside this public repository with the private local mini-service. The finished SQLite database should be available at `data/address-labels.sqlite` by default, or passed with `--db=/path/to/address-labels.sqlite` when packaging.

This repository only packages and publishes ready-made SQLite snapshots. It does not contain dataset-source integrations or dataset construction jobs.

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
