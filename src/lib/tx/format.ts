export function shortAddress(address: string, size = 6) {
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}...${address.slice(-size)}`;
}

function decimalScale(decimals: number) {
  return 10n ** BigInt(decimals);
}

function groupThousands(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatTokenAmount(valueRaw: string, decimals: number) {
  try {
    if (!Number.isInteger(decimals) || decimals < 0) return valueRaw;

    const raw = BigInt(valueRaw);
    const sign = raw < 0n ? "-" : "";
    const absoluteRaw = raw < 0n ? -raw : raw;
    const scale = decimalScale(decimals);
    const precision = absoluteRaw > 0n && absoluteRaw < scale ? 4 : 2;
    const displayScale = decimalScale(precision);
    const rounded = (absoluteRaw * displayScale + scale / 2n) / scale;
    const whole = rounded / displayScale;
    const fraction = (rounded % displayScale).toString().padStart(precision, "0");

    return `${sign}${groupThousands(whole.toString())}.${fraction}`;
  } catch {
    return valueRaw;
  }
}

export function joinKinds(kinds: string[]) {
  return [...new Set(kinds)].join(", ");
}
