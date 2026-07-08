export type TransferPathParams = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  laneIndex: number;
  laneCount: number;
  fanoutIndex: number;
  fanoutCount: number;
  fanoutHub: string | null;
  fanoutOffset: number;
  straightSource: boolean;
  straightTarget: boolean;
  sourceRouteOffset: number | null;
  targetRouteOffset: number | null;
  sourceId: string;
  targetId: string;
};

export type TransferPathResult = {
  path: string;
  labelX: number;
  labelY: number;
};

function offsetLaneY(
  sourceY: number,
  targetY: number,
  sourceRouteOffset: number | null,
  targetRouteOffset: number | null,
  routeY: number,
) {
  const sourceLaneY = sourceRouteOffset === null ? null : sourceY + sourceRouteOffset;
  const targetLaneY = targetRouteOffset === null ? null : targetY + targetRouteOffset;

  if (sourceLaneY === null) return targetLaneY ?? routeY;
  if (targetLaneY === null) return sourceLaneY;

  const sourceDistance = Math.abs(sourceRouteOffset ?? 0);
  const targetDistance = Math.abs(targetRouteOffset ?? 0);

  return sourceDistance >= targetDistance ? sourceLaneY : targetLaneY;
}

export function transferPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  laneIndex,
  laneCount,
  fanoutIndex,
  fanoutCount,
  fanoutHub,
  fanoutOffset,
  straightSource,
  straightTarget,
  sourceRouteOffset,
  targetRouteOffset,
  sourceId,
  targetId,
}: TransferPathParams): TransferPathResult {
  const direction = targetX >= sourceX ? 1 : -1;
  const dx = Math.max(Math.abs(targetX - sourceX), 1);
  const pairSpacing = laneCount > 1 ? 50 : 0;
  const pairOffset = (laneIndex - (laneCount - 1) / 2) * pairSpacing;
  const fanoutSpacing = fanoutCount >= 5 ? 64 : 76;
  const rawFanoutOffset = (fanoutIndex - (fanoutCount - 1) / 2) * fanoutSpacing;
  const fallbackFanoutOffset = Math.max(-320, Math.min(320, rawFanoutOffset));
  const groupedFanoutOffset = Math.max(-320, Math.min(320, fanoutOffset));
  const hubY =
    fanoutHub === sourceId
      ? sourceY
      : fanoutHub === targetId
        ? targetY
        : (sourceY + targetY) / 2;
  const routeY =
    fanoutCount > 1
      ? hubY + (Number.isFinite(fanoutOffset) ? groupedFanoutOffset : fallbackFanoutOffset)
      : (sourceY + targetY) / 2 + pairOffset;
  const sourceStub = Math.min(150, Math.max(72, dx * 0.2));
  const targetStub = Math.min(170, Math.max(82, dx * 0.24));
  const curve = Math.min(112, Math.max(46, dx * 0.17));
  const routeStartX = sourceX + direction * sourceStub;
  const routeEndX = targetX - direction * targetStub;

  let mainLaneY: number;
  if (straightSource && straightTarget) {
    const sourceRunLength = Math.abs(routeEndX - sourceX);
    const targetRunLength = Math.abs(targetX - routeStartX);
    mainLaneY = Math.abs(sourceY - targetY) < 1 || sourceRunLength >= targetRunLength ? sourceY : targetY;
  } else if (straightSource) {
    mainLaneY = sourceY;
  } else if (straightTarget) {
    mainLaneY = targetY;
  } else {
    mainLaneY = offsetLaneY(sourceY, targetY, sourceRouteOffset, targetRouteOffset, routeY);
  }

  const sourceNeedsCurve = Math.abs(sourceY - mainLaneY) >= 1;
  const targetNeedsCurve = Math.abs(targetY - mainLaneY) >= 1;
  const horizontalEndX = targetNeedsCurve ? routeEndX : targetX;
  const labelBias = fanoutHub === sourceId ? 0.52 : fanoutHub === targetId ? 0.48 : 0.5;
  const commands = [`M ${sourceX} ${sourceY}`];

  if (sourceNeedsCurve) {
    commands.push(
      `C ${sourceX + direction * curve} ${sourceY} ${routeStartX - direction * 18} ${mainLaneY} ${routeStartX} ${mainLaneY}`,
    );
  }

  commands.push(`L ${horizontalEndX} ${mainLaneY}`);

  if (targetNeedsCurve) {
    commands.push(
      `C ${routeEndX + direction * 18} ${mainLaneY} ${targetX - direction * curve} ${targetY} ${targetX} ${targetY}`,
    );
  }

  return {
    path: commands.join(" "),
    labelX: sourceX + (targetX - sourceX) * labelBias,
    labelY: mainLaneY - 17,
  };
}
