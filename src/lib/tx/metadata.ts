import { etherscanRequest, TraceError } from "./etherscan";
import { decodeDecimalsResult, decodeStringResult } from "./parse";
import { shortAddress } from "./format";
import { toChecksumAddress } from "./address";
import type { TokenMetadata } from "./types";

type EthCallResponse = {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: { code: number; message: string };
};

const NAME_SELECTOR = "0x06fdde03";
const SYMBOL_SELECTOR = "0x95d89b41";
const DECIMALS_SELECTOR = "0x313ce567";
const metadataCache = new Map<string, TokenMetadata>();

async function ethCall(chainId: string, to: string, data: string) {
  const json = await etherscanRequest<EthCallResponse>(
    {
      chainid: chainId,
      module: "proxy",
      action: "eth_call",
      to,
      data,
      tag: "latest",
    },
    { cacheTtlMs: 60 * 60 * 1000 },
  );

  if (json.error) {
    throw new TraceError("etherscan-eth-call-error", json.error.message, 502);
  }

  return json.result ?? "0x";
}

export async function getTokenMetadata(chainId: string, contractAddress: string) {
  const address = toChecksumAddress(contractAddress);
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

  const warnings: string[] = [];
  const [nameResult, symbolResult, decimalsResult] = await Promise.allSettled([
    ethCall(chainId, address, NAME_SELECTOR),
    ethCall(chainId, address, SYMBOL_SELECTOR),
    ethCall(chainId, address, DECIMALS_SELECTOR),
  ]);

  const name =
    nameResult.status === "fulfilled" ? decodeStringResult(nameResult.value) : null;
  const symbol =
    symbolResult.status === "fulfilled"
      ? decodeStringResult(symbolResult.value)
      : null;
  const decimals =
    decimalsResult.status === "fulfilled"
      ? decodeDecimalsResult(decimalsResult.value)
      : null;

  if (!name) warnings.push(`Token name fallback used for ${address}.`);
  if (!symbol) warnings.push(`Token symbol fallback used for ${address}.`);
  if (decimals === null) warnings.push(`Token decimals fallback 18 used for ${address}.`);

  const metadata: TokenMetadata = {
    address,
    name: name ?? `Token ${shortAddress(address, 4)}`,
    symbol: symbol ?? "TOKEN",
    decimals: decimals ?? 18,
    warnings,
  };

  metadataCache.set(cacheKey, metadata);
  return metadata;
}

export function __resetMetadataForTests() {
  metadataCache.clear();
}
