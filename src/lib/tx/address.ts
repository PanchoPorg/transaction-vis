import { getAddress, isAddress } from "ethers";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function toChecksumAddress(address: string) {
  if (!isAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  return getAddress(address);
}

export function normalizeAddressKey(address: string) {
  return toChecksumAddress(address).toLowerCase();
}

export function addressFromTopic(topic: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    throw new Error(`Invalid indexed address topic: ${topic}`);
  }

  return toChecksumAddress(`0x${topic.slice(-40)}`);
}

export function isZeroAddress(address: string) {
  return normalizeAddressKey(address) === ZERO_ADDRESS;
}
