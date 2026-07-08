import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "./format";

describe("formatTokenAmount", () => {
  it("groups whole amounts and keeps two decimals by default", () => {
    expect(formatTokenAmount("100000000000000000000000000", 18)).toBe("100,000,000.00");
  });

  it("rounds amounts to the nearest displayed decimal", () => {
    expect(formatTokenAmount("123456789", 6)).toBe("123.46");
  });

  it("uses four decimals for positive fractional amounts below one", () => {
    expect(formatTokenAmount("123456789000000", 18)).toBe("0.0001");
  });

  it("keeps zero at the default precision", () => {
    expect(formatTokenAmount("0", 18)).toBe("0.00");
  });

  it("returns the original value when it cannot be parsed", () => {
    expect(formatTokenAmount("not-a-number", 18)).toBe("not-a-number");
  });
});
