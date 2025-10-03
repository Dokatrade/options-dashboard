import React from 'react';
import { useStore } from '../store/store';
import type { SpreadPosition, Position, Leg, PortfolioSettings } from '../utils/types';

type ExportPayload = {
  version: number;
  exportedAt: string;
  positions: Position[];
  spreads: SpreadPosition[];
  settings: PortfolioSettings;
  ui: Record<string, unknown>;
  portfolios: Array<{ id: string; name: string; createdAt: number; updatedAt: number }>;
  activePortfolioId: string;
};

const isVerticalLike = (legs: Position['legs']): boolean => {
  if (!Array.isArray(legs) || legs.length !== 2) return false;
  const [a, b] = legs;
  if (!a || !b) return false;
  const sameType = a.leg?.optionType === b.leg?.optionType;
  const sameExpiry = Number(a.leg?.expiryMs) === Number(b.leg?.expiryMs);
  const oppositeSide = a.side !== b.side;
  return sameType && sameExpiry && oppositeSide;
};

const toSpread = (pos: Position): SpreadPosition | null => {
  if (!isVerticalLike(pos.legs)) return null;
  const [a, b] = pos.legs;
  if (!a || !b) return null;
  const shortLeg = a.side === 'short' ? a : b;
  const longLeg = a.side === 'long' ? a : b;
  if (!shortLeg || !longLeg) return null;
  const qty = Number(shortLeg.qty) || Number(longLeg.qty) || 1;
  const entryShort = Number(shortLeg.entryPrice) || 0;
  const entryLong = Number(longLeg.entryPrice) || 0;
  const cEnter = entryShort - entryLong;
  return {
    id: pos.id,
    createdAt: pos.createdAt,
    closedAt: pos.closedAt,
    closeSnapshot: pos.closeSnapshot,
    note: pos.note,
    favorite: pos.favorite,
    settlements: pos.settlements,
    qty,
    cEnter,
    entryShort,
    entryLong,
    short: shortLeg.leg as Leg,
    long: longLeg.leg as Leg,
    portfolioId: pos.portfolioId,
  };
};

const splitUnifiedPositions = (items: Position[]) => {
  const spreads: SpreadPosition[] = [];
  const combos: Position[] = [];
  for (const pos of items) {
    const spread = toSpread(pos);
    // Guard: if heuristics fail or produce invalid spread, keep original position
    if (spread && spread.short && spread.long) spreads.push(spread);
    else combos.push(pos);
  }
  return { spreads, positions: combos };
};

const collectUiSnapshot = () => {
  const readLS = (key: string) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  return {
    draft: readLS('options-draft-v1'),
    ifRules: readLS('if-rules-v3'),
    ifTemplates: readLS('if-templates-v1'),
    positionsColumns: readLS('positions-columns-v1'),
    positionsActions: readLS('positions-actions-v1'),
    positionsUi: readLS('positions-ui-v1'),
    positionViewUi: readLS('position-view-ui-v1'),
    positionViewUiByPos: readLS('position-view-ui-bypos-v1'),
  };
};

const restoreUiSnapshot = (ui: any) => {
  if (!ui || typeof ui !== 'object') return;
  const map: Array<[string, unknown]> = [
    ['options-draft-v1', ui.draft],
    ['if-rules-v3', ui.ifRules],
    ['if-templates-v1', ui.ifTemplates],
    ['positions-columns-v1', ui.positionsColumns],
    ['positions-actions-v1', ui.positionsActions],
    ['positions-ui-v1', ui.positionsUi],
    ['position-view-ui-v1', ui.positionViewUi],
    ['position-view-ui-bypos-v1', ui.positionViewUiByPos],
  ];
  map.forEach(([key, value]) => {
    if (value === undefined) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  });
};

export function TopBarBackupButtons() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const settings = useStore((s) => s.settings);
  const importState = useStore((s) => s.importState);
  const portfolios = useStore((s) => s.portfolios);
  const activePortfolioId = useStore((s) => s.activePortfolioId);

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const exportJson = () => {
    const payload: ExportPayload = {
      version: 5,
      exportedAt: new Date().toISOString(),
      positions,
      spreads,
      settings,
      ui: collectUiSnapshot(),
      portfolios,
      activePortfolioId,
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `options-dashboard-${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onPick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const version = Number(data?.version) || 1;

      let spreadsPayload: SpreadPosition[] | undefined;
      let positionsPayload: Position[] | undefined;

      if (Array.isArray(data?.spreads)) spreadsPayload = data.spreads as SpreadPosition[];
      if (Array.isArray(data?.positions)) positionsPayload = data.positions as Position[];

      if ((spreadsPayload == null || positionsPayload == null) && version >= 3 && Array.isArray(data?.positions)) {
        const split = splitUnifiedPositions(data.positions as Position[]);
        if (spreadsPayload == null) spreadsPayload = split.spreads;
        if (positionsPayload == null) positionsPayload = split.positions;
      }

      if (!Array.isArray(spreadsPayload)) spreadsPayload = [];
      if (!Array.isArray(positionsPayload)) positionsPayload = [];

      const portfoliosPayload = Array.isArray(data?.portfolios) ? data.portfolios : undefined;
      const activePortfolioId = typeof data?.activePortfolioId === 'string' ? data.activePortfolioId : undefined;

      importState({ spreads: spreadsPayload, positions: positionsPayload, settings: data?.settings, portfolios: portfoliosPayload, activePortfolioId });
      restoreUiSnapshot(data?.ui);
    } catch {
      // noop in top bar; Portfolio page can show messages if needed
    }
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button className="ghost" onClick={exportJson}>Export JSON</button>
      <button className="ghost" onClick={onPick}>Import JSON</button>
      <input ref={inputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={onFile} />
    </span>
  );
}
