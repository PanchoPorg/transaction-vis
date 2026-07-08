export type TransferKind = "topLevelCall" | "native" | "internal" | "erc20";

export type AddressRole = "sender" | "receiver" | "token" | "contract" | "internal";

export type TokenMetadata = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  warnings: string[];
};

export type NormalizedTx = {
  hash: string;
  chainId: string;
  from: string;
  to: string | null;
  valueRaw: string;
  status: "success" | "failed" | "pending" | "unknown";
  blockNumber: string | null;
};

export type AddressProjectLabel = {
  chainId: string;
  address: string;
  project: string;
  label: string;
  source: string;
  priority: number;
};

export type TransferRecord = {
  id: string;
  kind: TransferKind;
  txHash: string;
  from: string;
  to: string;
  assetKey: string;
  tokenAddress: string | null;
  tokenName: string | null;
  symbol: string;
  decimals: number;
  valueRaw: string;
  valueFormatted: string;
  label: string;
  index: number;
  displayIndex: number | null;
  failed: boolean;
  metadataWarnings: string[];
};

export type AddressNodeRecord = {
  id: string;
  address: string;
  shortAddress: string;
  label: string;
  projectLabel?: string;
  projectLabels?: AddressProjectLabel[];
  roles: AddressRole[];
  transferCount: number;
  outgoingCount: number;
  incomingCount: number;
};

export type AssetAggregate = {
  assetKey: string;
  symbol: string;
  decimals: number;
  tokenAddress: string | null;
  valueRaw: string;
  valueFormatted: string;
  transferCount: number;
};

export type TransferEdgeRecord = {
  id: string;
  source: string;
  target: string;
  label: string;
  displayIndexes: Array<number | null>;
  transferIds: string[];
  kinds: TransferKind[];
  transferCount: number;
  assets: AssetAggregate[];
  hasFailed: boolean;
};

export type TxTraceResponse = {
  tx: NormalizedTx;
  transfers: TransferRecord[];
  nodes: AddressNodeRecord[];
  edges: TransferEdgeRecord[];
  warnings: string[];
};

export type TraceApiError = {
  error: string;
  code: string;
  warnings?: string[];
};
