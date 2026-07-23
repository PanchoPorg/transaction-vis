import { describe, expect, it } from "vitest";
import { transferPath, type TransferPathParams } from "./edge-path";

function params(overrides: Partial<TransferPathParams> = {}): TransferPathParams {
  return {
    sourceX: 100,
    sourceY: 120,
    targetX: 700,
    targetY: 280,
    routeY: 200,
    label: "[1] 2.06 WETH",
    labelBias: 0.5,
    sourceCurveMode: "default",
    targetCurveMode: "default",
    ...overrides,
  };
}

function commandCount(path: string, command: "C" | "L") {
  return (path.match(new RegExp(`\\b${command}\\b`, "g")) ?? []).length;
}

describe("transferPath", () => {
  it("uses one horizontal segment and at most two curves for offset endpoints", () => {
    const { path, horizontalMinX, horizontalMaxX } = transferPath(params());

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(2);
    expect(horizontalMinX).toBe(220);
    expect(horizontalMaxX).toBe(556);
  });

  it("keeps source-straight routes to one horizontal plus one target curve", () => {
    const { path, horizontalStartX, horizontalEndX } = transferPath(
      params({ routeY: 120 }),
    );

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(1);
    expect(horizontalStartX).toBe(100);
    expect(horizontalEndX).toBe(556);
  });

  it("keeps target-straight routes to one source curve plus one horizontal", () => {
    const { path, horizontalStartX, horizontalEndX } = transferPath(
      params({ routeY: 280 }),
    );

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(1);
    expect(horizontalStartX).toBe(220);
    expect(horizontalEndX).toBe(700);
  });

  it("keeps centered same-level routes fully horizontal", () => {
    const { path } = transferPath(
      params({
        sourceY: 160,
        targetY: 160,
        routeY: 160,
      }),
    );

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(0);
  });

  it("centers labels on the actual horizontal segment", () => {
    const straightTarget = transferPath(params({ routeY: 280 }));
    const curvedTarget = transferPath(params({ routeY: 224 }));

    expect(straightTarget.labelX).toBe(
      (straightTarget.horizontalStartX + straightTarget.horizontalEndX) / 2,
    );
    expect(curvedTarget.labelX).toBe(
      (curvedTarget.horizontalStartX + curvedTarget.horizontalEndX) / 2,
    );
    expect(curvedTarget.labelWidth).toBeGreaterThan(0);
    expect(curvedTarget.labelHeight).toBe(16);
  });
});
