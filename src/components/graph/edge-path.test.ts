import { describe, expect, it } from "vitest";
import { transferPath, type TransferPathParams } from "./edge-path";

function params(overrides: Partial<TransferPathParams> = {}): TransferPathParams {
  return {
    sourceX: 100,
    sourceY: 120,
    targetX: 700,
    targetY: 280,
    laneIndex: 0,
    laneCount: 1,
    fanoutIndex: 0,
    fanoutCount: 1,
    fanoutHub: null,
    fanoutOffset: 0,
    straightSource: false,
    straightTarget: false,
    sourceRouteOffset: null,
    targetRouteOffset: null,
    sourceId: "source",
    targetId: "target",
    ...overrides,
  };
}

function commandCount(path: string, command: "C" | "L") {
  return (path.match(new RegExp(`\\b${command}\\b`, "g")) ?? []).length;
}

describe("transferPath", () => {
  it("uses one horizontal segment and at most two curves for offset endpoints", () => {
    const { path } = transferPath(
      params({
        sourceRouteOffset: 72,
        targetRouteOffset: -128,
      }),
    );

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBeLessThanOrEqual(2);
  });

  it("keeps source-straight routes to one horizontal plus one target curve", () => {
    const { path } = transferPath(params({ straightSource: true }));

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(1);
  });

  it("keeps target-straight routes to one source curve plus one horizontal", () => {
    const { path } = transferPath(params({ straightTarget: true }));

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(1);
  });

  it("keeps centered same-level routes fully horizontal", () => {
    const { path } = transferPath(
      params({
        sourceY: 160,
        targetY: 160,
        straightSource: true,
        straightTarget: true,
      }),
    );

    expect(commandCount(path, "L")).toBe(1);
    expect(commandCount(path, "C")).toBe(0);
  });

  it("keeps labels aligned for routes to the same address column", () => {
    const straightTarget = transferPath(params({ straightTarget: true }));
    const curvedTarget = transferPath(params({ targetRouteOffset: -56 }));

    expect(curvedTarget.labelX).toBe(straightTarget.labelX);
  });
});
