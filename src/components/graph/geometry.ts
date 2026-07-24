export const NODE_WIDTH = 268;
export const NODE_HEIGHT = 76;
export const UPPER_PORT_RATIO = 0.36;
export const LOWER_PORT_RATIO = 0.64;
export const MIN_HORIZONTAL_LANE_GAP = 56;
export const NODE_ROUTE_CLEARANCE = 24;
export const MIN_HORIZONTAL_ROUTE_RUN = NODE_ROUTE_CLEARANCE * 2;
export const EDGE_LABEL_HEIGHT = 16;
export const EDGE_LABEL_HORIZONTAL_PADDING = 8;
export const EDGE_LABEL_MONO_CHARACTER_WIDTH = 7.25;

export type EdgeCurveMode = "default" | "compact" | "expanded";
export type GraphPortType = "source" | "target";
export type GraphPortSide = "left" | "right";

export type GraphPortSpec = {
  id: string;
  type: GraphPortType;
  side: GraphPortSide;
  ratio: number;
};

export const DEFAULT_GRAPH_PORTS: GraphPortSpec[] = [
  { id: "in-left", type: "target", side: "left", ratio: UPPER_PORT_RATIO },
  { id: "out-right", type: "source", side: "right", ratio: UPPER_PORT_RATIO },
  { id: "out-left", type: "source", side: "left", ratio: LOWER_PORT_RATIO },
  { id: "in-right", type: "target", side: "right", ratio: LOWER_PORT_RATIO },
];

export type GraphPosition = {
  x: number;
  y: number;
};

export type GraphPoint = {
  x: number;
  y: number;
};

export type GraphRect = GraphPosition & {
  width: number;
  height: number;
};

export type EdgeRouteSegment =
  | {
      kind: "line";
      from: GraphPoint;
      to: GraphPoint;
    }
  | {
      kind: "cubic";
      from: GraphPoint;
      control1: GraphPoint;
      control2: GraphPoint;
      to: GraphPoint;
    };

export type EdgeRouteGeometry = {
  direction: 1 | -1;
  curve: number;
  routeStartX: number;
  routeEndX: number;
  horizontalStartX: number;
  horizontalEndX: number;
  horizontalMinX: number;
  horizontalMaxX: number;
  sourceNeedsCurve: boolean;
  targetNeedsCurve: boolean;
  segments: EdgeRouteSegment[];
};

export type EdgeLabelGeometry = {
  center: GraphPoint;
  rect: GraphRect;
  width: number;
  height: number;
};

export function nodeCenter(position: GraphPosition) {
  return {
    x: position.x + NODE_WIDTH / 2,
    y: position.y + NODE_HEIGHT / 2,
  };
}

export function defaultPortRatio(handle: string) {
  return handle === "out-right" || handle === "in-left"
    ? UPPER_PORT_RATIO
    : LOWER_PORT_RATIO;
}

export function portPoint(
  position: GraphPosition,
  handle: string,
  ratio = defaultPortRatio(handle),
) {
  const onRight = handle.endsWith("right");

  return {
    x: position.x + (onRight ? NODE_WIDTH : 0),
    y: position.y + NODE_HEIGHT * ratio,
  };
}

export function edgeRouteGeometry({
  sourceX,
  sourceY,
  targetX,
  targetY,
  routeY,
  sourceCurveMode = "default",
  targetCurveMode = "default",
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  routeY: number;
  sourceCurveMode?: EdgeCurveMode;
  targetCurveMode?: EdgeCurveMode;
}): EdgeRouteGeometry {
  const direction = targetX >= sourceX ? 1 : -1;
  const dx = Math.max(Math.abs(targetX - sourceX), 1);
  const defaultSourceStub = Math.min(150, Math.max(72, dx * 0.2));
  const defaultTargetStub = Math.min(170, Math.max(82, dx * 0.24));
  const defaultCurve = Math.min(112, Math.max(46, dx * 0.17));
  const sourceNeedsCurve = Math.abs(sourceY - routeY) >= 1;
  const targetNeedsCurve = Math.abs(targetY - routeY) >= 1;
  const expandedStub = (fallback: number, verticalDelta: number) =>
    Math.min(
      260,
      Math.max(fallback, 144, dx * 0.42, Math.abs(verticalDelta) * 0.55),
    );
  let sourceStub =
    sourceCurveMode === "compact"
      ? Math.min(defaultSourceStub, 88)
      : sourceCurveMode === "expanded"
        ? expandedStub(defaultSourceStub, sourceY - routeY)
        : defaultSourceStub;
  let targetStub =
    targetCurveMode === "compact"
      ? Math.min(defaultTargetStub, 88)
      : targetCurveMode === "expanded"
        ? expandedStub(defaultTargetStub, targetY - routeY)
        : defaultTargetStub;
  const activeStubTotal =
    (sourceNeedsCurve ? sourceStub : 0) +
    (targetNeedsCurve ? targetStub : 0);
  const stubBudget = Math.max(0, dx - MIN_HORIZONTAL_ROUTE_RUN);
  if (
    (sourceCurveMode === "expanded" ||
      targetCurveMode === "expanded") &&
    activeStubTotal > stubBudget &&
    activeStubTotal > 0
  ) {
    const scale = stubBudget / activeStubTotal;
    if (sourceNeedsCurve) sourceStub *= scale;
    if (targetNeedsCurve) targetStub *= scale;
  }
  const sourceCurve =
    sourceCurveMode === "compact"
      ? Math.min(defaultCurve, 46)
      : sourceCurveMode === "expanded"
        ? Math.max(
            0,
            Math.min(
              Math.max(defaultCurve, sourceStub * 0.55),
              sourceStub - 18,
            ),
          )
        : defaultCurve;
  const targetCurve =
    targetCurveMode === "compact"
      ? Math.min(defaultCurve, 46)
      : targetCurveMode === "expanded"
        ? Math.max(
            0,
            Math.min(
              Math.max(defaultCurve, targetStub * 0.55),
              targetStub - 18,
            ),
          )
        : defaultCurve;
  const routeStartX = sourceX + direction * sourceStub;
  const routeEndX = targetX - direction * targetStub;
  const horizontalStartX = sourceNeedsCurve ? routeStartX : sourceX;
  const horizontalEndX = targetNeedsCurve ? routeEndX : targetX;
  const sourcePoint = { x: sourceX, y: sourceY };
  const targetPoint = { x: targetX, y: targetY };
  const segments: EdgeRouteSegment[] = [];
  let currentPoint = sourcePoint;

  if (sourceNeedsCurve) {
    const curveEnd = { x: routeStartX, y: routeY };
    segments.push({
      kind: "cubic",
      from: currentPoint,
      control1: { x: sourceX + direction * sourceCurve, y: sourceY },
      control2: { x: routeStartX - direction * 18, y: routeY },
      to: curveEnd,
    });
    currentPoint = curveEnd;
  }

  const horizontalEnd = { x: horizontalEndX, y: routeY };
  segments.push({
    kind: "line",
    from: currentPoint,
    to: horizontalEnd,
  });
  currentPoint = horizontalEnd;

  if (targetNeedsCurve) {
    segments.push({
      kind: "cubic",
      from: currentPoint,
      control1: { x: routeEndX + direction * 18, y: routeY },
      control2: { x: targetX - direction * targetCurve, y: targetY },
      to: targetPoint,
    });
  }

  return {
    direction,
    curve: Math.max(sourceCurve, targetCurve),
    routeStartX,
    routeEndX,
    horizontalStartX,
    horizontalEndX,
    horizontalMinX: Math.min(horizontalStartX, horizontalEndX),
    horizontalMaxX: Math.max(horizontalStartX, horizontalEndX),
    sourceNeedsCurve,
    targetNeedsCurve,
    segments,
  };
}

function labelTextWidth(label: string) {
  return Array.from(label).reduce(
    (width, character) =>
      width +
      EDGE_LABEL_MONO_CHARACTER_WIDTH *
        (character.codePointAt(0)! > 0x7f ? 2 : 1),
    0,
  );
}

export function edgeLabelGeometry({
  label,
  horizontalStartX,
  horizontalEndX,
  routeY,
  labelBias,
}: {
  label: string;
  horizontalStartX: number;
  horizontalEndX: number;
  routeY: number;
  labelBias: number;
}): EdgeLabelGeometry {
  const width = labelTextWidth(label) + EDGE_LABEL_HORIZONTAL_PADDING;
  const height = EDGE_LABEL_HEIGHT;
  const center = {
    x:
      horizontalStartX +
      (horizontalEndX - horizontalStartX) * Math.min(1, Math.max(0, labelBias)),
    y: routeY - 17,
  };

  return {
    center,
    rect: {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    },
    width,
    height,
  };
}

export function horizontalIntervalsOverlap(
  a: Pick<EdgeRouteGeometry, "horizontalMinX" | "horizontalMaxX">,
  b: Pick<EdgeRouteGeometry, "horizontalMinX" | "horizontalMaxX">,
) {
  return Math.min(a.horizontalMaxX, b.horizontalMaxX) -
    Math.max(a.horizontalMinX, b.horizontalMinX) >
    1;
}

export function inflateRect(rect: GraphRect, padding: number): GraphRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: Math.max(0, rect.width + padding * 2),
    height: Math.max(0, rect.height + padding * 2),
  };
}

export function rectsIntersect(a: GraphRect, b: GraphRect) {
  return (
    Math.min(a.x + a.width, b.x + b.width) -
        Math.max(a.x, b.x) >=
      -0.0001 &&
    Math.min(a.y + a.height, b.y + b.height) -
        Math.max(a.y, b.y) >=
      -0.0001
  );
}

function lineIntersectsRect(
  from: GraphPoint,
  to: GraphPoint,
  rect: GraphRect,
) {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let start = 0;
  let end = 1;

  const clips: Array<[number, number]> = [
    [-dx, from.x - minX],
    [dx, maxX - from.x],
    [-dy, from.y - minY],
    [dy, maxY - from.y],
  ];

  for (const [p, q] of clips) {
    if (Math.abs(p) < 0.000001) {
      if (q < 0) return false;
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      start = Math.max(start, ratio);
    } else {
      end = Math.min(end, ratio);
    }
    if (start > end) return false;
  }

  return true;
}

function pointLineDistance(point: GraphPoint, from: GraphPoint, to: GraphPoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.000001) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }

  const cross = Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x);
  return cross / Math.sqrt(lengthSquared);
}

function midpoint(a: GraphPoint, b: GraphPoint): GraphPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function cubicIntersectsRect(
  segment: Extract<EdgeRouteSegment, { kind: "cubic" }>,
  rect: GraphRect,
  depth = 0,
): boolean {
  const flatness = Math.max(
    pointLineDistance(segment.control1, segment.from, segment.to),
    pointLineDistance(segment.control2, segment.from, segment.to),
  );

  if (flatness <= 0.75 || depth >= 12) {
    return lineIntersectsRect(segment.from, segment.to, rect);
  }

  const p01 = midpoint(segment.from, segment.control1);
  const p12 = midpoint(segment.control1, segment.control2);
  const p23 = midpoint(segment.control2, segment.to);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);

  return (
    cubicIntersectsRect(
      {
        kind: "cubic",
        from: segment.from,
        control1: p01,
        control2: p012,
        to: split,
      },
      rect,
      depth + 1,
    ) ||
    cubicIntersectsRect(
      {
        kind: "cubic",
        from: split,
        control1: p123,
        control2: p23,
        to: segment.to,
      },
      rect,
      depth + 1,
    )
  );
}

export function pathIntersectsRect(
  segments: EdgeRouteSegment[],
  rect: GraphRect,
  padding = 0,
) {
  const obstacle = inflateRect(rect, padding);
  if (obstacle.width <= 0 || obstacle.height <= 0) return false;

  return segments.some((segment) =>
    segment.kind === "line"
      ? lineIntersectsRect(segment.from, segment.to, obstacle)
      : cubicIntersectsRect(segment, obstacle),
  );
}

function flattenCubic(
  segment: Extract<EdgeRouteSegment, { kind: "cubic" }>,
  points: GraphPoint[],
  depth = 0,
) {
  const flatness = Math.max(
    pointLineDistance(segment.control1, segment.from, segment.to),
    pointLineDistance(segment.control2, segment.from, segment.to),
  );

  if (flatness <= 0.75 || depth >= 12) {
    points.push(segment.to);
    return;
  }

  const p01 = midpoint(segment.from, segment.control1);
  const p12 = midpoint(segment.control1, segment.control2);
  const p23 = midpoint(segment.control2, segment.to);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  flattenCubic(
    {
      kind: "cubic",
      from: segment.from,
      control1: p01,
      control2: p012,
      to: split,
    },
    points,
    depth + 1,
  );
  flattenCubic(
    {
      kind: "cubic",
      from: split,
      control1: p123,
      control2: p23,
      to: segment.to,
    },
    points,
    depth + 1,
  );
}

function flattenedLines(segments: EdgeRouteSegment[]) {
  return segments.flatMap((segment) => {
    if (segment.kind === "line") return [{ from: segment.from, to: segment.to }];

    const points = [segment.from];
    flattenCubic(segment, points);
    return points.slice(1).map((to, index) => ({
      from: points[index],
      to,
    }));
  });
}

function cross(a: GraphPoint, b: GraphPoint, c: GraphPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnLineSegment(point: GraphPoint, from: GraphPoint, to: GraphPoint) {
  return (
    Math.abs(cross(from, to, point)) <= 0.001 &&
    point.x >= Math.min(from.x, to.x) - 0.001 &&
    point.x <= Math.max(from.x, to.x) + 0.001 &&
    point.y >= Math.min(from.y, to.y) - 0.001 &&
    point.y <= Math.max(from.y, to.y) + 0.001
  );
}

function lineIntersection(
  aFrom: GraphPoint,
  aTo: GraphPoint,
  bFrom: GraphPoint,
  bTo: GraphPoint,
) {
  const denominator =
    (aFrom.x - aTo.x) * (bFrom.y - bTo.y) -
    (aFrom.y - aTo.y) * (bFrom.x - bTo.x);

  if (Math.abs(denominator) <= 0.000001) {
    if (Math.abs(cross(aFrom, aTo, bFrom)) > 0.001) return null;
    return [aFrom, aTo, bFrom, bTo].find(
      (point) =>
        pointOnLineSegment(point, aFrom, aTo) &&
        pointOnLineSegment(point, bFrom, bTo),
    ) ?? null;
  }

  const aCross = aFrom.x * aTo.y - aFrom.y * aTo.x;
  const bCross = bFrom.x * bTo.y - bFrom.y * bTo.x;
  const point = {
    x:
      (aCross * (bFrom.x - bTo.x) -
        (aFrom.x - aTo.x) * bCross) /
      denominator,
    y:
      (aCross * (bFrom.y - bTo.y) -
        (aFrom.y - aTo.y) * bCross) /
      denominator,
  };

  return pointOnLineSegment(point, aFrom, aTo) &&
    pointOnLineSegment(point, bFrom, bTo)
    ? point
    : null;
}

export function pathsIntersect(
  a: EdgeRouteSegment[],
  b: EdgeRouteSegment[],
  allowedSharedPoints: GraphPoint[] = [],
  allowedRadius = 12,
) {
  const aLines = flattenedLines(a);
  const bLines = flattenedLines(b);

  return aLines.some((aLine) =>
    bLines.some((bLine) => {
      const intersection = lineIntersection(
        aLine.from,
        aLine.to,
        bLine.from,
        bLine.to,
      );
      if (!intersection) return false;

      return !allowedSharedPoints.some(
        (point) =>
          Math.hypot(intersection.x - point.x, intersection.y - point.y) <=
          allowedRadius,
      );
    }),
  );
}
