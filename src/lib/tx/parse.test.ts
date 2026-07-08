import { describe, expect, it } from "vitest";
import { decodeDecimalsResult, decodeStringResult } from "./parse";

describe("token metadata decoding", () => {
  it("decodes ABI string results", () => {
    expect(
      decodeStringResult(
        "0x0000000000000000000000000000000000000000000000000000000000000020" +
          "0000000000000000000000000000000000000000000000000000000000000004" +
          "5553444300000000000000000000000000000000000000000000000000000000",
      ),
    ).toBe("USDC");
  });

  it("decodes bytes32 string results", () => {
    expect(
      decodeStringResult(
        "0x5553444300000000000000000000000000000000000000000000000000000000",
      ),
    ).toBe("USDC");
  });

  it("decodes decimals safely", () => {
    expect(decodeDecimalsResult("0x06")).toBe(6);
    expect(decodeDecimalsResult("0x")).toBeNull();
  });
});
