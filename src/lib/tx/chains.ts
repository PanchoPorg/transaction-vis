export type ChainConfig = {
  id: string;
  name: string;
  nativeSymbol: string;
  explorerTxUrl: (txHash: string) => string;
  explorerAddressUrl: (address: string) => string;
};

export const ETHEREUM_MAINNET: ChainConfig = {
  id: "1",
  name: "Ethereum",
  nativeSymbol: "ETH",
  explorerTxUrl: (txHash) => `https://etherscan.io/tx/${txHash}`,
  explorerAddressUrl: (address) => `https://etherscan.io/address/${address}`,
};

export const SUPPORTED_CHAINS = [ETHEREUM_MAINNET] as const;
