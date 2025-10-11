import React from 'react';
import { useStore, DEFAULT_PORTFOLIO_ID } from '../store/store';
import { subscribeOptionTicker, subscribeSpotTicker } from '../services/ws';
import { midPrice, bestBidAsk, fetchOptionTickers, fetchHV30, fetchOrderbookL1, fetchSpotEth, fetchOptionDeliveryPrice } from '../services/bybit';
import type { HV30Stats } from '../services/bybit';
import { bsImpliedVol } from '../utils/bs';
import type { Position, PositionLeg, SpreadPosition, SettlementMap, CloseSnapshot } from '../utils/types';
import { describeStrategy, type StrategyLeg } from '../utils/strategyDetection';
import { downloadCSV, toCSV } from '../utils/csv';
import { PositionView } from './PositionView';
import { EditPositionModal } from './EditPositionModal';
import { IfModal, IfRule, IfCond, IfOperand, IfSide, IfComparator, IfChain, IfConditionTemplate, migrateRule } from './IfModal';
import { AddPositionModal } from './AddPositionModal';
import { useSlowMode } from '../contexts/SlowModeContext';

function formatCreatedAtLabel(createdAt?: number): string | null {
  if (!Number.isFinite(createdAt)) return null;
  const dt = new Date(Number(createdAt));
  if (Number.isNaN(dt.getTime())) return null;
  const datePart = dt.toLocaleDateString('ru-RU');
  const timePart = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  return `(created ${datePart} | ${timePart})`;
}

type Row = {
  id: string;
  kind: 'vertical' | 'multi';
  legs: PositionLeg[];
  createdAt: number;
  closedAt?: number;
  closeSnapshot?: CloseSnapshot;
  note?: string;
  portfolioId?: string;
  // vertical extras
  cEnter?: number; // per contract
  qty?: number;
  favorite?: boolean;
  settlements?: SettlementMap;
};

type LegSnapshot = PositionLeg & {
  bid?: number;
  ask?: number;
  mid?: number;
  exec?: number;
  pnlMid?: number;
  pnlExec?: number;
  spread?: number;
  oi?: number;
  greeks?: { delta?: number; gamma?: number; vega?: number; theta?: number };
  settleS?: number;
  settledAt?: number;
  settled?: boolean;
};

type ColumnKey =
  | 'type'
  | 'legs'
  | 'expiry'
  | 'netEntry'
  | 'netMid'
  | 'pnl'
  | 'delta'
  | 'gamma'
  | 'vega'
  | 'theta'
  | 'liquidity'
  | 'actions';

type ActionKey =
  | 'favorite'
  | 'expand'
  | 'view'
  | 'edit'
  | 'if'
  | 'notes'
  | 'settle'
  | 'close'
  | 'delete';

const COLUMN_CONFIG: Array<{ key: ColumnKey; label: string }> = [
  { key: 'type', label: 'Type' },
  { key: 'legs', label: 'Legs' },
  { key: 'expiry', label: 'Expiry / DTE' },
  { key: 'netEntry', label: 'Net entry' },
  { key: 'netMid', label: 'Net mid' },
  { key: 'pnl', label: 'PnL ($)' },
  { key: 'delta', label: 'Delta' },
  { key: 'gamma', label: 'Gamma' },
  { key: 'vega', label: 'Vega' },
  { key: 'theta', label: 'Theta, $/day' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'actions', label: 'Actions' },
];

const ACTION_LABELS: Record<ActionKey, string> = {
  favorite: 'Favorite',
  expand: 'Expand',
  view: 'View',
  edit: 'Edit',
  if: 'IF Rules',
  notes: 'Notes',
  settle: 'Settle',
  close: 'Close',
  delete: 'Delete',
};

const typeColumnStyle: React.CSSProperties = {
  minWidth: 120,
  maxWidth: 240,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
};

const typeCellContentStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const legsColumnStyle: React.CSSProperties = {
  minWidth: 60,
};

function fromSpread(s: SpreadPosition): Row {
  // Derive per-leg entries with sensible fallbacks preserving net = cEnter
  const entryShort = s.entryShort != null
    ? s.entryShort
    : (s.entryLong != null ? s.cEnter + s.entryLong : s.cEnter);
  const entryLong = s.entryLong != null
    ? s.entryLong
    : (s.entryShort != null ? s.entryShort - s.cEnter : 0);
  const legCreatedAt = Number.isFinite(s.createdAt) ? Number(s.createdAt) : Date.now();
  return {
    id: 'S:' + s.id,
    kind: 'vertical',
    legs: [
      { leg: s.short, side: 'short', qty: s.qty ?? 1, entryPrice: entryShort, createdAt: legCreatedAt },
      { leg: s.long,  side: 'long',  qty: s.qty ?? 1, entryPrice: entryLong, createdAt: legCreatedAt },
    ],
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    closeSnapshot: s.closeSnapshot,
    note: s.note,
    portfolioId: s.portfolioId,
    cEnter: s.cEnter,
    qty: s.qty ?? 1,
    favorite: s.favorite,
    settlements: s.settlements,
  };
}

function fromPosition(p: Position): Row {
  return {
    id: 'P:' + p.id,
    kind: 'multi',
    legs: p.legs,
    createdAt: p.createdAt,
    closedAt: p.closedAt,
    closeSnapshot: p.closeSnapshot,
    note: p.note,
    portfolioId: p.portfolioId,
    favorite: p.favorite,
    settlements: p.settlements,
  };
}

export function UnifiedPositionsTable() {
  const allSpreads = useStore((s) => s.spreads);
  const allPositions = useStore((s) => s.positions);
  const portfolios = useStore((s) => s.portfolios);
  const activePortfolioId = useStore((s) => s.activePortfolioId);
  const setActivePortfolio = useStore((s) => s.setActivePortfolio);
  const createPortfolio = useStore((s) => s.createPortfolio);
  const markClosed = useStore((s) => s.markClosed);
  const closePosition = useStore((s) => s.closePosition);
  const removeSpread = useStore((s) => s.remove);
  const removePosition = useStore((s) => s.removePosition);
  const updateSpread = useStore((s) => s.updateSpread);
  const updatePosition = useStore((s) => s.updatePosition);
  const addPosition = useStore((s) => s.addPosition);
  const toggleFavoriteSpread = useStore((s) => s.toggleFavoriteSpread);
  const toggleFavoritePosition = useStore((s) => s.toggleFavoritePosition);
  const setSpreadSettlement = useStore((s) => s.setSpreadSettlement);
  const setPositionSettlement = useStore((s) => s.setPositionSettlement);
  const matchPortfolio = React.useCallback((portfolioId?: string) => {
    if (activePortfolioId === DEFAULT_PORTFOLIO_ID) return true;
    return (portfolioId ?? DEFAULT_PORTFOLIO_ID) === activePortfolioId;
  }, [activePortfolioId]);
  const spreads = React.useMemo(() => allSpreads.filter((s) => matchPortfolio(s.portfolioId)), [allSpreads, matchPortfolio]);
  const positions = React.useMemo(() => allPositions.filter((p) => matchPortfolio(p.portfolioId)), [allPositions, matchPortfolio]);
  const portfolioNameById = React.useMemo(() => Object.fromEntries(portfolios.map((p) => [p.id, p.name])), [portfolios]);
  const [showClosed, setShowClosed] = React.useState(true);
  const [hideExpired, setHideExpired] = React.useState(true);
  const [useExecPnl, setUseExecPnl] = React.useState(true);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [view, setView] = React.useState<Row | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [noteRow, setNoteRow] = React.useState<Row | null>(null);
  const [noteDraft, setNoteDraft] = React.useState('');
  const [tab, setTab] = React.useState<'all'|'fav'>('all');
  const [sortKey, setSortKey] = React.useState<'date'|'pnl'|'theta'|'expiry'>('date');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('desc');
  const [showCreatePortfolioModal, setShowCreatePortfolioModal] = React.useState(false);
  const [portfolioNameDraft, setPortfolioNameDraft] = React.useState('');
  const [createPortfolioError, setCreatePortfolioError] = React.useState<string | null>(null);
  const { slowMode, setSlowMode: setGlobalSlowMode, slowStats, manualRefresh, register } = useSlowMode();
  const rowsRef = React.useRef<Row[]>([]);
  const autoSettleAttemptRef = React.useRef<Map<string, number>>(new Map());
  const [hvStats, setHvStats] = React.useState<HV30Stats | undefined>();
  const [rPct, setRPct] = React.useState(0);
  const [ifRow, setIfRow] = React.useState<Row | null>(null);
  const [ifRules, setIfRules] = React.useState<Record<string, IfRule>>(() => {
    const load = (key: string): Record<string, IfRule> | undefined => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return undefined;
        const entries = Object.entries(parsed as Record<string, unknown>).map(([id, rule]) => [id, migrateRule(rule)] as const);
        return Object.fromEntries(entries);
      } catch { return undefined; }
    };
    const latest = load('if-rules-v3');
    if (latest) return latest;
    const prev = load('if-rules-v2');
    if (prev) {
      try { localStorage.setItem('if-rules-v3', JSON.stringify(prev)); } catch {}
      return prev;
    }
    const legacy = load('if-rules-v1');
    if (legacy) {
      try { localStorage.setItem('if-rules-v3', JSON.stringify(legacy)); } catch {}
      return legacy;
    }
    return {};
  });
  const [ifTemplates, setIfTemplates] = React.useState<IfConditionTemplate[]>(() => {
    try {
      const raw = localStorage.getItem('if-templates-v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const list: IfConditionTemplate[] = [];
      for (const item of parsed) {
        const scope: 'position' | 'leg' = item?.scope === 'position' ? 'position' : 'leg';
        if (!item?.cond) continue;
        let legSymbol: string | null | undefined = undefined;
        if (scope === 'leg') {
          if (typeof item?.legSymbol === 'string') legSymbol = item.legSymbol;
          else if (item?.legSymbol === null) legSymbol = null;
        }
        list.push({
          name: String(item?.name ?? 'Шаблон'),
          scope,
          cond: item.cond as IfCond,
          legSymbol,
        });
      }
      return list;
    } catch {
      return [];
    }
  });
  const [visibleColumns, setVisibleColumns] = React.useState<Record<ColumnKey, boolean>>(() => {
    const defaults: Record<ColumnKey, boolean> = {} as Record<ColumnKey, boolean>;
    for (const col of COLUMN_CONFIG) defaults[col.key] = true;
    return defaults;
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = React.useState(false);
  const [showAddPosition, setShowAddPosition] = React.useState(false);
  const columnsMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [settleTarget, setSettleTarget] = React.useState<Row | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = React.useState(false);
  const actionMenuRef = React.useRef<HTMLDivElement | null>(null);
  const activePortfolio = React.useMemo(() => portfolios.find((p) => p.id === activePortfolioId), [portfolios, activePortfolioId]);
  const closeCreateModal = React.useCallback(() => {
    setShowCreatePortfolioModal(false);
    setPortfolioNameDraft('');
    setCreatePortfolioError(null);
  }, []);
  const handleCreatePortfolio = React.useCallback(() => {
    const trimmed = portfolioNameDraft.trim();
    if (!trimmed) {
      setCreatePortfolioError('Введите название портфеля');
      return;
    }
    const exists = portfolios.some((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setCreatePortfolioError('Портфель с таким названием уже существует');
      return;
    }
    const id = createPortfolio(trimmed);
    if (!id) {
      setCreatePortfolioError('Не удалось создать портфель');
      return;
    }
    closeCreateModal();
  }, [closeCreateModal, createPortfolio, portfolioNameDraft, portfolios]);
  const handlePortfolioSelect = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setActivePortfolio(event.target.value);
  }, [setActivePortfolio]);
  const prevPortfolioIdRef = React.useRef(activePortfolioId);
  React.useEffect(() => {
    if (prevPortfolioIdRef.current === activePortfolioId) return;
    prevPortfolioIdRef.current = activePortfolioId;
    manualRefresh().catch(() => {});
  }, [activePortfolioId, manualRefresh]);

  const DEFAULT_ACTION_VISIBILITY: Record<ActionKey, boolean> = React.useMemo(() => ({
    favorite: true,
    expand: true,
    view: true,
    edit: true,
    if: true,
    notes: true,
    settle: true,
    close: true,
    delete: true,
  }), []);
  const [actionVisibility, setActionVisibility] = React.useState<Record<ActionKey, boolean>>(DEFAULT_ACTION_VISIBILITY);
  const handleDeleteLeg = React.useCallback((row: Row, legIndex: number): boolean => {
    if (!row.id.startsWith('P:')) return false;
    if (!window.confirm('Delete this leg from the position? This cannot be undone.')) return false;
    const pid = row.id.slice(2);
    updatePosition(pid, (p) => {
      const legs = p.legs.filter((_, idx) => idx !== legIndex);
      return { ...p, legs };
    });
    // If no legs remain, drop the entire position
    const checkRemoval = () => {
      const next = useStore.getState().positions.find((p) => p.id === pid);
      if (!next || next.legs.length === 0) removePosition(pid);
    };
    setTimeout(checkRemoval, 0);
    return true;
  }, [updatePosition, removePosition]);

  const hvSeriesRaw = React.useMemo(() => {
    if (!hvStats?.series?.length) return [] as number[];
    return hvStats.series.filter((v) => v != null && isFinite(v)) as number[];
  }, [hvStats]);
  const hvNormalization = React.useMemo(() => {
    if (!hvSeriesRaw.length) {
      return {
        factor: 1,
        latest: hvStats?.latest,
      };
    }
    const shouldScale = hvSeriesRaw.every((v) => Math.abs(v) <= 5);
    const factor = shouldScale ? 100 : 1;
    const latestRaw = hvStats?.latest;
    return {
      factor,
      latest: latestRaw != null && isFinite(latestRaw) ? latestRaw * factor : latestRaw,
    };
  }, [hvSeriesRaw, hvStats]);
  const hvLatest = hvNormalization.latest;

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('positions-columns-v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      setVisibleColumns((prev) => {
        const next = { ...prev };
        for (const col of COLUMN_CONFIG) {
          const stored = (parsed as Record<string, unknown>)[col.key];
          if (typeof stored === 'boolean') next[col.key] = stored;
        }
        if (!COLUMN_CONFIG.some((col) => next[col.key])) {
          for (const col of COLUMN_CONFIG) next[col.key] = true;
        }
        return next;
      });
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem('positions-columns-v1', JSON.stringify(visibleColumns));
    } catch {}
  }, [visibleColumns]);

  React.useEffect(() => {
    if (!columnsMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!columnsMenuRef.current) return;
      if (!columnsMenuRef.current.contains(event.target as Node)) {
        setColumnsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnsMenuOpen]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('positions-actions-v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      setActionVisibility((prev) => {
        const next = { ...prev };
        (Object.keys(next) as ActionKey[]).forEach((key) => {
          const value = (parsed as Record<string, unknown>)[key];
          if (typeof value === 'boolean') next[key] = value;
        });
        return next;
      });
    } catch {}
  }, []);

  React.useEffect(() => {
    try { localStorage.setItem('positions-actions-v1', JSON.stringify(actionVisibility)); } catch {}
  }, [actionVisibility]);

  React.useEffect(() => {
    if (!actionMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(event.target as Node)) setActionMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [actionMenuOpen]);

  const visibleColumnCount = React.useMemo(() => {
    return COLUMN_CONFIG.reduce((acc, col) => acc + (visibleColumns[col.key] ? 1 : 0), 0) || COLUMN_CONFIG.length;
  }, [visibleColumns]);

  const handleColumnToggle = React.useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const anyVisible = COLUMN_CONFIG.some((col) => next[col.key]);
      return anyVisible ? next : prev;
    });
  }, []);

  const handleSaveTemplate = React.useCallback((tpl: IfConditionTemplate) => {
    setIfTemplates((prev) => {
      const filtered = prev.filter((existing) => !(existing.name === tpl.name && existing.scope === tpl.scope));
      return [...filtered, tpl];
    });
  }, []);
  const handleDeleteTemplate = React.useCallback((tpl: IfConditionTemplate) => {
    setIfTemplates((prev) => prev.filter((existing) => !(existing.name === tpl.name && existing.scope === tpl.scope)));
  }, []);
  const handleDeleteTemplates = React.useCallback((tpls: IfConditionTemplate[]) => {
    if (!tpls.length) return;
    setIfTemplates((prev) => prev.filter((existing) => !tpls.some((tpl) => tpl.name === existing.name && tpl.scope === existing.scope)));
  }, []);
  // Real spot for IF-only calculations
  const [ifSpot, setIfSpot] = React.useState<number | undefined>();

  const openEditRow = React.useCallback((target: Row) => {
    if (!target) return;
    if (target.id.startsWith('P:')) {
      setEditId(target.id.slice(2));
      return;
    }
    if (target.id.startsWith('S:')) {
      try {
        addPosition({ legs: target.legs, note: target.note, portfolioId: target.portfolioId ?? activePortfolioId });
        const latest = useStore.getState().positions?.[0]?.id;
        removeSpread(target.id.slice(2));
        if (latest) setEditId(latest);
      } catch {}
    }
  }, [activePortfolioId, addPosition, removeSpread]);

  const openNotes = React.useCallback((target: Row) => {
    if (!target) return;
    setNoteRow(target);
    setNoteDraft(target.note ?? '');
  }, []);

  const closeNotes = React.useCallback(() => {
    setNoteRow(null);
    setNoteDraft('');
  }, []);

  React.useEffect(() => {
    if (!noteRow) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNotes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [noteRow, closeNotes]);

  const saveNotes = React.useCallback(() => {
    if (!noteRow) return;
    const trimmed = noteDraft.trim();
    const noteValue = trimmed.length ? trimmed : undefined;
    const rowId = noteRow.id;
    if (rowId.startsWith('S:')) {
      updateSpread(rowId.slice(2), (spread) => ({ ...spread, note: noteValue }));
    } else if (rowId.startsWith('P:')) {
      updatePosition(rowId.slice(2), (position) => ({ ...position, note: noteValue }));
    }
    setView((current) => current && current.id === rowId ? { ...current, note: noteValue } : current);
    setNoteRow(null);
    setNoteDraft('');
  }, [noteDraft, noteRow, setView, updatePosition, updateSpread]);

  // Load persisted UI prefs
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('positions-ui-v1');
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.tab === 'all' || s?.tab === 'fav') setTab(s.tab);
        if (s?.sortKey === 'date' || s?.sortKey === 'pnl' || s?.sortKey === 'theta' || s?.sortKey === 'expiry') setSortKey(s.sortKey);
        if (s?.sortDir === 'asc' || s?.sortDir === 'desc') setSortDir(s.sortDir);
        if (typeof s?.showClosed === 'boolean') setShowClosed(s.showClosed);
        if (typeof s?.useExecPnl === 'boolean') setUseExecPnl(s.useExecPnl);
        if (typeof s?.slowMode === 'boolean') setGlobalSlowMode(s.slowMode);
        if (typeof s?.hideExpired === 'boolean') setHideExpired(s.hideExpired);
      }
    } catch {}
  }, []);

  // Persist UI prefs
  React.useEffect(() => {
    const payload = { tab, sortKey, sortDir, showClosed, useExecPnl, hideExpired, slowMode };
    try {
      const raw = localStorage.getItem('positions-ui-v1');
      const base = raw ? JSON.parse(raw) : {};
      localStorage.setItem('positions-ui-v1', JSON.stringify({ ...base, ...payload }));
    } catch {}
  }, [tab, sortKey, sortDir, showClosed, useExecPnl, hideExpired, slowMode]);

  // Gamma removed from tables

  const rows: Row[] = React.useMemo(() => {
    const list = [
      ...spreads.map(fromSpread),
      ...positions.map(fromPosition),
    ].filter(r => (showClosed ? true : !r.closedAt));
    const byFavorite = tab === 'fav' ? list.filter(r => !!r.favorite) : list;
    const byExpiry = hideExpired ? byFavorite.filter(r => describeExpiry(r).state !== 'expired') : byFavorite;
    return byExpiry;
  }, [spreads, positions, showClosed, tab, hideExpired]);

  const runAutoSettle = React.useCallback(async () => {
    const rowsSnapshot = rowsRef.current;
    const now = Date.now();
    const attemptMap = autoSettleAttemptRef.current;
    const tasks: Array<Promise<void>> = [];
    rowsSnapshot.forEach((row) => {
      const isSpread = row.id.startsWith('S:');
      const rawId = row.id.slice(2);
      const settlements = row.settlements ?? {};
      const groups = new Map<number, PositionLeg>();
      row.legs.forEach((leg) => {
        if (leg.hidden) return;
        const expiryMs = Number(leg.leg.expiryMs) || 0;
        if (!(expiryMs > 0 && expiryMs <= now)) return;
        if (settlements[String(expiryMs)]) return;
        const symbol = String(leg.leg.symbol || '');
        if (!symbol.includes('-')) return;
        if (!groups.has(expiryMs)) groups.set(expiryMs, leg);
      });
      groups.forEach((leg, expiryMs) => {
        const key = `${row.id}:${expiryMs}`;
        const lastAttempt = attemptMap.get(key);
        if (lastAttempt != null && now - lastAttempt < 5 * 60 * 1000) return;
        attemptMap.set(key, now);
        tasks.push((async () => {
          try {
            const price = await fetchOptionDeliveryPrice(leg.leg.symbol);
            if (!(price != null && isFinite(price) && price > 0)) return;
            if (isSpread) setSpreadSettlement(rawId, expiryMs, price);
            else setPositionSettlement(rawId, expiryMs, price);
          } catch {
            // ignore single failure
          }
        })());
      });

      if (!row.closedAt) {
        const optionLegs = row.legs.filter((leg) => {
          if (leg.hidden) return false;
          const symbol = String(leg.leg.symbol || '');
          const expiryMs = Number(leg.leg.expiryMs) || 0;
          return symbol.includes('-') && expiryMs > 0;
        });
        if (optionLegs.length && optionLegs.every((leg) => Number(leg.leg.expiryMs) <= now)) {
          if (isSpread) markClosed(rawId); else closePosition(rawId);
        }
      }
    });
    if (tasks.length) {
      try { await Promise.allSettled(tasks); } catch {}
    }
  }, [setPositionSettlement, setSpreadSettlement]);

  React.useEffect(() => {
    rowsRef.current = rows;
    void runAutoSettle();
  }, [rows, runAutoSettle]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      void runAutoSettle();
    }, 60_000);
    return () => clearInterval(timer);
  }, [runAutoSettle]);

  const mergeTickerUpdate = React.useCallback((sym: string, payload: Record<string, any>) => {
    setTickers(prev => {
      const cur = prev[sym] || {};
      const merged: any = { ...cur };
      for (const [key, value] of Object.entries(payload)) {
        if (value == null) continue;
        if (typeof value === 'number' && Number.isNaN(value)) continue;
        merged[key] = value;
      }
      return { ...prev, [sym]: merged };
    });
  }, []);

  const captureRealtimeSnapshot = React.useCallback(async (symbols: string[]) => {
    const limited = symbols.slice(0, 180);
    await Promise.all(limited.map((sym) => new Promise<void>((resolve) => {
      let resolved = false;
      const stop = (sym.includes('-') ? subscribeOptionTicker : subscribeSpotTicker)(sym, (t) => {
        if (resolved) return;
        resolved = true;
        mergeTickerUpdate(sym, t as Record<string, any>);
        stop();
        resolve();
      });
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try { stop(); } catch {}
        resolve();
      }, 500);
    })));
  }, [mergeTickerUpdate]);

  const performSlowRefresh = React.useCallback(async () => {
    const rowsSnapshot = rowsRef.current;
    if (!rowsSnapshot.length) return;

    const [list, spotData] = await Promise.all([
      fetchOptionTickers(),
      fetchSpotEth().catch(() => undefined),
    ]);
    const map = new Map(list.map((t) => [t.symbol, t]));

    setTickers(prev => {
      const next = { ...prev } as Record<string, any>;
      rowsSnapshot.forEach(r => r.legs.forEach(l => {
        const sym = l.leg.symbol;
        const cur = next[sym] || {};
        const fresh = map.get(sym) || {};
        const merged: any = { ...cur };
        const keys = ['bid1Price','ask1Price','markPrice','markIv','indexPrice','delta','gamma','vega','theta','openInterest'];
        for (const k of keys) {
          const freshV = (fresh as any)[k];
          if (freshV != null && !Number.isNaN(freshV)) merged[k] = freshV;
        }
        next[sym] = merged;
      }));
      if (spotData?.price != null && isFinite(spotData.price)) {
        const price = Number(spotData.price);
        const existing = next['ETHUSDT'] || {};
        next['ETHUSDT'] = {
          ...existing,
          markPrice: price,
          indexPrice: price,
          bid1Price: existing.bid1Price ?? price,
          ask1Price: existing.ask1Price ?? price,
        };
      }
      return next;
    });

    const syms = Array.from(new Set(rowsSnapshot.flatMap(r => r.legs.map(L => L.leg.symbol)))).slice(0, 200);
    const chunkSize = 25;
    for (let i = 0; i < syms.length; i += chunkSize) {
      const chunk = syms.slice(i, i + chunkSize);
      const results = await Promise.allSettled(chunk.map(async (sym) => {
        const { bid, ask } = await fetchOrderbookL1(sym);
        return { sym, bid, ask };
      }));
      const updates: Record<string, { bid?: number; ask?: number }> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { sym, bid, ask } = result.value;
          if (bid != null || ask != null) updates[sym] = { bid, ask };
        }
      }
    if (Object.keys(updates).length) {
      setTickers(prev => {
        const next = { ...prev } as Record<string, any>;
        for (const [sym, { bid, ask }] of Object.entries(updates)) {
          next[sym] = { ...(next[sym] || {}), obBid: bid, obAsk: ask };
        }
        return next;
      });
    }
    if (i + chunkSize < syms.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

    await captureRealtimeSnapshot([
      ...Array.from(new Set(rowsSnapshot.flatMap(r => r.legs.map(L => L.leg.symbol)))),
      'ETHUSDT',
    ]);
  }, [captureRealtimeSnapshot, setTickers]);

  React.useEffect(() => {
    return register(() => performSlowRefresh());
  }, [performSlowRefresh, register]);

  React.useEffect(() => {
    if (!slowMode) return;
    performSlowRefresh().catch(() => {});
  }, [performSlowRefresh, slowMode]);

  React.useEffect(() => {
    if (slowMode) return;
    const symbols = new Set<string>();
    rows.forEach(r => r.legs.forEach(l => symbols.add(l.leg.symbol)));
    const unsubs = Array.from(symbols).slice(0, 1000).map(sym => {
      const isOption = sym.includes('-');
      const sub = isOption ? subscribeOptionTicker : subscribeSpotTicker;
      return sub(sym, (t) => setTickers(prev => {
        const cur = prev[t.symbol] || {};
        const merged: any = { ...cur };
        const keys: string[] = Object.keys(t as any);
        for (const k of keys) {
          const v: any = (t as any)[k];
          if (v != null && !(Number.isNaN(v))) (merged as any)[k] = v;
        }
        return { ...prev, [t.symbol]: merged };
      }));
    });
    return () => { unsubs.forEach(u => u()); };
  }, [rows, slowMode]);

  // Fetch HV30 once for IV comparisons
  React.useEffect(() => {
    let mounted = true;
    fetchHV30().then(v => { if (mounted) setHvStats(v); }).catch(()=>{});
    return () => { mounted = false; };
  }, []);
  // Subscribe real spot (ETHUSDT) for IF rules only
  React.useEffect(() => {
    const unsub = subscribeSpotTicker('ETHUSDT', (t) => {
      const p = (t.lastPrice != null && isFinite(Number(t.lastPrice))) ? Number(t.lastPrice) : (t.markPrice != null ? Number(t.markPrice) : undefined);
      if (p != null && isFinite(p)) setIfSpot(p);
    });
    return () => { try { unsub(); } catch {} };
  }, []);
  

  // Read persisted rate like View modal uses
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('position-view-ui-v1');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s?.rPct === 'number') setRPct(s.rPct);
    } catch {}
  }, []);

  // Persist IF rules
  React.useEffect(() => {
    try { localStorage.setItem('if-rules-v3', JSON.stringify(ifRules)); } catch {}
  }, [ifRules]);

  React.useEffect(() => {
    try { localStorage.setItem('if-templates-v1', JSON.stringify(ifTemplates)); } catch {}
  }, [ifTemplates]);

  // Helpers to compute per-leg metrics consistent with View
  function settlementForLeg(r: Row, L: PositionLeg) {
    const expiryMs = Number(L.leg.expiryMs) || 0;
    if (!(expiryMs > 0)) return undefined;
    const map = r.settlements;
    if (!map) return undefined;
    const entry = map[String(expiryMs)];
    if (!entry) return undefined;
    const settleUnderlying = Number(entry?.settleUnderlying);
    if (!(Number.isFinite(settleUnderlying) && settleUnderlying > 0)) return undefined;
    return entry;
  }

  function computeSpotForRow(r: Row): number | undefined {
    // Prefer real spot for IF, fallback to any leg's indexPrice or settlement snapshot
    if (ifSpot != null && isFinite(ifSpot)) return ifSpot;
    for (const L of r.legs) {
      const t = tickers[L.leg.symbol] || {};
      if (t?.indexPrice != null && isFinite(Number(t.indexPrice))) return Number(t.indexPrice);
    }
    if (r.settlements) {
      for (const info of Object.values(r.settlements)) {
        const s = Number(info?.settleUnderlying);
        if (Number.isFinite(s) && s > 0) return s;
      }
    }
    return undefined;
  }

  function describeExpiry(r: Row) {
    const now = Date.now();
    const optionLegs = r.legs.filter(L => !L.hidden && Number(L.leg.expiryMs) > 0);
    if (!optionLegs.length) return { state: 'active' as const, unsettled: false, expiredExpiries: [] as number[] };
    let expiredCount = 0;
    const expiredKeys = new Set<number>();
    let unsettled = false;
    for (const L of optionLegs) {
      const expiryMs = Number(L.leg.expiryMs) || 0;
      if (expiryMs > 0 && expiryMs <= now) {
        expiredCount++;
        expiredKeys.add(expiryMs);
        if (!settlementForLeg(r, L)) unsettled = true;
      }
    }
    if (!expiredCount) return { state: 'active' as const, unsettled: false, expiredExpiries: [] as number[] };
    const allExpired = expiredCount === optionLegs.length;
    return {
      state: allExpired ? ('expired' as const) : ('partial' as const),
      unsettled,
      expiredExpiries: Array.from(expiredKeys).sort(),
    };
  }

  function computeLegSnapshot(r: Row, L: PositionLeg) {
    const ticker = tickers[L.leg.symbol] || {};
    const qty = Number(L.qty) || 1;
    const entry = Number(L.entryPrice) || 0;
    const settlement = settlementForLeg(r, L);
    const isPerp = !String(L.leg.symbol || '').includes('-');
    const strike = Number(L.leg.strike) || 0;
    if (settlement) {
      const settleS = settlement.settleUnderlying;
      const price = isPerp ? settleS : (L.leg.optionType === 'C' ? Math.max(0, settleS - strike) : Math.max(0, strike - settleS));
      const mid = price;
      const exec = price;
      const pnl = (L.side === 'short' ? (entry - mid) : (mid - entry)) * qty;
      return {
        bid: undefined,
        ask: undefined,
        mid,
        exec,
        spread: undefined,
        oi: undefined,
        pnlMid: pnl,
        pnlExec: pnl,
        greeks: { delta: 0, gamma: 0, vega: 0, theta: 0 },
        settleS,
        settledAt: settlement.settledAt,
        settled: true,
      };
    }

    const { bid, ask } = bestBidAsk(ticker);
    const bidNum = bid != null && isFinite(Number(bid)) ? Number(bid) : undefined;
    const askNum = ask != null && isFinite(Number(ask)) ? Number(ask) : undefined;
    const midRaw = midPrice(ticker);
    const mid = midRaw != null && isFinite(Number(midRaw)) ? Number(midRaw) : 0;
    let exec = L.side === 'short' ? (askNum ?? mid) : (bidNum ?? mid);
    if (!(exec != null && isFinite(exec))) exec = mid;
    const pnlMid = (L.side === 'short' ? (entry - mid) : (mid - entry)) * qty;
    const pnlExec = (L.side === 'short' ? (entry - exec) : (exec - entry)) * qty;
    const greeks = {
      delta: ticker?.delta != null ? Number(ticker.delta) : 0,
      gamma: ticker?.gamma != null ? Number(ticker.gamma) : 0,
      vega: ticker?.vega != null ? Number(ticker.vega) : 0,
      theta: ticker?.theta != null ? Number(ticker.theta) : 0,
    };
    const spread = (bidNum != null && askNum != null && bidNum > 0 && askNum > 0) ? Math.max(0, askNum - bidNum) : undefined;
    const oi = ticker?.openInterest != null ? Number(ticker.openInterest) : undefined;
    return {
      bid: bidNum,
      ask: askNum,
      mid,
      exec,
      spread,
      oi,
      pnlMid,
      pnlExec,
      greeks,
      settleS: undefined,
      settledAt: undefined,
      settled: false,
    };
  }
  const ivPctForLeg = (L: PositionLeg, r: Row): number | undefined => {
    if (settlementForLeg(r, L)) return undefined;
    const expiryMs = Number(L.leg.expiryMs) || 0;
    if (expiryMs > 0 && expiryMs <= Date.now()) return undefined;
    const t = tickers[L.leg.symbol] || {};
    const ivMark = t?.markIv != null ? Number(t.markIv) : undefined;
    if (ivMark != null && isFinite(ivMark)) return ivMark <= 3 ? ivMark * 100 : ivMark;
    const S = t?.indexPrice != null ? Number(t.indexPrice) : computeSpotForRow(r);
    const K = Number(L.leg.strike) || 0;
    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
    const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
    if (S != null && isFinite(S) && K > 0 && T > 0 && markPrice != null && isFinite(markPrice) && markPrice >= 0) {
      const iv = bsImpliedVol(L.leg.optionType, S, K, T, markPrice, rPct / 100);
      if (iv != null && isFinite(iv)) return iv * 100;
    }
    let ivFromBook: number | undefined;
    if (S != null && isFinite(S) && K > 0 && T > 0) {
      const { bid, ask } = bestBidAsk(t);
      const ivBid = (bid != null && isFinite(bid) && bid >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, bid, rPct / 100) : undefined;
      const ivAsk = (ask != null && isFinite(ask) && ask >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, ask, rPct / 100) : undefined;
      if (ivBid != null && isFinite(ivBid) && ivAsk != null && isFinite(ivAsk)) ivFromBook = 0.5 * (ivBid + ivAsk);
      else if (ivBid != null && isFinite(ivBid)) ivFromBook = ivBid;
      else if (ivAsk != null && isFinite(ivAsk)) ivFromBook = ivAsk;
    }
    if (ivFromBook != null && isFinite(ivFromBook)) return ivFromBook * 100;
    const mid = midPrice(t);
    if (S != null && isFinite(S) && K > 0 && T > 0 && mid != null && isFinite(mid) && mid >= 0) {
      const iv = bsImpliedVol(L.leg.optionType, S, K, T, mid, rPct / 100);
      if (iv != null && isFinite(iv)) return iv * 100;
    }
    const v = hvLatest;
    return (v != null && isFinite(v)) ? Number(v) : undefined;
  };
  const dSigmaForLeg = (L: PositionLeg, r: Row): number | undefined => {
    if (settlementForLeg(r, L)) return undefined;
    const expiryMs = Number(L.leg.expiryMs) || 0;
    if (expiryMs > 0 && expiryMs <= Date.now()) return undefined;
    const t = tickers[L.leg.symbol] || {};
    const S = t?.indexPrice != null ? Number(t.indexPrice) : computeSpotForRow(r);
    const K = Number(L.leg.strike) || 0;
    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
    if (!(S != null && isFinite(S) && K > 0 && T > 0)) return undefined;
    const mid = midPrice(t);
    const ivMid = (mid != null && isFinite(mid) && mid >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, mid, rPct / 100) : undefined;
    const rawMarkIvPct = t?.markIv != null ? Number(t.markIv) : undefined;
    const markIvPct = (rawMarkIvPct != null && isFinite(rawMarkIvPct)) ? (rawMarkIvPct <= 3 ? rawMarkIvPct * 100 : rawMarkIvPct) : undefined;
    const sigmaFromMarkIv = (markIvPct != null && isFinite(markIvPct)) ? (markIvPct / 100) : undefined;
    const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
    const sigmaFromMarkPrice = (markPrice != null && isFinite(markPrice) && markPrice >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, markPrice, rPct / 100) : undefined;
    let sigmaFromBook: number | undefined;
    {
      const { bid, ask } = bestBidAsk(t);
      const ivBid = (bid != null && isFinite(bid) && bid >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, bid, rPct / 100) : undefined;
      const ivAsk = (ask != null && isFinite(ask) && ask >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, ask, rPct / 100) : undefined;
      if (ivBid != null && isFinite(ivBid) && ivAsk != null && isFinite(ivAsk)) sigmaFromBook = 0.5 * (ivBid + ivAsk);
      else if (ivBid != null && isFinite(ivBid)) sigmaFromBook = ivBid;
      else if (ivAsk != null && isFinite(ivAsk)) sigmaFromBook = ivAsk;
    }
    const sigmaFromHV = (hvLatest != null && isFinite(hvLatest)) ? (Number(hvLatest) / 100) : undefined;
    const sigmaRef = sigmaFromMarkIv ?? sigmaFromMarkPrice ?? sigmaFromBook ?? sigmaFromHV;
    if (!(ivMid != null && isFinite(ivMid) && sigmaRef != null && isFinite(sigmaRef))) return undefined;
    const dSigmaPp = (ivMid - sigmaRef) * 100;
    return dSigmaPp;
  };

  // Max possible profit at expiry (finite) or undefined if unbounded/invalid
  const maxProfitForRow = (r: Row, c: ReturnType<typeof calc>): number | undefined => {
    try {
      const legs = r.legs;
      const strikes = legs.map(L => Number(L.leg.strike) || 0).filter(s => isFinite(s));
      if (!strikes.length) return undefined;
      const Ks = Array.from(new Set(strikes)).sort((a,b)=>a-b);
      const netEntry = c.netEntry;
      const pnlAt = (S: number) => {
        let signedVal = 0;
        for (const L of legs) {
          const isPerp = !String(L.leg.symbol).includes('-');
          const K = Number(L.leg.strike) || 0; const q = Number(L.qty) || 1; const sign = L.side === 'short' ? 1 : -1;
          const intrinsic = isPerp ? S : (L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S));
          signedVal += sign * intrinsic * q;
        }
        return netEntry - signedVal;
      };
      // Unbounded check to the right (calls and PERP)
      let s = 0;
      for (const L of legs) {
        const isPerp = !String(L.leg.symbol).includes('-');
        if (L.leg.optionType === 'C' || isPerp) s += (L.side === 'short' ? 1 : -1) * (Number(L.qty) || 1);
      }
      const slopeRight = -s;
      if (slopeRight > 0) return undefined; // unbounded profit to the right
      const S0 = 0;
      const Sbig = (Ks.length ? Ks[Ks.length - 1] : 1000) * 5 + 1;
      const candidates = [S0, ...Ks, Sbig];
      let maxV = -Infinity;
      for (const S of candidates) {
        const v = pnlAt(S);
        if (isFinite(v) && v > maxV) maxV = v;
      }
      return isFinite(maxV) ? maxV : undefined;
    } catch { return undefined; }
  };

  type PositionEvalContext = {
    row: Row;
    calc: ReturnType<typeof calc>;
    spot: number | undefined;
    maxProfitCache?: number | null;
    legCache: Map<string, LegMetrics>;
  };

  type LegMetrics = {
    bid?: number;
    ask?: number;
    mid?: number;
    exec?: number;
    entry?: number;
    pnlMid?: number;
    pnlExec?: number;
    ivPct?: number;
    delta?: number;
    vega?: number;
    theta?: number;
    oi?: number;
    dSigma?: number;
    settleS?: number;
    settledAt?: number;
    settled?: boolean;
  };

  const ensureMaxProfit = (ctx: PositionEvalContext): number | undefined => {
    if (ctx.maxProfitCache === null) return undefined;
    if (ctx.maxProfitCache != null) return ctx.maxProfitCache;
    const mp = maxProfitForRow(ctx.row, ctx.calc);
    if (!(mp != null && isFinite(mp))) {
      ctx.maxProfitCache = null;
      return undefined;
    }
    ctx.maxProfitCache = mp;
    return mp;
  };

  const positionMetricValue = (param: string, ctx: PositionEvalContext): number | undefined => {
    const pnlValue = useExecPnl ? ctx.calc.pnlExec : ctx.calc.pnl;
    switch (param) {
      case 'spot': return ctx.spot;
      case 'netEntry': return ctx.calc.netEntry;
      case 'netMid': return ctx.calc.netMid;
      case 'kmid': {
        const entry = ctx.calc.netEntry;
        if (!(entry != null && isFinite(entry) && Math.abs(entry) > 1e-12)) return undefined;
        const ratio = ctx.calc.netMid / entry;
        return Number.isFinite(ratio) ? ratio : undefined;
      }
      case 'pnl': return pnlValue;
      case 'pnlPctMax': {
        const mp = ensureMaxProfit(ctx);
        if (!(mp != null && isFinite(mp) && mp > 0)) return undefined;
        return (pnlValue / mp) * 100;
      }
      case 'delta': return ctx.calc.greeks.delta;
      case 'vega': return ctx.calc.greeks.vega;
      case 'theta': return ctx.calc.greeks.theta;
      case 'dte': return ctx.calc.dte ?? undefined;
      default: return undefined;
    }
  };

  const buildLegMetrics = (L: PositionLeg, r: Row): LegMetrics => {
    const snap = computeLegSnapshot(r, L);
    const entryRaw = Number(L.entryPrice);
    const entry = Number.isFinite(entryRaw) ? entryRaw : undefined;
    const qty = Number(L.qty) || 1;
    const sign = L.side === 'short' ? 1 : -1;
    const pnlMid = snap.pnlMid != null ? snap.pnlMid : (entry != null && snap.mid != null ? sign * (entry - snap.mid) * qty : undefined);
    const pnlExec = snap.pnlExec != null ? snap.pnlExec : (entry != null && snap.exec != null ? sign * (entry - snap.exec) * qty : undefined);
    const greeks = snap.greeks || { delta: 0, vega: 0, theta: 0 };
    const delta = greeks.delta != null ? (L.side === 'long' ? greeks.delta : -greeks.delta) : undefined;
    const vega = greeks.vega != null ? (L.side === 'long' ? greeks.vega : -greeks.vega) : undefined;
    const theta = greeks.theta != null ? (L.side === 'long' ? greeks.theta : -greeks.theta) : undefined;
    const ivPct = snap.settled ? undefined : ivPctForLeg(L, r);
    const dSigma = snap.settled ? undefined : dSigmaForLeg(L, r);
    return {
      bid: snap.bid,
      ask: snap.ask,
      mid: snap.mid,
      exec: snap.exec,
      entry,
      pnlMid,
      pnlExec,
      delta,
      vega,
      theta,
      oi: snap.oi,
      ivPct,
      dSigma,
      settleS: snap.settleS,
      settledAt: snap.settledAt,
      settled: snap.settled,
    };
  };

  const metricsForSymbol = (ctx: PositionEvalContext, symbol?: string): LegMetrics | undefined => {
    if (!symbol) return undefined;
    if (ctx.legCache.has(symbol)) return ctx.legCache.get(symbol);
    const leg = ctx.row.legs.find((L) => L.leg.symbol === symbol);
    if (!leg) return undefined;
    const metrics = buildLegMetrics(leg, ctx.row);
    ctx.legCache.set(symbol, metrics);
    return metrics;
  };

  const legMetricValue = (param: string, ctx: PositionEvalContext, leg?: LegMetrics): number | undefined => {
    if (param === 'spot') return ctx.spot;
    if (!leg) return undefined;
    switch (param) {
      case 'bid': return leg.bid;
      case 'ask': return leg.ask;
      case 'mid': return leg.mid;
      case 'exec': return leg.exec;
      case 'entry': return leg.entry;
      case 'pnlLeg': return useExecPnl ? leg.pnlExec : leg.pnlMid;
      case 'ivPct': return leg.ivPct;
      case 'vega': return leg.vega;
      case 'delta': return leg.delta;
      case 'theta': return leg.theta;
      case 'oi': return leg.oi;
      case 'dSigma': return leg.dSigma;
      default: return undefined;
    }
  };

  const evalOperand = (operand: IfOperand, ctx: PositionEvalContext, legCtx?: { metrics?: LegMetrics; symbol?: string }): number | undefined => {
    if (operand.kind === 'number') {
      const v = Number(operand.value);
      return Number.isFinite(v) ? v : undefined;
    }
    if (operand.kind === 'position') {
      return positionMetricValue(operand.metric, ctx);
    }
    if (operand.kind === 'leg') {
      if (operand.legMode === 'current') {
        const metrics = legCtx?.metrics;
        return legMetricValue(operand.metric, ctx, metrics);
      }
      const metrics = metricsForSymbol(ctx, operand.symbol);
      return legMetricValue(operand.metric, ctx, metrics);
    }
    return undefined;
  };

  const evalSide = (side: IfSide, ctx: PositionEvalContext, legCtx?: { metrics?: LegMetrics; symbol?: string }): number | undefined => {
    const base = evalOperand(side.base, ctx, legCtx);
    if (!(base != null && isFinite(base))) return undefined;
    if (!side.op) return base;
    const rhs = evalOperand(side.op.operand, ctx, legCtx);
    if (!(rhs != null && isFinite(rhs))) return undefined;
    switch (side.op.operator) {
      case '+': return base + rhs;
      case '-': return base - rhs;
      case '*': return base * rhs;
      case '/': return Math.abs(rhs) < 1e-12 ? undefined : base / rhs;
      default: return undefined;
    }
  };

  const compareNumbers = (lhs: number | undefined, cmp: IfComparator, rhs: number | undefined): boolean => {
    if (!(lhs != null && isFinite(lhs))) return false;
    if (!(rhs != null && isFinite(rhs))) return false;
    if (cmp === '>') return lhs > rhs;
    if (cmp === '<') return lhs < rhs;
    if (cmp === '>=') return lhs >= rhs;
    if (cmp === '<=') return lhs <= rhs;
    return Math.abs(lhs - rhs) < 1e-9;
  };

  const evaluateCondSnapshot = (cond: IfCond, ctx: PositionEvalContext, legCtx?: { metrics?: LegMetrics; symbol?: string }): { satisfied: boolean; lhs?: number; rhs?: number } => {
    const lhs = evalSide(cond.left, ctx, legCtx);
    const rhs = evalSide(cond.right, ctx, legCtx);
    return { satisfied: compareNumbers(lhs, cond.cmp, rhs), lhs, rhs };
  };

  const evaluateCond = (cond: IfCond, ctx: PositionEvalContext, legCtx?: { metrics?: LegMetrics; symbol?: string }): boolean => {
    return evaluateCondSnapshot(cond, ctx, legCtx).satisfied;
  };

  // Evaluate a single condition live for IF modal preview
  const evalSingleCondLive = (r: Row, args: { scope: 'position'|'leg'; legSymbol?: string; cond: IfCond }): boolean => {
    const { scope, legSymbol, cond } = args;
    const c = calc(r);
    const ctx: PositionEvalContext = { row: r, calc: c, spot: computeSpotForRow(r), maxProfitCache: undefined, legCache: new Map() };
    if (scope === 'position') {
      return evaluateCond(cond, ctx);
    }
    const legs = r.legs.filter(L => !legSymbol || L.leg.symbol === legSymbol);
    for (const L of legs) {
      const metrics = buildLegMetrics(L, r);
      if (evaluateCond(cond, ctx, { metrics, symbol: L.leg.symbol })) return true;
    }
    return false;
  };

  const evalCondDetails = (r: Row, args: { scope: 'position'|'leg'; legSymbol?: string; cond: IfCond }): { satisfied: boolean; lhs?: number; rhs?: number } | undefined => {
    const { scope, legSymbol, cond } = args;
    const c = calc(r);
    const ctx: PositionEvalContext = { row: r, calc: c, spot: computeSpotForRow(r), maxProfitCache: undefined, legCache: new Map() };
    if (scope === 'position') {
      return evaluateCondSnapshot(cond, ctx);
    }
    const legs = r.legs.filter(L => !legSymbol || L.leg.symbol === legSymbol);
    let fallback: { satisfied: boolean; lhs?: number; rhs?: number } | undefined;
    for (const L of legs) {
      const metrics = buildLegMetrics(L, r);
      const snap = evaluateCondSnapshot(cond, ctx, { metrics, symbol: L.leg.symbol });
      if (!fallback) fallback = snap;
      if (snap.satisfied) return snap;
    }
    return fallback;
  };

  const evalChainLeg = (r: Row, c: ReturnType<typeof calc>, chain: IfChain): Set<string> => {
    const matchedSyms = new Set<string>();
    const ctx: PositionEvalContext = { row: r, calc: c, spot: computeSpotForRow(r), maxProfitCache: undefined, legCache: new Map() };
    const iterLegs = r.legs.filter(L => !chain.legSymbol || L.leg.symbol === chain.legSymbol);
    for (const L of iterLegs) {
      const metrics = buildLegMetrics(L, r);
      const legCtx = { metrics, symbol: L.leg.symbol };
      let ok: boolean | undefined = undefined;
      for (let i = 0; i < chain.conds.length; i++) {
        const it = chain.conds[i];
        const cur = evaluateCond(it.cond, ctx, legCtx);
        if (i === 0) ok = cur; else ok = (it.conj === 'OR') ? ((ok as boolean) || cur) : ((ok as boolean) && cur);
      }
      if (ok) matchedSyms.add(L.leg.symbol);
    }
    return matchedSyms;
  };
  const evalChainPos = (r: Row, c: ReturnType<typeof calc>, chain: IfChain) => {
    const ctx: PositionEvalContext = { row: r, calc: c, spot: computeSpotForRow(r), maxProfitCache: undefined, legCache: new Map() };
    let ok: boolean | undefined = undefined;
    for (let i = 0; i < chain.conds.length; i++) {
      const it = chain.conds[i];
      const cur = evaluateCond(it.cond, ctx);
      if (i === 0) ok = cur; else ok = (it.conj === 'OR') ? ((ok as boolean) || cur) : ((ok as boolean) && cur);
    }
    return !!ok;
  };
  const evalRule = (r: Row, c: ReturnType<typeof calc>, rule?: IfRule): { matched: boolean; matchedLegs?: Set<string> } => {
    if (!rule || !rule.chains.length) return { matched: false };
    let agg: boolean | undefined = undefined;
    let matchedLegs = new Set<string>();
    for (let i = 0; i < rule.chains.length; i++) {
      const wrap = rule.chains[i];
      const ch = wrap.chain;
      let cur: boolean;
      if (ch.scope === 'leg') {
        const syms = evalChainLeg(r, c, ch);
        if (syms.size > 0) { cur = true; syms.forEach(s=>matchedLegs.add(s)); } else cur = false;
      } else {
        cur = evalChainPos(r, c, ch);
      }
      if (i === 0) agg = cur; else agg = (wrap.conj === 'OR') ? ((agg as boolean) || cur) : ((agg as boolean) && cur);
    }
    return { matched: !!agg, matchedLegs };
  };

  // Per-leg highlight: a leg is highlighted if it satisfies the combined result of ONLY leg-scope chains
  const matchedLegsOnly = (r: Row, c: ReturnType<typeof calc>, rule?: IfRule): Set<string> => {
    const out = new Set<string>();
    if (!rule || !rule.chains.length) return out;
    const legChains = rule.chains.filter(w => w.chain.scope === 'leg');
    if (!legChains.length) return out;
    const ctx: PositionEvalContext = { row: r, calc: c, spot: computeSpotForRow(r), maxProfitCache: undefined, legCache: new Map() };
    for (const L of r.legs) {
      // Only consider chains that target this symbol or any
      const relevant = legChains.filter(w => !w.chain.legSymbol || w.chain.legSymbol === L.leg.symbol);
      if (!relevant.length) continue;
      const metrics = buildLegMetrics(L, r);
      const legCtx = { metrics, symbol: L.leg.symbol };
      let agg: boolean | undefined = undefined;
      for (let i = 0; i < relevant.length; i++) {
        const wrap = relevant[i];
        const ch = wrap.chain;
        let cur: boolean | undefined = undefined;
        for (let j = 0; j < ch.conds.length; j++) {
          const it = ch.conds[j];
          const here = evaluateCond(it.cond, ctx, legCtx);
          if (j === 0) cur = here; else cur = (it.conj === 'OR') ? ((cur as boolean) || here) : ((cur as boolean) && here);
        }
        if (i === 0) agg = !!cur; else agg = (wrap.conj === 'OR') ? ((agg as boolean) || !!cur) : ((agg as boolean) && !!cur);
      }
      if (agg) out.add(L.leg.symbol);
    }
    return out;
  };

  // REST fallback to populate bid/ask for symbols missing them in WS
  React.useEffect(() => {
    if (slowMode) return;
    let mounted = true;
    const run = async () => {
      try {
        const list = await fetchOptionTickers();
        if (!mounted) return;
        const map = Object.fromEntries(list.map(t => [t.symbol, t]));
        setTickers(prev => {
          const next = { ...prev } as Record<string, any>;
          rows.forEach(r => r.legs.forEach(l => {
            const sym = l.leg.symbol;
            const cur = next[sym] || {};
            const fresh: any = map[sym] || {};
            const merged: any = { ...cur };
            const keys = ['bid1Price','ask1Price','markPrice','markIv','indexPrice','delta','gamma','vega','theta','openInterest'];
            for (const k of keys) {
              const curV = cur[k];
              const freshV = fresh[k];
              if ((curV == null || Number.isNaN(curV)) && freshV != null && !Number.isNaN(freshV)) merged[k] = freshV;
            }
            next[sym] = merged;
          }));
          return next;
        });
      } catch {}
    };
    run();
    const id = setInterval(run, 30000);
    return () => { mounted = false; clearInterval(id); };
  }, [rows, slowMode]);

  // REST L1 fallback for stubborn symbols (polls small set of visible legs)
  React.useEffect(() => {
    if (slowMode) return;
    let stopped = false;
    const poll = async () => {
      const syms = Array.from(new Set(rows.flatMap(r => r.legs.map(L => L.leg.symbol)))).slice(0, 120);
      for (const sym of syms) {
        if (stopped) return;
        try {
          const { bid, ask } = await fetchOrderbookL1(sym);
          if (bid != null || ask != null) {
            setTickers(prev => ({ ...prev, [sym]: { ...(prev[sym] || {}), obBid: bid, obAsk: ask } }));
          }
        } catch {}
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { stopped = true; clearInterval(id); };
  }, [rows, slowMode]);

  const calc = (r: Row) => {
    const legs = r.legs.filter(L => !L.hidden).map((L) => ({
      ...L,
      ...computeLegSnapshot(r, L),
    })) as LegSnapshot[];
    const netEntry = legs.reduce((acc, L) => acc + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);
    const netMid = legs.reduce((acc, L) => acc + (L.side === 'short' ? 1 : -1) * (Number(L.mid) || 0) * (Number(L.qty) || 1), 0);
    const netExec = legs.reduce((acc, L) => acc + (L.side === 'short' ? 1 : -1) * (Number(L.exec) || 0) * (Number(L.qty) || 1), 0);
    const pnl = netEntry - netMid;
    const pnlExec = netEntry - netExec;
    const g = legs.reduce((acc, L) => {
      const sign = L.side === 'long' ? 1 : -1;
      const qty = Number(L.qty) || 1;
      const greeks = L.greeks || { delta: 0, gamma: 0, vega: 0, theta: 0 };
      return {
        delta: acc.delta + sign * (greeks.delta || 0) * qty,
        gamma: acc.gamma + sign * (greeks.gamma || 0) * qty,
        vega: acc.vega + sign * (greeks.vega || 0) * qty,
        theta: acc.theta + sign * (greeks.theta || 0) * qty,
      };
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
    const spreadsArr = legs.map(L => L.spread).filter((v): v is number => v != null && Number.isFinite(v));
    const ois = legs.map(L => L.oi).filter((v): v is number => v != null && Number.isFinite(v));
    const spreadPcts = legs
      .map(L => (L.spread != null && Number.isFinite(L.spread) && (Number(L.mid) || 0) > 0)
        ? (L.spread / Number(L.mid)) * 100
        : undefined)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const liq = {
      maxSpread: spreadsArr.length ? Math.max(...spreadsArr) : undefined,
      minOI: ois.length ? Math.min(...ois) : undefined,
      maxSpreadPct: spreadPcts.length ? Math.max(...spreadPcts) : undefined,
    } as { maxSpread?: number; minOI?: number; maxSpreadPct?: number };

    let width: number | undefined;
    let maxLoss: number | undefined;
    let dte: number | undefined;
    const expSet = Array.from(new Set(legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0)));
    if (expSet.length >= 1) {
      const nearest = Math.min(...expSet);
      dte = Math.max(0, Math.round((nearest - Date.now()) / (1000 * 60 * 60 * 24)));
    }
    if (r.kind === 'vertical' && expSet.length === 1) {
      const strikes = legs.map(L => Number(L.leg.strike) || 0);
      width = Math.abs(strikes[0] - strikes[1]);
      maxLoss = Math.max(0, (width - (r.cEnter ?? 0)) * (r.qty ?? 1));
    }

    return {
      legs,
      netEntry,
      netMid,
      netExec,
      pnl,
      pnlExec,
      greeks: g,
      liq,
      width,
      maxLoss,
      dte,
    };
  };

  const exportCSV = () => {
    const rowsCSV = rows.map((r) => {
      const c = calc(r);
      return {
        id: r.id,
        kind: r.kind,
        legs: r.legs.filter(L => !L.hidden).map(L => `${L.side}${L.leg.optionType}${L.leg.strike}x${L.qty}@${L.entryPrice}`).join(' | '),
        expiry: Array.from(new Set(r.legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0).map(ms => new Date(ms).toISOString().slice(0,10)))).join(' & '),
        netEntry: c.netEntry.toFixed(2),
        netMid: c.netMid.toFixed(2),
        pnl: c.pnl.toFixed(2),
        delta: c.greeks.delta.toFixed(3),
        gamma: c.greeks.gamma.toFixed(4),
        vega: c.greeks.vega.toFixed(3),
        theta: c.greeks.theta.toFixed(3),
        maxSpread: (c.liq.maxSpread != null && isFinite(c.liq.maxSpread)) ? c.liq.maxSpread.toFixed(2) : '',
        minOI: (c.liq.minOI != null && isFinite(c.liq.minOI)) ? String(c.liq.minOI) : '',
        width: c.width != null ? c.width.toFixed(2) : '',
        maxLoss: c.maxLoss != null ? c.maxLoss.toFixed(2) : '',
        dte: c.dte != null ? String(c.dte) : '',
        note: r.note ?? '',
      };
    });
    const csv = toCSV(rowsCSV);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCSV(`positions-${ts}.csv`, csv);
  };

  const isVerticalLike = (legs: PositionLeg[]) => {
    if (legs.length !== 2) return false;
    const [a, b] = legs;
    const sameType = a.leg.optionType === b.leg.optionType;
    const sameExp = a.leg.expiryMs === b.leg.expiryMs;
    const opposite = a.side !== b.side;
    return sameType && sameExp && opposite;
  };

  const buildSpreadForView = (r: Row) => {
    const [a, b] = r.legs;
    const short = a.side === 'short' ? a : b;
    const long = a.side === 'long' ? a : b;
    const qty = Math.min(Number(short.qty)||1, Number(long.qty)||1) || 1;
    const cEnter = (r.cEnter != null ? r.cEnter : (Number(short.entryPrice)||0) - (Number(long.entryPrice)||0));
    return {
      position: { id: r.id, short: short.leg, long: long.leg, cEnter, qty, createdAt: r.createdAt } as any,
      calc: {
        width: Math.abs(short.leg.strike - long.leg.strike),
        maxLoss: Math.max(0, Math.abs(short.leg.strike - long.leg.strike) - cEnter) * qty,
        priceNow: undefined,
        pnl: undefined,
        pnlPct: undefined,
        deltaShort: undefined,
      } as any
    };
  };

  const buildCloseSnapshot = (r: Row): CloseSnapshot => {
    const now = Date.now();
    const calcSnapshot = calc(r);
    const indexPrice = (() => {
      for (const leg of r.legs) {
        const ticker = tickers[leg.leg.symbol];
        const raw = ticker?.indexPrice;
        if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
      }
      return undefined;
    })();
    const spotCandidate = computeSpotForRow(r);
    const spotPrice = spotCandidate != null && Number.isFinite(Number(spotCandidate)) ? Number(spotCandidate) : undefined;
    const pnlExec = Number.isFinite(calcSnapshot.pnlExec) ? calcSnapshot.pnlExec : undefined;
    const snapshot: CloseSnapshot = { timestamp: now };
    if (indexPrice != null) snapshot.indexPrice = indexPrice;
    if (spotPrice != null) snapshot.spotPrice = spotPrice;
    if (pnlExec != null) snapshot.pnlExec = pnlExec;
    return snapshot;
  };

  const applyCloseSnapshot = (row: Row, snapshot: CloseSnapshot) => {
    if (row.id.startsWith('S:')) markClosed(row.id.slice(2), snapshot);
    else closePosition(row.id.slice(2), snapshot);
    setView((current) => {
      if (!current || current.id !== row.id) return current;
      return { ...current, closedAt: snapshot.timestamp, closeSnapshot: snapshot };
    });
  };

  const onCloseRow = (r: Row) => {
    if (r.closedAt != null) return;
    const snapshot = buildCloseSnapshot(r);
    applyCloseSnapshot(r, snapshot);
  };
  const onDeleteRow = (r: Row) => {
    if (r.id.startsWith('S:')) removeSpread(r.id.slice(2)); else removePosition(r.id.slice(2));
  };

  return (
    <div>
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom: 12}}>
        <h3 style={{margin: 0}}>My Positions</h3>
        <label style={{display:'flex', alignItems:'center', gap:6}}>
          <span className="muted">Portfolio</span>
          <select value={activePortfolioId} onChange={handlePortfolioSelect}>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button
          className="ghost"
          onClick={() => {
            setPortfolioNameDraft('');
            setCreatePortfolioError(null);
            setShowCreatePortfolioModal(true);
          }}
        >
          Create Portfolio
        </button>
        <div style={{marginLeft:'auto'}}></div>
        <button className="primary" onClick={() => setShowAddPosition(true)}>Add Position</button>
      </div>
      <div style={{display:'flex', gap: 8, alignItems:'center', marginBottom: 6, flexWrap:'wrap'}}>
        <button className="ghost" onClick={exportCSV}>Export CSV</button>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', flex: '1 1 auto'}}>
          <label style={{display:'flex', gap:4, alignItems:'center', fontSize:'0.85em'}}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            <span className="muted">Show closed</span>
          </label>
          <label style={{display:'flex', gap:4, alignItems:'center', fontSize:'0.85em'}}>
            <input type="checkbox" checked={hideExpired} onChange={(e) => setHideExpired(e.target.checked)} />
            <span className="muted">Hide expired</span>
          </label>
          <label style={{display:'flex', gap:4, alignItems:'center', fontSize:'0.85em'}}>
            <input type="checkbox" checked={useExecPnl} onChange={(e) => setUseExecPnl(e.target.checked)} />
            <span className="muted">PNL($) exec</span>
          </label>
          <label style={{display:'flex', gap:4, alignItems:'center', fontSize:'0.85em'}}>
            <input type="checkbox" checked={slowMode} onChange={(e) => setGlobalSlowMode(e.target.checked)} />
            <span className="muted">Slow refresh (5 min)</span>
          </label>
          {slowMode && (
            <div style={{display:'flex', alignItems:'center', gap:8, marginLeft:24, flexWrap:'wrap'}}>
              <span className="muted">Last update: {slowStats.lastUpdated ? new Date(slowStats.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <span className="muted">Next: {slowStats.nextUpdate ? new Date(slowStats.nextUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <button className="ghost" onClick={() => { void manualRefresh(); }} disabled={slowStats.refreshing}>
                {slowStats.refreshing ? 'Refreshing…' : 'Refresh now'}
              </button>
              {slowStats.error && <span style={{color:'#c7762b'}}>{slowStats.error}</span>}
            </div>
          )}
        </div>
        <div style={{display:'flex', gap:12, alignItems:'center', marginLeft:'auto', flexWrap:'wrap', justifyContent:'flex-end'}}>
          <div style={{display:'flex', gap:6}}>
            <button className={tab==='all' ? 'primary' : 'ghost'} onClick={() => setTab('all')}>All</button>
            <button className={tab==='fav' ? 'primary' : 'ghost'} onClick={() => setTab('fav')}>Favorites</button>
          </div>
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <span className="muted">Sort:</span>
            <button className={sortKey==='date' ? 'primary' : 'ghost'} onClick={() => setSortKey('date')}>Date</button>
            <button className={sortKey==='pnl' ? 'primary' : 'ghost'} onClick={() => setSortKey('pnl')}>PnL</button>
            <button className={sortKey==='theta' ? 'primary' : 'ghost'} onClick={() => setSortKey('theta')}>Theta</button>
            <button className={sortKey==='expiry' ? 'primary' : 'ghost'} onClick={() => { setSortKey('expiry'); setSortDir('asc'); }}>Expiry</button>
            <button className="ghost" title={sortDir==='desc' ? 'Descending' : 'Ascending'} onClick={() => setSortDir(d => d==='desc'?'asc':'desc')}>{sortDir==='desc' ? '↓' : '↑'}</button>
            <div ref={columnsMenuRef} style={{ position: 'relative', marginLeft: 12 }}>
              <button
                className="ghost"
                onClick={() => setColumnsMenuOpen((open) => !open)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10 }}
              >
                Columns
                <span style={{ fontSize: '0.9em' }}>{columnsMenuOpen ? '▴' : '▾'}</span>
              </button>
              {columnsMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 4px)',
                    background: 'var(--card)',
                    color: 'var(--fg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    boxShadow: '0 12px 24px rgba(0,0,0,.40)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minWidth: 180,
                    zIndex: 40,
                  }}
                >
                  {COLUMN_CONFIG.map((col) => (
                    <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95em' }}>
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.key]}
                        onChange={() => handleColumnToggle(col.key)}
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr style={{ fontSize: 'calc(1em - 2px)' }}>
              {visibleColumns.type && <th style={typeColumnStyle}>Type</th>}
              {visibleColumns.legs && <th style={legsColumnStyle}>Legs</th>}
              {visibleColumns.expiry && <th>Expiry / DTE</th>}
              {visibleColumns.netEntry && <th>Net entry</th>}
              {visibleColumns.netMid && <th>Net mid</th>}
              {visibleColumns.pnl && (
                <th>
                  PnL ($)
                  {useExecPnl && <span style={{ marginLeft: 4, fontSize: '0.75em' }}>exec</span>}
                </th>
              )}
              {visibleColumns.delta && <th>Delta</th>}
              {visibleColumns.gamma && <th>Gamma</th>}
              {visibleColumns.vega && <th>Vega</th>}
              {visibleColumns.theta && <th>Theta, $/day</th>}
              {visibleColumns.liquidity && <th>Liquidity</th>}
              {visibleColumns.actions && (
                <th>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <span>Actions</span>
                    <div ref={actionMenuRef} style={{ position: 'relative' }}>
                      <button
                        className="ghost"
                        title="Configure action buttons"
                        onClick={() => setActionMenuOpen((open) => !open)}
                        style={{ padding: '2px 6px', fontSize: '0.9em' }}
                      >⚙</button>
                      {actionMenuOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 'calc(100% + 4px)',
                            background: 'var(--card)',
                            color: 'var(--fg)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            boxShadow: '0 12px 24px rgba(0,0,0,.40)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            minWidth: 160,
                            zIndex: 45,
                          }}
                        >
                          {(Object.keys(ACTION_LABELS) as ActionKey[]).map((key) => (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95em' }}>
                              <input
                                type="checkbox"
                                checked={actionVisibility[key]}
                                onChange={() => setActionVisibility((prev) => ({ ...prev, [key]: !prev[key] }))}
                              />
                              <span>{ACTION_LABELS[key]}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const augmented = rows.map((r) => ({ r, c: calc(r) }));
              augmented.sort((A, B) => {
                // Favorites first
                const fa = A.r.favorite ? 1 : 0;
                const fb = B.r.favorite ? 1 : 0;
                if (fa !== fb) return fb - fa;
                // Then by chosen sort key (desc)
                const sgn = sortDir === 'desc' ? 1 : -1;
                if (sortKey === 'date') return sgn * ((B.r.createdAt || 0) - (A.r.createdAt || 0));
                if (sortKey === 'pnl') {
                  const pnlA = useExecPnl ? A.c.pnlExec : A.c.pnl;
                  const pnlB = useExecPnl ? B.c.pnlExec : B.c.pnl;
                  return sgn * ((pnlB || 0) - (pnlA || 0));
                }
                if (sortKey === 'theta') return sgn * ((B.c.greeks.theta || 0) - (A.c.greeks.theta || 0));
                if (sortKey === 'expiry') {
                  const eAarr = A.r.legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0);
                  const eBarr = B.r.legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0);
                  const eA = eAarr.length ? Math.min(...eAarr) : 0;
                  const eB = eBarr.length ? Math.min(...eBarr) : 0;
                  return sgn * (eB - eA);
                }
                return 0;
              });
              return augmented.map(({ r, c }) => {
                const rule = ifRules[r.id];
                const evalRes = evalRule(r, c, rule);
                const expiries = Array.from(new Set(r.legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0))).sort();
                const expLabel = expiries.length === 1 ? new Date(expiries[0]).toISOString().slice(0,10) : (expiries.length > 1 ? 'mixed' : '—');
                const dte = c.dte != null ? `${c.dte}d` : (expiries.length === 1 ? `${Math.max(0, Math.round((expiries[0]-Date.now())/(86400000)))}d` : '—');
                const typeLabel = strategyName(r.legs);
                const hasNote = typeof r.note === 'string' && r.note.trim().length > 0;
                const expiryInfo = describeExpiry(r);
                const pnlValue = useExecPnl ? c.pnlExec : c.pnl;
                const pnlColor = pnlValue > 0 ? 'var(--gain)' : (pnlValue < 0 ? 'var(--loss)' : undefined);
                const rowStyle: React.CSSProperties = {};
                if (r.closedAt != null) {
                  rowStyle.background = 'rgba(110, 120, 130, 0.20)';
                }
                if (evalRes.matched && r.closedAt == null) {
                  rowStyle.background = 'rgba(64,64,64,.30)';
                } else if (evalRes.matched && r.closedAt != null) {
                  rowStyle.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.15)';
                }
                return (
                  <React.Fragment key={r.id}>
                  <tr style={rowStyle}>
                    {visibleColumns.type && (
                      <td
                        style={r.favorite
                          ? { ...typeColumnStyle, borderLeft: '3px solid rgba(255, 215, 0, 0.5)', paddingLeft: 6 }
                          : typeColumnStyle}
                      >
                        <div style={typeCellContentStyle}>
                          <span>{typeLabel}</span>
                          {(() => {
                            const pid = r.portfolioId ?? DEFAULT_PORTFOLIO_ID;
                            if (pid === DEFAULT_PORTFOLIO_ID) return null;
                            const name = portfolioNameById[pid] || 'Portfolio';
                            return (
                              <span
                                style={{
                                  background: 'rgba(128, 128, 128, 0.2)',
                                  color: '#9A3412',
                                  padding: '1px 6px',
                                  borderRadius: 8,
                                  fontSize: 'calc(1em - 3px)',
                                  textTransform: 'none',
                                  fontWeight: 600,
                                }}
                              >
                                {name}
                              </span>
                            );
                          })()}
                          {hasNote && (
                            <span
                              style={{
                                background: 'rgba(128, 128, 128, 0.2)',
                                color: '#2f855a',
                                padding: '1px 6px',
                                borderRadius: 8,
                                fontSize: 'calc(1em - 3px)',
                                textTransform: 'lowercase',
                                fontWeight: 600,
                              }}
                            >notes</span>
                          )}
                          {r.closedAt && (
                            <span style={{ background: 'rgba(128,128,128,.18)', color: '#7a7a7a', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>closed</span>
                          )}
                          {expiryInfo.state === 'partial' && (
                            <span style={{ background: 'rgba(234,179,8,.18)', color: '#b45309', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>partial exp</span>
                          )}
                          {expiryInfo.state === 'expired' && (
                            <span style={{ background: 'rgba(128,128,128,.25)', color: '#9ca3af', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>expired</span>
                          )}
                          {expiryInfo.unsettled && (
                            <span style={{ background: 'rgba(244,67,54,.18)', color: '#c62828', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>unsettled</span>
                          )}
                          {r.legs.some(L => L.hidden) && (() => {
                            const hiddenCount = r.legs.reduce((acc, L) => acc + (L.hidden ? 1 : 0), 0);
                            return (
                              <span style={{ background: 'rgba(128,128,128,.18)', color: '#7a7a7a', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>hidden ×{hiddenCount}</span>
                            );
                          })()}
                          {(!!ifRules[r.id]?.chains?.length) && (
                            <span style={{ background: 'rgba(160,120,60,.18)', color: '#8B4513', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>IF</span>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleColumns.legs && (
                      <td style={{ ...legsColumnStyle, fontSize: 'calc(1em - 1.5px)' }}>
                        {r.legs.map((L, i) => {
                          const isPerp = !String(L.leg.symbol).includes('-');
                          return (
                            <div key={i} className="muted">{L.side} {isPerp ? 'PERP' : L.leg.optionType} {isPerp ? '' : L.leg.strike} × {L.qty}</div>
                          );
                        })}
                      </td>
                    )}
                    {visibleColumns.expiry && <td style={{ fontSize: 'calc(1em - 2px)' }}>{expLabel} · {dte}</td>}
                    {visibleColumns.netEntry && <td>{c.netEntry.toFixed(2)}</td>}
                    {visibleColumns.netMid && <td>{c.netMid.toFixed(2)}</td>}
                    {visibleColumns.pnl && (
                      <td style={pnlColor ? { color: pnlColor } : undefined}>{pnlValue.toFixed(2)}</td>
                    )}
                    {visibleColumns.delta && <td>{c.greeks.delta.toFixed(3)}</td>}
                    {visibleColumns.gamma && <td>{c.greeks.gamma.toFixed(4)}</td>}
                    {visibleColumns.vega && <td>{c.greeks.vega.toFixed(3)}</td>}
                    {visibleColumns.theta && <td>{c.greeks.theta.toFixed(3)}</td>}
                    {visibleColumns.liquidity && (
                      <td>
                        {c.liq.maxSpread != null ? `$${c.liq.maxSpread.toFixed(2)}` : '—'} · OI {c.liq.minOI != null ? c.liq.minOI : '—'}
                        {(() => {
                          const sp = c.liq.maxSpreadPct;
                          const oi = c.liq.minOI;
                          let label: 'A' | 'B' | 'C' | 'D' = 'D';
                          if (sp != null && isFinite(sp) && oi != null && isFinite(oi)) {
                            if (sp < 1 && oi >= 2000) label = 'A';
                            else if (sp < 2 && oi >= 1000) label = 'B';
                            else if (sp < 3 && oi >= 300) label = 'C';
                            else label = 'D';
                          }
                          const style: React.CSSProperties = { background: 'rgba(128,128,128,.18)', color: '#7a7a7a' };
                          return (
                            <span style={{...style, marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)'}}>{label}</span>
                          );
                        })()}
                      </td>
                    )}
                    {visibleColumns.actions && (() => {
                      const showRow1 = (actionVisibility.favorite || actionVisibility.expand || actionVisibility.view || actionVisibility.edit);
                      const showRow2 = (
                        (actionVisibility.if) ||
                        (actionVisibility.notes) ||
                        (actionVisibility.settle && expiryInfo.state !== 'active') ||
                        actionVisibility.close ||
                        actionVisibility.delete
                      );
                      if (!showRow1 && !showRow2) return <td style={{ textAlign: 'center', color: '#888' }}>—</td>;
                      return (
                        <td>
                          <div style={{display:'flex', flexDirection:'column', gap:4}}>
                            {showRow1 && (
                              <div style={{display:'flex', alignItems:'center', gap:6}}>
                                {actionVisibility.favorite && (
                                  <button
                                    className="ghost"
                                    style={{
                                      height: 28,
                                      lineHeight: '28px',
                                      padding: '0 6px',
                                      fontSize: 18,
                                      color: r.favorite ? '#d4b106' : 'var(--fg)',
                                      fontFamily: '"Segoe UI Symbol", "Arial Unicode MS", sans-serif',
                                      transition: 'color 0.15s ease',
                                    }}
                                    title={r.favorite ? 'Unfavorite' : 'Favorite'}
                                    onClick={() => {
                                      if (r.id.startsWith('S:')) toggleFavoriteSpread(r.id.slice(2));
                                      else toggleFavoritePosition(r.id.slice(2));
                                    }}
                                  >{r.favorite ? '★' : '☆'}</button>
                                )}
                                {actionVisibility.expand && (
                                  <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 6px', fontSize: 28}} title={expanded[r.id] ? 'Hide legs' : 'Show legs'} onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>{expanded[r.id] ? '▴' : '▾'}</button>
                                )}
                                {actionVisibility.view && (
                                  <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} onClick={() => setView(r)}>View</button>
                                )}
                                {actionVisibility.edit && (
                                  <button className="ghost" onClick={() => openEditRow(r)} style={{height: 28, lineHeight: '28px', padding: '0 10px'}}>Edit</button>
                                )}
                              </div>
                            )}
                            {showRow2 && (
                              <div style={{display:'flex', alignItems:'center', gap:6}}>
                                {actionVisibility.if && (
                                  <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} title="IF" onClick={() => setIfRow(r)}>IF</button>
                                )}
                                {actionVisibility.notes && (
                                  <button
                                    className="ghost"
                                    style={{height: 28, lineHeight: '28px', padding: '0 10px'}}
                                    title="Notes"
                                    onClick={() => openNotes(r)}
                                  >📓</button>
                                )}
                                {actionVisibility.settle && expiryInfo.state !== 'active' && (
                                  <button
                                    className="ghost"
                                    style={{
                                      height: 28,
                                      lineHeight: '28px',
                                      padding: '0 10px',
                                      color: expiryInfo.unsettled ? '#c62828' : undefined,
                                    }}
                                    onClick={() => setSettleTarget(r)}
                                  >Settle</button>
                                )}
                                {actionVisibility.close && (
                                  <button
                                    className="ghost"
                                    style={{
                                      height: 28,
                                      lineHeight: '28px',
                                      padding: '0 10px',
                                      color: r.closedAt != null ? '#9ba0a6' : undefined,
                                      cursor: r.closedAt != null ? 'not-allowed' : undefined,
                                    }}
                                    onClick={() => {
                                      if (r.closedAt != null) return;
                                      if (window.confirm('Exit this item?')) onCloseRow(r);
                                    }}
                                    disabled={r.closedAt != null}
                                  >Exit</button>
                                )}
                                {actionVisibility.delete && (
                                  <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} onClick={() => { if (window.confirm('Delete this item? This cannot be undone.')) onDeleteRow(r); }}>Del</button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })()}
                  </tr>
                  {expanded[r.id] && (
                    <tr>
                      <td colSpan={visibleColumnCount}>
                        <div className="grid" style={{gap: 6}}>
                          {r.legs.map((L, i) => {
                            const rule = ifRules[r.id];
                            const matchedLegs = matchedLegsOnly(r, c, rule);
                            const snap = computeLegSnapshot(r, L);
                            const bid = snap.bid;
                            const ask = snap.ask;
                            const mid = snap.mid;
                            const entry = Number(L.entryPrice);
                            const qty = Number(L.qty) || 1;
                            const pnlMid = snap.pnlMid != null ? snap.pnlMid : (
                              Number.isFinite(entry) && mid != null && isFinite(mid)
                                ? (L.side === 'short' ? (entry - mid) : (mid - entry)) * qty
                                : undefined
                            );
                            const exec = snap.exec;
                            const pnlExec = snap.pnlExec != null ? snap.pnlExec : (
                              Number.isFinite(entry) && exec != null && isFinite(exec)
                                ? (L.side === 'short' ? (entry - exec) : (exec - entry)) * qty
                                : undefined
                            );
                            const greeks = snap.greeks || { delta: 0, vega: 0, theta: 0 };
                            const sgn = L.side === 'long' ? 1 : -1;
                            const deltaEff = greeks.delta != null ? sgn * greeks.delta : undefined;
                            const vegaEff = greeks.vega != null ? sgn * greeks.vega : undefined;
                            const thetaEff = greeks.theta != null ? sgn * greeks.theta : undefined;
                            const ivLive = snap.settled ? undefined : ivPctForLeg(L, r);
                            const volShift = snap.settled ? undefined : dSigmaForLeg(L, r);
                            const oi = snap.oi;
                            return (
                              <div
                                key={L.leg.symbol}
                                style={{
                                  border: '2px solid #10481B',
                                  borderRadius: 8,
                                  padding: 6,
                                  fontSize: 'calc(1em - 1.5px)',
                                  ...(L.hidden ? { background: 'rgba(128,128,128,.12)' } : {}),
                                  ...(matchedLegs.has(L.leg.symbol) ? { background: 'rgba(64,64,64,.20)' } : {}),
                                }}
                              >
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 2}}>
                                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                                    <button type="button" className="ghost" style={{height: 22, lineHeight: '22px', padding: '0 8px', cursor:'pointer'}} onClick={(e) => { e.stopPropagation();
                                      if (r.id.startsWith('P:')) {
                                        const pid = r.id.slice(2);
                                        updatePosition(pid, (p) => ({
                                          ...p,
                                          legs: p.legs.map(LL => LL.leg.symbol === L.leg.symbol ? { ...LL, hidden: !LL.hidden } : LL)
                                        }));
                                      } else if (r.id.startsWith('S:')) {
                                        try {
                                          addPosition({ legs: r.legs, note: r.note, portfolioId: r.portfolioId ?? activePortfolioId });
                                          const latest = useStore.getState().positions?.[0]?.id;
                                          removeSpread(r.id.slice(2));
                                          if (latest) {
                                            updatePosition(latest, (p) => ({
                                              ...p,
                                              legs: p.legs.map(LL => LL.leg.symbol === L.leg.symbol ? { ...LL, hidden: true } : LL)
                                            }));
                                            // expand the newly created position row
                                            setExpanded(prev => ({ ...prev, ['P:'+latest]: true }));
                                          }
                                        } catch {}
                                      }
                                    }}>{L.hidden ? 'Unhide' : 'Hide'}</button>
                                    <div>
                                      <strong>{L.side}</strong> {L.leg.optionType} {L.leg.strike} × {L.qty}
                                      {(() => {
                                        const label = formatCreatedAtLabel(L.createdAt ?? r.createdAt);
                                        return label ? (
                                          <span style={{ marginLeft: 6, color: '#9c9c9c', fontSize: 'calc(1em - 1px)' }}>{label}</span>
                                        ) : null;
                                      })()}
                                    </div>
                                  </div>
                                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                                    <div className="muted">{Number(L.leg.expiryMs) > 0 ? new Date(Number(L.leg.expiryMs)).toISOString().slice(0,10) : ''}</div>
                                    {r.id.startsWith('P:') && (
                                      <button
                                        type="button"
                                        className="ghost"
                                        style={{height: 22, lineHeight: '22px', padding: '0 8px', cursor:'pointer'}}
                                        onClick={(e) => { e.stopPropagation(); handleDeleteLeg(r, i); }}
                                      >Del</button>
                                    )}
                                  </div>
                                </div>
                                <div className="grid" style={{gridTemplateColumns:'2fr repeat(5, minmax(0,1fr))', gridTemplateRows:'repeat(4, auto)', gap: 6}}>
                                  {/* First column header (row 1) */}
                                  <div style={{gridColumn:1, gridRow:1}} className="muted">Symbol</div>
                                  {/* First column value spans rows 2-4 and is vertically centered */}
                                  <div style={{gridColumn:1, gridRow:'2 / span 3', paddingRight:12, display:'flex', alignItems:'center'}}>
                                    <div title={L.leg.symbol} style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word', fontSize:'1em'}}>{L.leg.symbol}</div>
                                  </div>
                                  {snap.settled && (
                                    <div style={{gridColumn:'2 / span 5', gridRow:1, textAlign:'right', color:'#9c9c9c', fontSize:'calc(1em - 3px)'}}>
                                      Settlement S = {snap.settleS != null ? snap.settleS.toFixed(2) : '—'}{snap.settledAt ? ` · ${new Date(snap.settledAt).toLocaleString()}` : ''}
                                    </div>
                                  )}
                                  {/* Row 1: titles (left to right) */}
                                  <div style={{gridColumn:2, gridRow:1}} className="muted">Bid / Ask</div>
                                  <div style={{gridColumn:3, gridRow:1}} className="muted">Mid</div>
                                  <div style={{gridColumn:4, gridRow:1}} className="muted">Entry</div>
                                  <div style={{gridColumn:5, gridRow:1}} className="muted">PnL ($){useExecPnl && <span style={{marginLeft:4, fontSize:'0.75em'}}>e</span>}</div>
                                  <div style={{gridColumn:6, gridRow:1}} className="muted">IV %</div>
                                  {/* Row 3: titles second line */}
                                  <div style={{gridColumn:2, gridRow:3}} className="muted">Vega</div>
                                  <div style={{gridColumn:3, gridRow:3}} className="muted">Δ (Delta)</div>
                                  <div style={{gridColumn:4, gridRow:3}} className="muted">Θ (Theta)</div>
                                  <div style={{gridColumn:5, gridRow:3}} className="muted">OI (Ctrs)</div>
                                  <div style={{gridColumn:6, gridRow:3}} className="muted">Δσ (Vol)</div>
                                  {/* Row 2: values for first line */}
                                  <div style={{gridColumn:2, gridRow:2}}>{bid != null ? bid.toFixed(2) : '—'} / {ask != null ? ask.toFixed(2) : '—'}</div>
                                  <div style={{gridColumn:3, gridRow:2}}>{mid != null && isFinite(mid) ? Number(mid).toFixed(2) : '—'}</div>
                                  <div style={{gridColumn:4, gridRow:2}}>{Number.isFinite(entry) ? `$${entry.toFixed(2)}` : '—'}</div>
                                  <div style={{gridColumn:5, gridRow:2}}>{(() => {
                                    const pnlVal = useExecPnl ? pnlExec : pnlMid;
                                    if (!(pnlVal != null && isFinite(pnlVal))) return '—';
                                    const color = pnlVal > 0 ? 'var(--gain)' : (pnlVal < 0 ? 'var(--loss)' : undefined);
                                    return <span style={color ? { color } : undefined}>{pnlVal.toFixed(2)}</span>;
                                  })()}</div>
                                  <div style={{gridColumn:6, gridRow:2}}>{ivLive != null ? ivLive.toFixed(1) : '—'}</div>
                                  {/* Row 4: values for second line */}
                                  <div style={{gridColumn:2, gridRow:4}}>{vegaEff != null ? vegaEff.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:3, gridRow:4}}>{deltaEff != null ? deltaEff.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:4, gridRow:4}}>{thetaEff != null ? thetaEff.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:5, gridRow:4}}>{oi != null ? oi : '—'}</div>
                                  <div style={{gridColumn:6, gridRow:4}}>{volShift != null ? `${volShift.toFixed(1)} [${volShift >= 1 ? '↑' : (volShift <= -1 ? '↓' : '–')}]` : '—'}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
              });
            })()}
          </tbody>
        </table>
      </div>
      {view && (
        <PositionView
          id={view.id}
          legs={view.legs}
          createdAt={view.createdAt}
          closedAt={view.closedAt}
          closeSnapshot={view.closeSnapshot}
          note={view.note}
          title={strategyName(view.legs)}
          onClose={() => setView(null)}
          onClosePosition={() => {
            const target = view;
            if (!target) return;
            const snapshot = buildCloseSnapshot(target);
            applyCloseSnapshot(target, snapshot);
          }}
          hiddenSymbols={view.legs.filter(L=>L.hidden).map(L=>L.leg.symbol)}
          onEdit={() => {
            const current = view;
            if (!current) return;
            setView(null);
            openEditRow(current);
          }}
          onDeleteLeg={view.id.startsWith('P:') ? (legIndex) => {
            const removed = handleDeleteLeg(view, legIndex);
            if (!removed) return;
            const targetId = view.id;
            setView((current) => {
              if (!current || current.id !== targetId) return current;
              const nextLegs = current.legs.filter((_, idx) => idx !== legIndex);
              if (nextLegs.length === 0) return null;
              return { ...current, legs: nextLegs };
            });
          } : undefined}
          onToggleLegHidden={(sym) => {
            if (view.id.startsWith('P:')) {
              const pid = view.id.slice(2);
              // Update store
              updatePosition(pid, (p) => ({
                ...p,
                legs: p.legs.map(L => L.leg.symbol === sym ? { ...L, hidden: !L.hidden } : L)
              }));
              // Update local view so modal reflects change without closing
              setView((cur) => cur ? ({
                ...cur,
                legs: cur.legs.map(L => L.leg.symbol === sym ? { ...L, hidden: !L.hidden } : L)
              }) : cur);
            } else if (view.id.startsWith('S:')) {
              try {
                // Convert spread to position, then hide the selected leg
                addPosition({ legs: view.legs, note: view.note, portfolioId: view.portfolioId ?? activePortfolioId });
                const latest = useStore.getState().positions?.[0]?.id;
                removeSpread(view.id.slice(2));
                if (latest) {
                  updatePosition(latest, (p) => ({
                    ...p,
                    legs: p.legs.map(L => L.leg.symbol === sym ? { ...L, hidden: true } : L)
                  }));
                  // Load the new position from store into the open modal
                  const pos = useStore.getState().positions.find(p => p.id === latest);
                  if (pos) {
                    const legTimes = (pos.legs ?? [])
                      .map((leg) => Number((leg as any)?.createdAt))
                      .filter((v) => Number.isFinite(v));
                    const baseCreated = Number.isFinite(pos.createdAt) ? Number(pos.createdAt) : Date.now();
                    const viewCreatedAt = legTimes.length ? Math.min(baseCreated, ...legTimes) : baseCreated;
                    setView({ id: 'P:' + pos.id, kind: 'multi', legs: pos.legs, createdAt: viewCreatedAt, closedAt: pos.closedAt, closeSnapshot: pos.closeSnapshot, note: pos.note, favorite: pos.favorite, portfolioId: pos.portfolioId });
                  }
                }
              } catch {}
            }
          }}
        />
      )}
      {noteRow && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}
        >
          <div style={{ background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, width: 420, maxWidth: '95%', maxHeight: '90vh', boxShadow: '0 10px 24px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
              <strong>Notes · {strategyName(noteRow.legs)}</strong>
              <button className="ghost" onClick={closeNotes}>Close</button>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0, paddingLeft: 4, paddingRight: 4 }}>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      saveNotes();
                      closeNotes();
                    }
                  }}
                  placeholder="Add your comments"
                  style={{ width: '100%', height: '100%', minHeight: 160, resize: 'none', borderRadius: 8, border: '1px solid var(--border)', padding: 10, fontFamily: 'inherit', fontSize: '1em', background: 'var(--surface)', color: 'var(--fg)', overflow: 'auto', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="ghost" onClick={closeNotes}>Cancel</button>
                <button className="primary" onClick={saveNotes}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {settleTarget && (() => {
        const expiryInfo = describeExpiry(settleTarget);
        const spotSuggestion = computeSpotForRow(settleTarget);
        const legSnapshots = settleTarget.legs.map((leg) => ({
          ...leg,
          ...computeLegSnapshot(settleTarget, leg),
        })) as LegSnapshot[];
        return (
          <SettleExpiredModal
            key={`settle-${settleTarget.id}`}
            row={settleTarget}
            positionLabel={strategyName(settleTarget.legs)}
            legsSnapshot={legSnapshots}
            expiredExpiries={expiryInfo.expiredExpiries}
            settlements={settleTarget.settlements}
            tickers={tickers}
            spotSuggestion={spotSuggestion}
            onClose={() => setSettleTarget(null)}
            onApply={(entries) => {
              const isSpread = settleTarget.id.startsWith('S:');
              const rawId = settleTarget.id.slice(2);
              entries.forEach(({ expiryMs, value }) => {
                if (isSpread) setSpreadSettlement(rawId, expiryMs, value);
                else setPositionSettlement(rawId, expiryMs, value);
              });
              setSettleTarget(null);
            }}
          />
        );
      })()}
      {ifRow && (
        <IfModal
          key={ifRow.id}
          title={strategyName(ifRow.legs)}
          legOptions={ifRow.legs.map(L=>({ symbol: L.leg.symbol, label: `${L.side === 'short' ? 'Short' : 'Long'} · ${L.leg.optionType}${L.leg.strike} × ${L.qty} · ${L.leg.symbol}` }))}
          initial={ifRules[ifRow.id]}
          ruleKey={ifRow.id}
          onClose={() => setIfRow(null)}
          onSave={(rule) => {
            const targetId = ifRow.id;
            setIfRules((prev) => {
              const next = { ...prev };
              if (!rule.chains.length) delete next[targetId];
              else next[targetId] = rule;
              return next;
            });
            setIfRow(null);
          }}
          evalCondLive={({ scope, legSymbol, cond }) => evalSingleCondLive(ifRow, { scope, legSymbol, cond })}
          evalCondDetails={({ scope, legSymbol, cond }) => evalCondDetails(ifRow, { scope, legSymbol, cond })}
          templates={ifTemplates}
          onSaveTemplate={handleSaveTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onDeleteTemplates={handleDeleteTemplates}
        />
      )}
      {showCreatePortfolioModal && (
        <div
          onClick={closeCreateModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 90,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              width: 'min(420px, 90%)',
              boxShadow: '0 10px 30px rgba(0,0,0,.35)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <strong>Create portfolio</strong>
              <button className="ghost" onClick={closeCreateModal}>Close</button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted">Name</span>
                <input
                  type="text"
                  value={portfolioNameDraft}
                  onChange={(e) => {
                    setPortfolioNameDraft(e.target.value);
                    if (createPortfolioError) setCreatePortfolioError(null);
                  }}
                  maxLength={64}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreatePortfolio();
                    }
                  }}
                  autoFocus
                />
              </label>
              {createPortfolioError && (
                <div style={{ color: 'var(--loss)' }}>{createPortfolioError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="ghost" onClick={closeCreateModal}>Cancel</button>
                <button className="primary" onClick={handleCreatePortfolio}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editId && <EditPositionModal id={editId} onClose={() => setEditId(null)} />}
      {showAddPosition && <AddPositionModal onClose={() => setShowAddPosition(false)} />}
    </div>
  );
}

type SettleExpiredModalProps = {
  row: Row;
  positionLabel: string;
  legsSnapshot: LegSnapshot[];
  expiredExpiries: number[];
  settlements?: SettlementMap;
  tickers: Record<string, any>;
  spotSuggestion?: number;
  onClose: () => void;
  onApply: (entries: Array<{ expiryMs: number; value?: number }>) => void;
};

function SettleExpiredModal({ row, positionLabel, legsSnapshot, expiredExpiries, settlements, tickers, spotSuggestion, onClose, onApply }: SettleExpiredModalProps) {
  const [draft, setDraft] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    expiredExpiries.forEach((expiry) => {
      const key = String(expiry);
      const existing = settlements?.[key]?.settleUnderlying;
      initial[key] = existing != null && isFinite(existing) ? existing.toString() : '';
    });
    return initial;
  });
  const [autoPrices, setAutoPrices] = React.useState<Record<string, number | undefined>>({});

  React.useEffect(() => {
    const next: Record<string, string> = {};
    expiredExpiries.forEach((expiry) => {
      const key = String(expiry);
      const existing = settlements?.[key]?.settleUnderlying;
      next[key] = existing != null && isFinite(existing) ? existing.toString() : '';
    });
    setDraft(next);
    setAutoPrices({});
  }, [row.id, settlements, expiredExpiries.join('|')]);

  React.useEffect(() => {
    let mounted = true;
    const fetchPrices = async () => {
      for (const expiry of expiredExpiries) {
        const key = String(expiry);
        const legs = legsSnapshot.filter((leg) => Number(leg.leg.expiryMs) === expiry);
        const leg = legs.find((item) => String(item.leg.symbol || '').includes('-'));
        if (!leg) continue;
        try {
          const price = await fetchOptionDeliveryPrice(leg.leg.symbol);
          if (!mounted) return;
          if (!(price != null && isFinite(price) && price > 0)) continue;
          setAutoPrices((prev) => ({ ...prev, [key]: price }));
          setDraft((prev) => {
            const current = prev[key];
            if (current && current.trim().length) return prev;
            return { ...prev, [key]: price.toFixed(2) };
          });
        } catch {
          if (!mounted) return;
        }
      }
    };
    void fetchPrices();
    return () => {
      mounted = false;
    };
  }, [row.id, expiredExpiries.join('|'), legsSnapshot]);

  const suggestionsMap = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    expiredExpiries.forEach((expiry) => {
      const values = new Set<number>();
      if (spotSuggestion != null && isFinite(spotSuggestion) && spotSuggestion > 0) values.add(Number(spotSuggestion));
      legsSnapshot
        .filter((leg) => Number(leg.leg.expiryMs) === expiry)
        .forEach((leg) => {
          const settleUnderlying = Number(leg.settleS);
          if (Number.isFinite(settleUnderlying) && settleUnderlying > 0) values.add(settleUnderlying);
          const ticker = tickers[leg.leg.symbol] || {};
          const idx = Number(ticker?.indexPrice);
          if (Number.isFinite(idx) && idx > 0) values.add(idx);
        });
      const auto = autoPrices[String(expiry)];
      if (auto != null && isFinite(auto) && auto > 0) values.add(auto);
      const arr = Array.from(values).sort((a, b) => a - b);
      map[String(expiry)] = arr;
    });
    return map;
  }, [expiredExpiries, legsSnapshot, tickers, spotSuggestion, row.id, autoPrices]);

  const handleApply = () => {
    const updates: Array<{ expiryMs: number; value?: number }> = [];
    expiredExpiries.forEach((expiry) => {
      const key = String(expiry);
      const raw = (draft[key] ?? '').trim();
      const existing = settlements?.[key]?.settleUnderlying;
      if (raw.length) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          if (!(existing != null && Math.abs(existing - parsed) < 1e-6)) updates.push({ expiryMs: expiry, value: parsed });
        }
      } else if (existing != null) {
        updates.push({ expiryMs: expiry, value: undefined });
      }
    });
    onApply(updates);
  };

  const formatDate = (ms: number) => {
    try { return new Date(ms).toISOString().slice(0, 10); } catch { return String(ms); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div style={{ background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, width: 520, maxWidth: '95%', maxHeight: '90vh', boxShadow: '0 12px 24px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong>Settle expired · {positionLabel}</strong>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {expiredExpiries.length === 0 ? (
            <div className="muted">Нет истекших ног для фиксации. Возможно, все уже в порядке.</div>
          ) : (
            expiredExpiries.map((expiry) => {
              const key = String(expiry);
              const legs = legsSnapshot.filter((leg) => Number(leg.leg.expiryMs) === expiry);
              const existing = settlements?.[key]?.settleUnderlying;
              const suggestionButtons = suggestionsMap[key] ?? [];
              return (
                <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong>{formatDate(expiry)}</strong>
                      {existing != null && isFinite(existing) && (
                        <span className="muted">Текущий settlement: {existing.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 'calc(1em - 2px)' }}>
                      {legs.map((leg, idx) => {
                        const settledLabel = leg.settled && leg.settleS != null ? ` · S=${leg.settleS.toFixed(2)}` : '';
                        return (
                          <span key={leg.leg.symbol + idx} style={{ marginRight: 12 }}>
                            {leg.side} {leg.leg.optionType}{leg.leg.strike} × {leg.qty}{settledLabel}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={draft[key] ?? ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="Укажите цену базового актива"
                      style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
                    />
                    <button type="button" className="ghost" onClick={() => setDraft((prev) => ({ ...prev, [key]: '' }))}>Clear</button>
                  </div>
                  {suggestionButtons.length > 0 && (
                    <div className="muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ marginRight: 4 }}>Подсказки:</span>
                      {suggestionButtons.slice(0, 4).map((val, idx) => (
                        <button
                          key={`${key}-${idx}-${val}`}
                          type="button"
                          className="ghost"
                          style={{ padding: '2px 8px' }}
                          onClick={() => setDraft((prev) => ({ ...prev, [key]: val.toFixed(2) }))}
                        >
                          {val.toFixed(2)}
                          {(autoPrices[key] != null && Math.abs(val - (autoPrices[key] as number)) < 1e-6) ? ' (Bybit)' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 'calc(1em - 3px)' }}>Оставьте поле пустым, чтобы очистить сохранённый settlement.</div>
                </div>
              );
            })
          )}
          {/* Автозакрытие выполняется системой; дополнительный чекбокс больше не нужен */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button className="primary" onClick={handleApply} disabled={expiredExpiries.length === 0}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}
  const netEntryFor = (legs: PositionLeg[]) => legs.filter(L=>!L.hidden).reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);

  const strategyName = (legs: PositionLeg[]): string => {
    const active = legs.filter((leg) => !leg.hidden);
    if (!active.length) return '—';

    const normalized: StrategyLeg[] = active.map((leg) => ({
      side: leg.side,
      type: leg.leg.optionType,
      expiryMs: Number(leg.leg.expiryMs) || 0,
      strike: Number(leg.leg.strike) || 0,
      qty: Number(leg.qty) || 0,
      symbol: String(leg.leg.symbol || ''),
    }));

    return describeStrategy(normalized, netEntryFor(active));
  };
