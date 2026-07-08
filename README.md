# Transaction Vis

Interactive Ethereum transaction transfer visualizer for tracing ETH, ERC-20, and internal value flows between addresses.

Transaction Vis turns a transaction hash into a directed graph of address nodes and transfer edges. It fetches transaction, receipt, token metadata, and internal transfer data through Etherscan, normalizes the transfer records, and renders an inspectable graph in a Next.js app.

## Features

- ETH, ERC-20, and internal transfer visualization
- Aggregated transfer edges between the same addresses
- Failed-transaction handling
- Clickable graph nodes and edges with transfer details
- Optional local SQLite address labels imported from Dune

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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Address Labels

Address labels are optional. To import labels into a local SQLite database, set `DUNE_API_KEY` and run:

```bash
npm run import:address-labels
```

The generated database defaults to `data/address-labels.sqlite` and is intentionally ignored by Git. Use `ADDRESS_LABELS_DB_PATH` to point the app at another database path.

## Scripts

```bash
npm run dev
npm run test
npm run lint
npm run build
```

## License

MIT
