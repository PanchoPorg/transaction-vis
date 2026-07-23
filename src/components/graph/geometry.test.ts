import { describe, expect, it } from "vitest";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  edgeLabelGeometry,
  edgeRouteGeometry,
  pathIntersectsRect,
  pathsIntersect,
  portPoint,
  type EdgeRouteSegment,
} from "./geometry";

describe("graph route geometry", () => {
  it("uses an explicit dynamic port ratio as the endpoint coordinate", () => {
    const position = { x: 100, y: 200 };

    expect(portPoint(position, "dynamic:source:edge:right", 0.5)).toEqual({
      x: 100 + NODE_WIDTH,
      y: 200 + NODE_HEIGHT * 0.5,
    });
    expect(portPoint(position, "dynamic:target:edge:left", 0.43)).toEqual({
      x: 100,
      y: 200 + NODE_HEIGHT * 0.43,
    });
  });

  it("keeps a valid right-side route outside its endpoint boxes", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 708, y: 180 };
    const sourcePoint = portPoint(source, "out-right");
    const targetPoint = portPoint(target, "in-left");
    const geometry = edgeRouteGeometry({
      sourceX: sourcePoint.x,
      sourceY: sourcePoint.y,
      targetX: targetPoint.x,
      targetY: targetPoint.y,
      routeY: 100,
    });

    expect(
      pathIntersectsRect(
        geometry.segments,
        { ...source, width: NODE_WIDTH, height: NODE_HEIGHT },
        -0.75,
      ),
    ).toBe(false);
    expect(
      pathIntersectsRect(
        geometry.segments,
        { ...target, width: NODE_WIDTH, height: NODE_HEIGHT },
        -0.75,
      ),
    ).toBe(false);
  });

  it("detects a same-column route that immediately reverses into its source box", () => {
    const source = { x: 0, y: 180 };
    const target = { x: 0, y: 0 };
    const sourcePoint = portPoint(source, "out-right");
    const targetPoint = portPoint(target, "in-left");
    const geometry = edgeRouteGeometry({
      sourceX: sourcePoint.x,
      sourceY: sourcePoint.y,
      targetX: targetPoint.x,
      targetY: targetPoint.y,
      routeY: targetPoint.y,
    });

    expect(
      pathIntersectsRect(
        geometry.segments,
        { ...source, width: NODE_WIDTH, height: NODE_HEIGHT },
        -0.75,
      ),
    ).toBe(true);
  });

  it("checks cubic segments rather than only their bounding boxes", () => {
    const arch: EdgeRouteSegment[] = [
      {
        kind: "cubic",
        from: { x: 0, y: 0 },
        control1: { x: 0, y: 100 },
        control2: { x: 100, y: 100 },
        to: { x: 100, y: 0 },
      },
    ];

    expect(
      pathIntersectsRect(arch, { x: 45, y: 70, width: 10, height: 10 }),
    ).toBe(true);
    expect(
      pathIntersectsRect(arch, { x: 45, y: 88, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("honors the requested node clearance", () => {
    const line: EdgeRouteSegment[] = [
      {
        kind: "line",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      },
    ];
    const node = { x: 40, y: 25, width: 20, height: 20 };

    expect(pathIntersectsRect(line, node, 24)).toBe(false);
    expect(pathIntersectsRect(line, node, 25)).toBe(true);
  });

  it("uses compact endpoint geometry without changing the assigned lane", () => {
    const normal = edgeRouteGeometry({
      sourceX: 0,
      sourceY: 0,
      targetX: 708,
      targetY: 180,
      routeY: 100,
    });
    const compact = edgeRouteGeometry({
      sourceX: 0,
      sourceY: 0,
      targetX: 708,
      targetY: 180,
      routeY: 100,
      targetCurveMode: "compact",
    });

    expect(compact.routeStartX).toBe(normal.routeStartX);
    expect(compact.routeEndX).toBeGreaterThan(normal.routeEndX);
    expect(compact.segments.every((segment) => segment.to.y === 100 || segment.to.y === 180)).toBe(true);
  });

  it("detects cubic crossings and permits only a shared physical port", () => {
    const upper = edgeRouteGeometry({
      sourceX: 0,
      sourceY: 0,
      targetX: 500,
      targetY: 120,
      routeY: 90,
    });
    const crossing = edgeRouteGeometry({
      sourceX: 0,
      sourceY: 40,
      targetX: 500,
      targetY: 0,
      routeY: 30,
    });
    const fanout = edgeRouteGeometry({
      sourceX: 0,
      sourceY: 0,
      targetX: 500,
      targetY: 240,
      routeY: 150,
    });

    expect(pathsIntersect(upper.segments, crossing.segments)).toBe(true);
    expect(
      pathsIntersect(
        upper.segments,
        fanout.segments,
        [{ x: 0, y: 0 }],
      ),
    ).toBe(false);
  });

  it("derives the label rectangle from the rendered monospace text", () => {
    const short = edgeLabelGeometry({
      label: "[1] ETH",
      horizontalStartX: 100,
      horizontalEndX: 500,
      routeY: 200,
      labelBias: 0.5,
    });
    const long = edgeLabelGeometry({
      label: "[12] 3,587.96 USDC",
      horizontalStartX: 100,
      horizontalEndX: 500,
      routeY: 200,
      labelBias: 0.5,
    });

    expect(short.center).toEqual({ x: 300, y: 183 });
    expect(short.rect.y).toBe(175);
    expect(long.width).toBeGreaterThan(short.width);
  });
});
