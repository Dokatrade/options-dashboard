import type { PositionLeg } from './types';

// Builds a stable identifier for a leg so actions (hide/unhide) target a single leg,
// even when multiple legs share the same symbol (e.g., multiple perps).
export function legKey(leg: PositionLeg, index: number): string {
  const created = Number((leg as any)?.createdAt);
  const base = Number.isFinite(created) ? `t${created}` : `i${index}`;
  const symbol = String((leg as any)?.leg?.symbol ?? '');
  return `${base}:${symbol}`;
}
