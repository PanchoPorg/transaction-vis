import { decodeBytes32String, toUtf8String } from "ethers";

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function parseBigNumberish(value: string | null | undefined) {
  if (!value) return 0n;
  return value.startsWith("0x") ? BigInt(value) : BigInt(value);
}

export function bigintToDecimalString(value: bigint) {
  return value.toString(10);
}

export function parseHexUint256(data: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(data)) {
    throw new Error(`Invalid uint256 data: ${data}`);
  }

  return BigInt(data).toString(10);
}

export function decodeStringResult(result: string) {
  if (!result || result === "0x") return null;

  const decodeBytes32 = () => {
    try {
      const decoded = decodeBytes32String(result).trim();
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  };

  try {
    const payload = result.startsWith("0x") ? result.slice(2) : result;
    const offset = Number.parseInt(payload.slice(0, 64), 16);
    const length = Number.parseInt(payload.slice(offset * 2, offset * 2 + 64), 16);
    const valueHex = `0x${payload.slice(offset * 2 + 64, offset * 2 + 64 + length * 2)}`;
    const decoded = toUtf8String(valueHex).replace(/\0/g, "").trim();
    return decoded.length > 0 ? decoded : decodeBytes32();
  } catch {
    return decodeBytes32();
  }
}

export function decodeDecimalsResult(result: string) {
  if (!/^0x[0-9a-fA-F]+$/.test(result) || result === "0x") return null;

  try {
    const decimals = Number(BigInt(result));
    return Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 255
      ? decimals
      : null;
  } catch {
    return null;
  }
}
