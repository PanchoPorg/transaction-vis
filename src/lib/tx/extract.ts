import { addressFromTopic, toChecksumAddress } from "./address";
import { ERC20_TRANSFER_TOPIC, parseHexUint256 } from "./parse";

export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const WETH_DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
export const WETH_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

export type EtherscanReceiptLog = {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
  removed?: boolean;
};

export type RawErc20Transfer = {
  id: string;
  txHash: string;
  tokenAddress: string;
  from: string;
  to: string;
  valueRaw: string;
  index: number;
};

function logIndex(log: EtherscanReceiptLog, position: number) {
  return log.logIndex ? Number(BigInt(log.logIndex)) : position;
}

function addErc20TransferLog(
  transfers: RawErc20Transfer[],
  txHash: string,
  log: EtherscanReceiptLog,
  position: number,
) {
  if (log.topics.length !== 3) return;

  const index = logIndex(log, position);
  transfers.push({
    id: `erc20:${index}:${log.address.toLowerCase()}`,
    txHash,
    tokenAddress: toChecksumAddress(log.address),
    from: addressFromTopic(log.topics[1]),
    to: addressFromTopic(log.topics[2]),
    valueRaw: parseHexUint256(log.data),
    index,
  });
}

function addWethWrapEvent(
  transfers: RawErc20Transfer[],
  txHash: string,
  log: EtherscanReceiptLog,
  position: number,
) {
  if (log.address.toLowerCase() !== WETH_ADDRESS.toLowerCase()) return;
  if (log.topics.length !== 2) return;

  const topic0 = log.topics[0]?.toLowerCase();
  const index = logIndex(log, position);
  const account = addressFromTopic(log.topics[1]);
  const isDeposit = topic0 === WETH_DEPOSIT_TOPIC;
  const isWithdrawal = topic0 === WETH_WITHDRAWAL_TOPIC;

  if (!isDeposit && !isWithdrawal) return;

  const valueRaw = parseHexUint256(log.data);
  if (BigInt(valueRaw) === 0n) return;

  transfers.push({
    id: `weth-${isDeposit ? "deposit" : "withdrawal"}:${index}`,
    txHash,
    tokenAddress: WETH_ADDRESS,
    from: isDeposit ? WETH_ADDRESS : account,
    to: isDeposit ? account : WETH_ADDRESS,
    valueRaw,
    index,
  });
}

export function extractErc20Transfers(txHash: string, logs: EtherscanReceiptLog[]) {
  const transfers: RawErc20Transfer[] = [];

  logs.forEach((log, position) => {
    if (log.removed) return;
    const topic0 = log.topics[0]?.toLowerCase();

    try {
      if (topic0 === ERC20_TRANSFER_TOPIC) addErc20TransferLog(transfers, txHash, log, position);
      if (topic0 === WETH_DEPOSIT_TOPIC || topic0 === WETH_WITHDRAWAL_TOPIC) {
        addWethWrapEvent(transfers, txHash, log, position);
      }
    } catch {
      // Ignore malformed token-transfer-like logs instead of failing the whole trace.
    }
  });

  return transfers;
}
