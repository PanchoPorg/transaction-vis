import { toChecksumAddress } from "./address";
import { formatTokenAmount, shortAddress } from "./format";
import { bigintToDecimalString, parseBigNumberish } from "./parse";
import { WETH_ADDRESS, type RawErc20Transfer } from "./extract";
import type {
  AddressNodeRecord,
  AddressRole,
  AssetAggregate,
  NormalizedTx,
  TokenMetadata,
  TransferEdgeRecord,
  TransferKind,
  TransferRecord,
  TxTraceResponse,
} from "./types";

export type EtherscanTransaction = {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  blockNumber?: string | null;
};

export type EtherscanReceipt = {
  status?: string;
  contractAddress?: string | null;
  blockNumber?: string | null;
};

export type EtherscanInternalTx = {
  from: string;
  to: string;
  value: string;
  isError?: string;
  errCode?: string;
};

type MutableNode = AddressNodeRecord & {
  roleSet: Set<AddressRole>;
};

type MutableEdge = Omit<TransferEdgeRecord, "kinds" | "assets"> & {
  kindSet: Set<TransferKind>;
  assetMap: Map<string, AssetAggregate>;
};

function nativeTransferKey(from: string, to: string, valueRaw: string) {
  return `${from.toLowerCase()}->${to.toLowerCase()}:${valueRaw}`;
}

function statusFromReceipt(receipt: EtherscanReceipt): NormalizedTx["status"] {
  if (!receipt.status) return "unknown";
  if (receipt.status === "0x1" || receipt.status === "1") return "success";
  if (receipt.status === "0x0" || receipt.status === "0") return "failed";
  return "unknown";
}

function makeTx(transaction: EtherscanTransaction, receipt: EtherscanReceipt, chainId: string) {
  const to = transaction.to ?? receipt.contractAddress ?? null;

  return {
    hash: transaction.hash,
    chainId,
    from: toChecksumAddress(transaction.from),
    to: to ? toChecksumAddress(to) : null,
    valueRaw: bigintToDecimalString(parseBigNumberish(transaction.value)),
    status: statusFromReceipt(receipt),
    blockNumber: transaction.blockNumber ?? receipt.blockNumber ?? null,
  } satisfies NormalizedTx;
}

function transferLabel(valueFormatted: string, symbol: string, kind: TransferKind, failed: boolean) {
  if (failed) return `failed call`;
  if (kind === "topLevelCall") return `${valueFormatted} ${symbol} call`;
  return `${valueFormatted} ${symbol}`;
}

function addNativeTransfer(
  transfers: TransferRecord[],
  tx: NormalizedTx,
  kind: TransferKind,
  from: string,
  to: string,
  valueRaw: string,
  index: number,
  failed = false,
  ordered = true,
  idIndex = index,
) {
  const valueFormatted = formatTokenAmount(valueRaw, 18);
  transfers.push({
    id: `${kind}:${idIndex}`,
    kind,
    txHash: tx.hash,
    from,
    to,
    assetKey: "native:ETH",
    tokenAddress: null,
    tokenName: null,
    symbol: "ETH",
    decimals: 18,
    valueRaw,
    valueFormatted,
    label: transferLabel(valueFormatted, "ETH", kind, failed),
    index,
    displayIndex: ordered ? index + 1 : null,
    failed,
    metadataWarnings: [],
  });
}

function nodeLabel(address: string, roles: AddressRole[]) {
  if (roles.includes("sender")) return "Sender";
  if (roles.includes("receiver")) return "Receiver";
  if (roles.includes("token")) return "Token";
  if (roles.includes("contract")) return "Contract";
  return shortAddress(address);
}

function addNode(
  nodeMap: Map<string, MutableNode>,
  address: string,
  role: AddressRole,
  direction: "incoming" | "outgoing" | "both",
) {
  const id = address.toLowerCase();
  const existing = nodeMap.get(id);
  if (existing) {
    existing.roleSet.add(role);
    existing.roles = [...existing.roleSet];
    existing.label = nodeLabel(existing.address, existing.roles);
    existing.transferCount += 1;
    if (direction === "incoming" || direction === "both") existing.incomingCount += 1;
    if (direction === "outgoing" || direction === "both") existing.outgoingCount += 1;
    return;
  }

  const roleSet = new Set<AddressRole>([role]);
  nodeMap.set(id, {
    id,
    address,
    shortAddress: shortAddress(address),
    label: nodeLabel(address, [...roleSet]),
    roles: [...roleSet],
    roleSet,
    transferCount: 1,
    incomingCount: direction === "incoming" || direction === "both" ? 1 : 0,
    outgoingCount: direction === "outgoing" || direction === "both" ? 1 : 0,
  });
}

function addAssetAggregate(edge: MutableEdge, transfer: TransferRecord) {
  const existing = edge.assetMap.get(transfer.assetKey);
  if (existing) {
    const nextRaw = BigInt(existing.valueRaw) + BigInt(transfer.valueRaw);
    existing.valueRaw = nextRaw.toString(10);
    existing.valueFormatted = formatTokenAmount(existing.valueRaw, existing.decimals);
    existing.transferCount += 1;
    return;
  }

  edge.assetMap.set(transfer.assetKey, {
    assetKey: transfer.assetKey,
    symbol: transfer.symbol,
    decimals: transfer.decimals,
    tokenAddress: transfer.tokenAddress,
    valueRaw: transfer.valueRaw,
    valueFormatted: transfer.valueFormatted,
    transferCount: 1,
  });
}

function displayIndexLabel(indexes: Array<number | null>) {
  const hasUnknownIndex = indexes.includes(null);
  const sortedIndexes = [...new Set(indexes.filter((index): index is number => index !== null))].sort(
    (a, b) => a - b,
  );

  if (sortedIndexes.length === 0) return hasUnknownIndex ? "[?]" : "";

  let knownLabel: string;
  if (sortedIndexes.length === 1) knownLabel = `${sortedIndexes[0]}`;
  else {
    const isContiguous = sortedIndexes.every(
      (index, position) => position === 0 || index === sortedIndexes[position - 1] + 1,
    );

    knownLabel = isContiguous
      ? `${sortedIndexes[0]}-${sortedIndexes[sortedIndexes.length - 1]}`
      : sortedIndexes.join(",");
  }

  return `[${knownLabel}${hasUnknownIndex ? ",?" : ""}]`;
}

function edgeLabel(edge: MutableEdge) {
  const assets = [...edge.assetMap.values()];
  const prefix = displayIndexLabel(edge.displayIndexes);
  if (edge.hasFailed) return `${prefix} failed call`.trim();

  let valueLabel: string;
  if (assets.length === 1) {
    const suffix = edge.transferCount > 1 ? ` · ${edge.transferCount} txs` : "";
    valueLabel = `${assets[0].valueFormatted} ${assets[0].symbol}${suffix}`;
  } else {
    valueLabel = `${edge.transferCount} transfers · ${assets.map((asset) => asset.symbol).join(", ")}`;
  }

  return `${prefix} ${valueLabel}`.trim();
}

function edgeGroupKey(transfer: TransferRecord) {
  if (transfer.kind === "topLevelCall") return "top-level-call";
  return transfer.assetKey;
}

function wethNativeEventIndexQueues(erc20Transfers: RawErc20Transfer[]) {
  const queues = new Map<string, number[]>();

  erc20Transfers
    .filter((transfer) => transfer.tokenAddress.toLowerCase() === WETH_ADDRESS.toLowerCase())
    .sort((a, b) => a.index - b.index)
    .forEach((transfer) => {
      let key: string | null = null;

      if (transfer.id.startsWith("weth-deposit:")) {
        key = nativeTransferKey(transfer.to, WETH_ADDRESS, transfer.valueRaw);
      } else if (transfer.id.startsWith("weth-withdrawal:")) {
        key = nativeTransferKey(WETH_ADDRESS, transfer.from, transfer.valueRaw);
      }

      if (!key) return;

      const queue = queues.get(key) ?? [];
      queue.push(transfer.index);
      queues.set(key, queue);
    });

  return queues;
}

function aggregate(transfers: TransferRecord[], tx: NormalizedTx) {
  const nodeMap = new Map<string, MutableNode>();
  const edgeMap = new Map<string, MutableEdge>();

  transfers.forEach((transfer) => {
    const fromRole: AddressRole =
      transfer.from.toLowerCase() === tx.from.toLowerCase() ? "sender" : "internal";
    const toRole: AddressRole =
      tx.to && transfer.to.toLowerCase() === tx.to.toLowerCase() ? "receiver" : "internal";

    addNode(nodeMap, transfer.from, fromRole, "outgoing");
    addNode(nodeMap, transfer.to, toRole, "incoming");

    const source = transfer.from.toLowerCase();
    const target = transfer.to.toLowerCase();
    const groupKey = edgeGroupKey(transfer);
    const edgeId = `edge:${source}->${target}:${groupKey}`;
    const existing = edgeMap.get(edgeId);

    if (existing) {
      existing.transferIds.push(transfer.id);
      existing.displayIndexes.push(transfer.displayIndex);
      existing.kindSet.add(transfer.kind);
      existing.transferCount += 1;
      existing.hasFailed = existing.hasFailed || transfer.failed;
      addAssetAggregate(existing, transfer);
      return;
    }

    const edge: MutableEdge = {
      id: edgeId,
      source,
      target,
      label: transfer.label,
      displayIndexes: [transfer.displayIndex],
      transferIds: [transfer.id],
      kindSet: new Set([transfer.kind]),
      transferCount: 1,
      assetMap: new Map(),
      hasFailed: transfer.failed,
    };
    addAssetAggregate(edge, transfer);
    edgeMap.set(edgeId, edge);
  });

  const nodes = [...nodeMap.values()].map((node) => ({
    id: node.id,
    address: node.address,
    shortAddress: node.shortAddress,
    label: node.label,
    roles: node.roles,
    transferCount: node.transferCount,
    outgoingCount: node.outgoingCount,
    incomingCount: node.incomingCount,
  }));
  const edges: TransferEdgeRecord[] = [...edgeMap.values()].map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edgeLabel(edge),
    displayIndexes: [...new Set(edge.displayIndexes)].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    }),
    transferIds: edge.transferIds,
    kinds: [...edge.kindSet],
    transferCount: edge.transferCount,
    assets: [...edge.assetMap.values()],
    hasFailed: edge.hasFailed,
  }));

  return { nodes, edges };
}

function withDisplayIndexes(transfers: TransferRecord[]) {
  const ordered = transfers
    .map((transfer, position) => ({ transfer, position }))
    .filter(({ transfer }) => transfer.displayIndex !== null)
    .sort((a, b) => a.transfer.index - b.transfer.index || a.position - b.position);
  const indexesByTransferId = new Map(
    ordered.map(({ transfer }, position) => [transfer.id, position + 1]),
  );

  return transfers.map((transfer) => ({
    ...transfer,
    displayIndex:
      transfer.displayIndex === null ? null : (indexesByTransferId.get(transfer.id) ?? transfer.index + 1),
  }));
}

export function normalizeTrace(input: {
  chainId: string;
  transaction: EtherscanTransaction;
  receipt: EtherscanReceipt;
  internalTxs: EtherscanInternalTx[];
  erc20Transfers: RawErc20Transfer[];
  tokenMetadata: Map<string, TokenMetadata>;
  warnings?: string[];
}): TxTraceResponse {
  const warnings = [...(input.warnings ?? [])];
  const tx = makeTx(input.transaction, input.receipt, input.chainId);
  const transfers: TransferRecord[] = [];
  const isFailed = tx.status === "failed";
  const wethNativeIndexes = wethNativeEventIndexQueues(input.erc20Transfers);

  if (tx.to) {
    const topLevelKind: TransferKind =
      !isFailed && BigInt(tx.valueRaw) > 0n ? "native" : "topLevelCall";
    addNativeTransfer(transfers, tx, topLevelKind, tx.from, tx.to, tx.valueRaw, 0, isFailed);
  } else {
    warnings.push("Top-level transaction target is missing; no top-level edge was created.");
  }

  if (!isFailed) {
    input.internalTxs
      .filter((internalTx) => internalTx.isError !== "1" && BigInt(internalTx.value || "0") > 0n)
      .forEach((internalTx, index) => {
        try {
          const from = toChecksumAddress(internalTx.from);
          const to = toChecksumAddress(internalTx.to);
          const valueRaw = BigInt(internalTx.value).toString(10);
          const wethEventIndex = wethNativeIndexes.get(nativeTransferKey(from, to, valueRaw))?.shift();
          addNativeTransfer(
            transfers,
            tx,
            "internal",
            from,
            to,
            valueRaw,
            wethEventIndex ?? index + 1,
            false,
            wethEventIndex !== undefined,
            index + 1,
          );
        } catch {
          warnings.push(`Ignored malformed internal transfer at index ${index}.`);
        }
      });

    input.erc20Transfers.forEach((transfer) => {
      const metadata = input.tokenMetadata.get(transfer.tokenAddress.toLowerCase());
      const symbol = metadata?.symbol ?? "TOKEN";
      const decimals = metadata?.decimals ?? 18;
      const valueFormatted = formatTokenAmount(transfer.valueRaw, decimals);
      const metadataWarnings = metadata?.warnings ?? [
        `Token metadata missing for ${transfer.tokenAddress}; fallback used.`,
      ];
      warnings.push(...metadataWarnings);

      transfers.push({
        id: transfer.id,
        kind: "erc20",
        txHash: tx.hash,
        from: transfer.from,
        to: transfer.to,
        assetKey: `erc20:${transfer.tokenAddress.toLowerCase()}`,
        tokenAddress: transfer.tokenAddress,
        tokenName: metadata?.name ?? null,
        symbol,
        decimals,
        valueRaw: transfer.valueRaw,
        valueFormatted,
        label: `${valueFormatted} ${symbol}`,
        index: transfer.index,
        displayIndex: transfer.index + 1,
        failed: false,
        metadataWarnings,
      });
    });
  }

  const indexedTransfers = withDisplayIndexes(transfers);
  const { nodes, edges } = aggregate(indexedTransfers, tx);

  return {
    tx,
    transfers: indexedTransfers,
    nodes,
    edges,
    warnings: [...new Set(warnings)],
  };
}
