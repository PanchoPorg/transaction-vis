import { ETHEREUM_MAINNET } from "./chains";
import { etherscanRequest, TraceError } from "./etherscan";
import { extractErc20Transfers, type EtherscanReceiptLog } from "./extract";
import { getTokenMetadata } from "./metadata";
import {
  normalizeTrace,
  type EtherscanInternalTx,
  type EtherscanReceipt,
  type EtherscanTransaction,
} from "./normalize";
import type { TokenMetadata, TxTraceResponse } from "./types";

type ProxyResponse<T> = {
  jsonrpc: string;
  id: number;
  result: T | null;
  error?: { code: number; message: string };
};

type AccountResponse<T> = {
  status: "0" | "1";
  message: string;
  result: T | string;
};

type ReceiptWithLogs = EtherscanReceipt & {
  logs?: EtherscanReceiptLog[];
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const traceCache = new Map<string, { expiresAt: number; value: TxTraceResponse }>();

function ensureTxHash(txHash: string) {
  const normalized = txHash.trim();
  if (!TX_HASH_PATTERN.test(normalized)) {
    throw new TraceError("invalid-tx-hash", "Enter a valid 32-byte transaction hash.", 400);
  }
  return normalized.toLowerCase();
}

function handleProxyResponse<T>(response: ProxyResponse<T>, label: string) {
  if (response.error) {
    throw new TraceError("etherscan-proxy-error", response.error.message, 502);
  }
  if (!response.result) {
    throw new TraceError("tx-not-found", `${label} was not found for this hash.`, 404);
  }
  return response.result;
}

function handleAccountResponse<T>(response: AccountResponse<T>, fallback: T) {
  if (response.status === "1") return response.result as T;

  const message = `${response.message}: ${String(response.result)}`;
  if (/no transactions found/i.test(message)) return fallback;
  if (/rate limit/i.test(message)) {
    throw new TraceError("etherscan-rate-limit", message, 429);
  }
  if (/invalid api key/i.test(message)) {
    throw new TraceError("invalid-api-key", message, 401);
  }

  throw new TraceError("etherscan-account-error", message, 502);
}

async function getTransaction(txHash: string, chainId: string) {
  const response = await etherscanRequest<ProxyResponse<EtherscanTransaction>>({
    chainid: chainId,
    module: "proxy",
    action: "eth_getTransactionByHash",
    txhash: txHash,
  });

  return handleProxyResponse(response, "Transaction");
}

async function getReceipt(txHash: string, chainId: string) {
  const response = await etherscanRequest<ProxyResponse<ReceiptWithLogs>>({
    chainid: chainId,
    module: "proxy",
    action: "eth_getTransactionReceipt",
    txhash: txHash,
  });

  return handleProxyResponse(response, "Transaction receipt");
}

async function getInternalTransfers(txHash: string, chainId: string) {
  const response = await etherscanRequest<AccountResponse<EtherscanInternalTx[]>>({
    chainid: chainId,
    module: "account",
    action: "txlistinternal",
    txhash: txHash,
  });

  return handleAccountResponse(response, []);
}

export async function buildTrace(txHashInput: string) {
  const txHash = ensureTxHash(txHashInput);
  const chainId = ETHEREUM_MAINNET.id;
  const cacheKey = `${chainId}:${txHash}`;
  const cached = traceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [transaction, receipt, internalTxs] = await Promise.all([
    getTransaction(txHash, chainId),
    getReceipt(txHash, chainId),
    getInternalTransfers(txHash, chainId),
  ]);

  const isFailed = receipt.status === "0x0" || receipt.status === "0";
  const erc20Transfers = isFailed ? [] : extractErc20Transfers(txHash, receipt.logs ?? []);
  const tokenAddresses = [...new Set(erc20Transfers.map((transfer) => transfer.tokenAddress))];
  const metadataEntries = await Promise.all(
    tokenAddresses.map(async (address) => {
      const metadata = await getTokenMetadata(chainId, address);
      return [metadata.address.toLowerCase(), metadata] as const;
    }),
  );
  const tokenMetadata = new Map<string, TokenMetadata>(metadataEntries);

  const trace = normalizeTrace({
    chainId,
    transaction,
    receipt,
    internalTxs,
    erc20Transfers,
    tokenMetadata,
    warnings: isFailed
      ? ["Transaction execution failed; completed token/native transfer events are omitted."]
      : [],
  });

  traceCache.set(cacheKey, { value: trace, expiresAt: Date.now() + 5 * 60 * 1000 });
  return trace;
}

export function __resetTraceCacheForTests() {
  traceCache.clear();
}
