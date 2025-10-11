import type { CloseSnapshot, Position, PositionLeg, SpreadPosition } from './types';

export type ViewPayload = {
  id: string;
  legs: PositionLeg[];
  createdAt: number;
  closedAt?: number;
  closeSnapshot?: CloseSnapshot;
  note?: string;
  title: string;
  hiddenSymbols?: string[];
  onClosePosition?: () => void;
};

export const buildSpreadViewPayload = (
  spread: SpreadPosition,
  title: string,
  extra?: { onClosePosition?: () => void },
): ViewPayload => {
  const qty = Number(spread.qty) > 0 ? Number(spread.qty) : 1;
  const entryShort = spread.entryShort != null ? Number(spread.entryShort)
    : (spread.entryLong != null ? Number(spread.cEnter) + Number(spread.entryLong) : Number(spread.cEnter));
  const entryLong = spread.entryLong != null ? Number(spread.entryLong)
    : (spread.entryShort != null ? Number(spread.entryShort) - Number(spread.cEnter) : 0);
  const legs: PositionLeg[] = [
    { leg: spread.short, side: 'short', qty, entryPrice: Number.isFinite(entryShort) ? entryShort : 0, createdAt: spread.createdAt },
    { leg: spread.long, side: 'long', qty, entryPrice: Number.isFinite(entryLong) ? entryLong : 0, createdAt: spread.createdAt },
  ];
  return {
    id: `S:${spread.id}`,
    legs,
    createdAt: spread.createdAt,
    closedAt: spread.closedAt,
    closeSnapshot: spread.closeSnapshot,
    note: spread.note,
    title,
    onClosePosition: extra?.onClosePosition,
  };
};

export const buildPositionViewPayload = (
  position: Position,
  title: string,
  extra?: { onClosePosition?: () => void },
): ViewPayload => {
  const legs = Array.isArray(position.legs) ? position.legs : [];
  const hiddenSymbols = legs.filter((L) => L.hidden).map((L) => L.leg.symbol);
  return {
    id: `P:${position.id}`,
    legs,
    createdAt: position.createdAt,
    closedAt: position.closedAt,
    closeSnapshot: position.closeSnapshot,
    note: position.note,
    title,
    hiddenSymbols: hiddenSymbols.length ? hiddenSymbols : undefined,
    onClosePosition: extra?.onClosePosition,
  };
};

