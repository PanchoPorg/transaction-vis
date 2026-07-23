import {
  edgeLabelGeometry,
  edgeRouteGeometry,
  type EdgeCurveMode,
} from "./geometry";

export type TransferPathParams = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  routeY: number;
  label: string;
  labelBias: number;
  sourceCurveMode: EdgeCurveMode;
  targetCurveMode: EdgeCurveMode;
};

export type TransferPathResult = {
  path: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  routeY: number;
  horizontalStartX: number;
  horizontalEndX: number;
  horizontalMinX: number;
  horizontalMaxX: number;
  sourceNeedsCurve: boolean;
  targetNeedsCurve: boolean;
};

export function transferPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  routeY,
  label,
  labelBias,
  sourceCurveMode,
  targetCurveMode,
}: TransferPathParams): TransferPathResult {
  const geometry = edgeRouteGeometry({
    sourceX,
    sourceY,
    targetX,
    targetY,
    routeY,
    sourceCurveMode,
    targetCurveMode,
  });
  const labelGeometry = edgeLabelGeometry({
    label,
    horizontalStartX: geometry.horizontalStartX,
    horizontalEndX: geometry.horizontalEndX,
    routeY,
    labelBias,
  });
  const commands = [
    `M ${sourceX} ${sourceY}`,
    ...geometry.segments.map((segment) =>
      segment.kind === "line"
        ? `L ${segment.to.x} ${segment.to.y}`
        : `C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${segment.to.x} ${segment.to.y}`,
    ),
  ];

  return {
    path: commands.join(" "),
    labelX: labelGeometry.center.x,
    labelY: labelGeometry.center.y,
    labelWidth: labelGeometry.width,
    labelHeight: labelGeometry.height,
    routeY,
    horizontalStartX: geometry.horizontalStartX,
    horizontalEndX: geometry.horizontalEndX,
    horizontalMinX: geometry.horizontalMinX,
    horizontalMaxX: geometry.horizontalMaxX,
    sourceNeedsCurve: geometry.sourceNeedsCurve,
    targetNeedsCurve: geometry.targetNeedsCurve,
  };
}
