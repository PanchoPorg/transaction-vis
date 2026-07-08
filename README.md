# Transaction Vis

Interactive Ethereum transaction transfer visualizer for tracing ETH, ERC-20, and internal value flows between addresses.

Transaction Vis turns a transaction hash into a directed graph of address nodes and transfer edges. It fetches transaction, receipt, token metadata, and internal transfer data through Etherscan, normalizes the transfer records, and renders an inspectable graph in a Next.js app.

## Features

- ETH, ERC-20, and internal transfer visualization
- Aggregated transfer edges between the same addresses
- Failed-transaction handling
- Clickable graph nodes and edges with transfer details
- Optional local SQLite address labels from published snapshots

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Set the required API key:

```bash
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Run the development server:

```bash
npm run download:address-labels
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Address Labels

Address labels are optional. The app looks for a local SQLite database at `data/address-labels.sqlite` by default. To download the latest published snapshot:

```bash
npm run download:address-labels
```

To update an existing database by merging new published rows while keeping local additions:

```bash
npm run update:address-labels
```

The default public data channel is:

```text
https://github.com/PanchoPorg/transaction-vis/releases/download/address-labels-latest/address-labels.sqlite.gz
```

The generated database is intentionally ignored by Git. Use `ADDRESS_LABELS_DB_PATH` to point the app at another database path.

## Scripts

```bash
npm run dev
npm run test
npm run lint
npm run build
npm run download:address-labels
npm run update:address-labels
```

## License

MIT
