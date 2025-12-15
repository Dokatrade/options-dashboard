import React from 'react';
import type { PositionLeg, CloseSnapshot, SpreadPosition, Position } from '../utils/types';
import { subscribeLinearTicker, subscribeOptionTicker } from '../services/ws';
import { midPrice, bestBidAsk, fetchHV30 } from '../services/bybit';
import { bsPrice, bsImpliedVol } from '../utils/bs';
import { inferUnderlyingSpotSymbol } from '../utils/underlying';
import { useStore } from '../store/store';
import { SpotPriceChart } from './SpotPriceChart';
import { legKey } from '../utils/legKey';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
type ChartMode = 'pnl' | 'spot';

function formatCreatedAtLabel(createdAt?: number): string | null {
  if (!Number.isFinite(createdAt)) return null;
  const dt = new Date(Number(createdAt));
  if (Number.isNaN(dt.getTime())) return null;
  const datePart = dt.toLocaleDateString('ru-RU');
  const timePart = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  return `(created ${datePart} ${timePart})`;
}

type Props = {
  id: string;
  legs: PositionLeg[];
  createdAt: number;
  closedAt?: number;
  closeSnapshot?: CloseSnapshot;
  note?: string;
  title?: string;
  onClose: () => void;
  onClosePosition?: () => void;
  onToggleLegHidden?: (legId: string, legIndex: number) => void;
  hiddenLegIds?: string[];
  onEdit?: () => void;
  onDeleteLeg?: (legIndex: number) => void;
  onExitLeg?: (legIndex: number) => void;
  variant?: 'modal' | 'summary';
};

export function PositionView({
  id,
  legs,
  createdAt,
  closedAt,
  closeSnapshot,
  note,
  title,
  onClose,
  onClosePosition,
  onToggleLegHidden,
  hiddenLegIds,
  onEdit,
  onDeleteLeg,
  onExitLeg,
  variant = 'modal',
}: Props) {
  const isSummary = variant === 'summary';
  const updateSpread = useStore((s) => s.updateSpread);
  const updatePosition = useStore((s) => s.updatePosition);
  const storeSpread = useStore(React.useCallback((s) => id.startsWith('S:') ? s.spreads.find((sp) => `S:${sp.id}` === id) : undefined, [id]));
  const storePosition = useStore(React.useCallback((s) => id.startsWith('P:') ? s.positions.find((p) => `P:${p.id}` === id) : undefined, [id]));
  const noteValue = storeSpread?.note ?? storePosition?.note ?? note ?? '';
  const [editingNote, setEditingNote] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState(noteValue);
  React.useEffect(() => {
    if (!editingNote) setNoteDraft(noteValue);
  }, [noteValue, editingNote]);
  const saveNote = React.useCallback(() => {
    const draft = noteDraft;
    const trimmed = draft.trim();
    if ((trimmed.length === 0 && noteValue.trim().length === 0) || draft === noteValue) {
      setEditingNote(false);
      setNoteDraft(noteValue);
      return;
    }
    if (id.startsWith('S:')) {
      updateSpread(id.slice(2), (sp) => ({ ...sp, note: trimmed ? draft : undefined }));
    } else {
      updatePosition(id.slice(2), (p) => ({ ...p, note: trimmed ? draft : undefined }));
    }
    setNoteDraft(trimmed ? draft : '');
    setEditingNote(false);
  }, [id, noteDraft, noteValue, updatePosition, updateSpread]);

  const clearNote = React.useCallback(() => {
    if (id.startsWith('S:')) {
      updateSpread(id.slice(2), (sp) => ({ ...sp, note: undefined }));
    } else {
      updatePosition(id.slice(2), (p) => ({ ...p, note: undefined }));
    }
    setNoteDraft('');
    setEditingNote(false);
  }, [id, updatePosition, updateSpread]);

  const hasNote = React.useMemo(() => noteValue.trim().length > 0, [noteValue]);

  const positionCreatedAt = React.useMemo(() => {
    const fallback = Number.isFinite(createdAt) ? Number(createdAt) : Date.now();
    const legTimes = legs
      .map((leg) => Number((leg as any)?.createdAt))
      .filter((v) => Number.isFinite(v));
    return legTimes.length ? Math.min(...legTimes) : fallback;
  }, [createdAt, legs]);
  const resolvedHiddenLegIds = React.useMemo(() => {
    if (hiddenLegIds) return hiddenLegIds;
    return legs
      .map((L, idx) => (L.hidden ? legKey(L, idx) : null))
      .filter(Boolean) as string[];
  }, [hiddenLegIds, legs]);
  const legsCalc = React.useMemo(() => {
    const hiddenSet = new Set(resolvedHiddenLegIds || []);
    return legs.filter((L, idx) => !hiddenSet.has(legKey(L, idx)));
  }, [legs, resolvedHiddenLegIds]);
  // Lock initial X-domain to ±50% around current spot (if available) to prevent re-centering
  const baseDomainRef = React.useRef<{ minX: number; maxX: number } | null>(null);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [showT0, setShowT0] = React.useState(true);
  const [showExpiry, setShowExpiry] = React.useState(true);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = React.useState<{ S: number; pnlExpiry: number; pnlNow?: number } | null>(null);
  const [chartMode, setChartMode] = React.useState<ChartMode>('pnl');
  const [spotInterval, setSpotInterval] = React.useState<'60' | '240' | '1440'>('60');
  const [ivShift, setIvShift] = React.useState(0); // proportion
  const [rPct, setRPct] = React.useState(0);
  const [timePos, setTimePos] = React.useState(0); // 0..1 (today -> expiry)
  const [clock, setClock] = React.useState(0); // timer to refresh min allowed time
  const [hv30, setHv30] = React.useState<number | undefined>();
  const [linearIndex, setLinearIndex] = React.useState<Record<string, number>>({});
  const [graphHover, setGraphHover] = React.useState(false);
  React.useEffect(() => {
    if (chartMode !== 'pnl') {
      setGraphHover(false);
      setHover(null);
    }
  }, [chartMode]);
  const [xZoom, setXZoom] = React.useState(1); // default: show exactly ±50% around spot at open
  const [yZoom, setYZoom] = React.useState(1);
  const [useExecPnl, setUseExecPnl] = React.useState(false);
  // Draggable modal position
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const draggingRef = React.useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // Per-position key for persisting view settings (mouse-positioned zoom, etc.)
  const viewKey = React.useMemo(() => {
    const parts = legs
      .map(L => `${L.side}:${L.leg.symbol}:${L.leg.optionType}:${L.leg.strike}:${L.leg.expiryMs}:${L.qty}`)
      .sort();
    return `pv-v1:${parts.join('|')}`;
  }, [legs]);
  // Persist UI controls
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('position-view-ui-v1');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s?.showT0 === 'boolean') setShowT0(s.showT0);
      if (typeof s?.ivShift === 'number') setIvShift(s.ivShift);
      if (typeof s?.rPct === 'number') setRPct(s.rPct);
      if (typeof s?.timePos === 'number') setTimePos(Math.max(0, Math.min(1, s.timePos)));
      if (typeof s?.xZoom === 'number') setXZoom(Math.max(0.2, Math.min(5, s.xZoom)));
      if (typeof s?.yZoom === 'number') setYZoom(Math.max(0.2, Math.min(5, s.yZoom)));
      if (typeof s?.showExpiry === 'boolean') setShowExpiry(s.showExpiry);
      if (typeof s?.useExecPnl === 'boolean') setUseExecPnl(s.useExecPnl);
      if (s?.chartMode === 'spot' || s?.chartMode === 'pnl') setChartMode(s.chartMode);
      if (s?.spotInterval === '60' || s?.spotInterval === '240' || s?.spotInterval === '1440') setSpotInterval(s.spotInterval);
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem(
        'position-view-ui-v1',
        JSON.stringify({ showT0, showExpiry, ivShift, rPct, timePos, xZoom, yZoom, useExecPnl, chartMode, spotInterval })
      );
    } catch {}
  }, [showT0, showExpiry, ivShift, rPct, timePos, xZoom, yZoom, useExecPnl, chartMode, spotInterval]);

  // Per-position persistence for mouse-positioned view (x/y zoom, time, and display/model params)
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('position-view-ui-bypos-v1');
      const map = raw ? JSON.parse(raw) : {};
      const entry = map[viewKey];
      if (entry && typeof entry === 'object') {
        if (typeof entry.xZoom === 'number') setXZoom(Math.max(0.2, Math.min(5, entry.xZoom)));
        if (typeof entry.yZoom === 'number') setYZoom(Math.max(0.2, Math.min(5, entry.yZoom)));
        if (typeof entry.timePos === 'number') setTimePos(Math.max(0, Math.min(1, entry.timePos)));
        if (typeof entry.ivShift === 'number') setIvShift(entry.ivShift);
        if (typeof entry.rPct === 'number') setRPct(entry.rPct);
        if (typeof entry.showT0 === 'boolean') setShowT0(entry.showT0);
        if (typeof entry.showExpiry === 'boolean') setShowExpiry(entry.showExpiry);
        if (typeof entry.useExecPnl === 'boolean') setUseExecPnl(entry.useExecPnl);
        if (entry.spotInterval === '60' || entry.spotInterval === '240' || entry.spotInterval === '1440') setSpotInterval(entry.spotInterval);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('position-view-ui-bypos-v1');
      const map = raw ? JSON.parse(raw) : {};
      map[viewKey] = { xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry, useExecPnl, spotInterval };
      localStorage.setItem('position-view-ui-bypos-v1', JSON.stringify(map));
    } catch {}
  }, [viewKey, xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry, useExecPnl, spotInterval]);

  // (Reset view handler removed per request)

  // Tick every minute to bump min allowed time (cannot move into past)
  React.useEffect(() => {
    const id = setInterval(() => setClock(c => (c + 1) % 1_000_000), 60_000);
    return () => clearInterval(id);
  }, []);

  // Minimum allowed time position based on days already passed (createdAt → latest expiry)
  const minTimePos = React.useMemo(() => {
    const expiries = legsCalc.map(L => Number(L.leg.expiryMs)).filter(Boolean);
    if (!expiries.length) return 0;
    const latest = Math.max(...expiries);
    const start = Math.min(positionCreatedAt || Date.now(), latest);
    const total = Math.max(1, latest - start);
    const elapsed = Math.max(0, Math.min(Date.now() - start, total));
    return Math.max(0, Math.min(1, elapsed / total));
  }, [legsCalc, positionCreatedAt, clock]);

  // Zero-DTE flag (calendar day of expiry): snap slider to the end
  const isZeroDTE = React.useMemo(() => {
    const expiries = legsCalc.map(L => Number(L.leg.expiryMs)).filter(Boolean);
    if (!expiries.length) return false;
    const latest = Math.max(...expiries);
    const dteDays = Math.floor((latest - Date.now()) / 86_400_000);
    return dteDays <= 0;
  }, [legsCalc, clock]);

  // Effective time position used in calculations
  const effTimePos = isZeroDTE ? 1 : Math.max(minTimePos, Math.max(0, Math.min(1, timePos)));

  const anchorWeight = React.useMemo(() => {
    if (effTimePos <= minTimePos) return 1;
    const denom = Math.max(1e-9, 1 - minTimePos);
    const progress = Math.max(0, (effTimePos - minTimePos) / denom);
    if (progress >= 0.05) return 0;
    return 1 - (progress / 0.05);
  }, [effTimePos, minTimePos]);
  const spotIntervalLabel = React.useMemo(() => {
    switch (spotInterval) {
      case '240':
        return '4H';
      case '1440':
        return '1D';
      default:
        return '1H';
    }
  }, [spotInterval]);

  React.useEffect(() => {
    const symbols = Array.from(new Set(legs.map(l => l.leg.symbol)));
    const unsubs = symbols.slice(0, 300).map(sym => {
      const isOption = sym.includes('-');
      const sub = isOption ? subscribeOptionTicker : subscribeLinearTicker;
      return sub(sym, (t) => setTickers(prev => ({ ...prev, [t.symbol]: { ...(prev[t.symbol] || {}), ...t } })));
    });
    return () => { unsubs.forEach(u => u()); };
  }, [legsCalc]);

  React.useEffect(() => {
    const symbols = Array.from(new Set(legsCalc
      .map(l => inferUnderlyingSpotSymbol(l.leg.symbol))
      .filter((sym): sym is string => Boolean(sym))));
    if (!symbols.length) return undefined;
    const unsubs = symbols.slice(0, 50).map(sym => subscribeLinearTicker(sym, (t) => {
      const raw = t?.indexPrice;
      if (raw == null) return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return;
      setLinearIndex(prev => {
        if (prev[sym] === value) return prev;
        return { ...prev, [sym]: value };
      });
    }));
    return () => { unsubs.forEach(u => u()); };
  }, [legsCalc]);

  // Ensure wheel inside SVG never scrolls page (native listener, passive: false)
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => { try { el.removeEventListener('wheel', handler as any); } catch {} };
  });

  // Global wheel capture: zoom chart and block page scroll when pointer over SVG
  React.useEffect(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const onWheel = (e: WheelEvent) => {
      const svg = svgRef.current; if (!svg) return;
      const path = (e.composedPath && e.composedPath()) || [];
      const inside = Array.isArray(path) ? path.includes(svg) : svg.contains(e.target as Node);
      if (!inside) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = Math.exp(-(e.deltaY) * 0.0015);
      if (e.shiftKey) setYZoom(z => clamp(z * factor, 0.2, 5)); else setXZoom(z => clamp(z * factor, 0.2, 5));
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => { try { window.removeEventListener('wheel', onWheel, true as any); } catch {} };
  }, []);

  React.useEffect(() => {
    let m = true;
    fetchHV30()
      .then((stats) => {
        if (!m || !stats) return;
        const latest = stats?.latest;
        if (latest != null && isFinite(latest)) {
          const value = Math.abs(latest) <= 5 ? latest * 100 : latest;
          setHv30(value);
        }
      })
      .catch(() => {});
    return () => { m = false; };
  }, []);
  
  // Initialize modal position (center horizontally; slight offset from top)
  React.useLayoutEffect(() => {
    if (isSummary) return;
    if (pos != null) return;
    const el = containerRef.current;
    const w = el?.offsetWidth ?? 900;
    const h = el?.offsetHeight ?? 600;
    const x = Math.max(0, Math.round((window.innerWidth - w) / 2));
    const y = Math.max(12, Math.round((window.innerHeight - h) / 5));
    setPos({ x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current, isSummary, pos]);
  // Drag handlers bound to window so we can drag smoothly
  React.useEffect(() => {
    if (isSummary) return () => {};
    const onMove = (e: MouseEvent) => {
      const d = draggingRef.current; if (!d) return;
      const el = containerRef.current;
      const boundsW = window.innerWidth;
      const boundsH = window.innerHeight;
      const w = el?.offsetWidth ?? 600;
      const h = el?.offsetHeight ?? 400;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const nx = Math.min(Math.max(0, d.startPos.x + dx), Math.max(0, boundsW - w));
      const ny = Math.min(Math.max(0, d.startPos.y + dy), Math.max(0, boundsH - h));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { draggingRef.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isSummary]);
  // Spot price comes from option index price (per-leg underlying)


  const calc = React.useMemo(() => {
    const underlyingSpotSymbols = Array.from(new Set(legsCalc
      .map((L) => inferUnderlyingSpotSymbol(L.leg.symbol))
      .filter((sym): sym is string => Boolean(sym))));
    const preferredLinearSpot = (() => {
      for (const sym of underlyingSpotSymbols) {
        const raw = linearIndex[sym];
        if (raw == null) continue;
        const val = Number(raw);
        if (Number.isFinite(val) && val > 0) return val;
      }
      return undefined;
    })();
    const spotCandidates: number[] = [];
    const perpEntryCandidates: number[] = [];
    const strikeCandidates: number[] = [];
    const addCandidate = (value: unknown) => {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) spotCandidates.push(num);
    };
    const det = legsCalc.map((L) => {
      const t = tickers[L.leg.symbol] || {};
      const { bid, ask } = bestBidAsk(t);
      const bidNum = bid != null && isFinite(Number(bid)) ? Number(bid) : undefined;
      const askNum = ask != null && isFinite(Number(ask)) ? Number(ask) : undefined;
      const symbol = String(L.leg.symbol || '');
      const expiryMs = Number(L.leg.expiryMs) || 0;
      const isPerp = !symbol.includes('-') || expiryMs <= 0;
      const exitPriceRaw = Number((L as any)?.exitPrice);
      const exitPrice = Number.isFinite(exitPriceRaw) ? exitPriceRaw : undefined;
      const isExited = exitPrice != null;
      const mid = (() => {
        if (isExited) return exitPrice;
        const raw = midPrice(t);
        return raw != null && isFinite(Number(raw)) ? Number(raw) : undefined;
      })();
      const iv = isExited ? undefined : (t?.markIv != null ? Number(t.markIv) : undefined);
      const dRaw = isExited ? 0 : (t?.delta != null ? Number(t.delta) : (isPerp ? 1 : undefined));
      const vRaw = isExited ? 0 : (t?.vega != null ? Number(t.vega) : undefined);
      const thRaw = isExited ? 0 : (t?.theta != null ? Number(t.theta) : undefined);
      const oi = isExited ? undefined : (t?.openInterest != null ? Number(t.openInterest) : undefined);
      const qty = Number(L.qty) || 1;
      const entryPrice = Number(L.entryPrice) || 0;
      const isShort = L.side === 'short';
      const midSafe = mid ?? entryPrice;
      const execPrice = isExited ? exitPrice : (isShort ? (askNum ?? midSafe) : (bidNum ?? midSafe));
      const execSafe = execPrice ?? midSafe;
      const sgn = L.side === 'long' ? 1 : -1;
      const pnlMid = (isShort ? (entryPrice - midSafe) : (midSafe - entryPrice)) * qty;
      const pnlExec = (isShort ? (entryPrice - execSafe) : (execSafe - entryPrice)) * qty;
      const strike = Number(L.leg.strike);
      if (Number.isFinite(strike) && strike > 0) strikeCandidates.push(strike);
      if (t?.indexPrice != null) addCandidate(t.indexPrice);
      if (isPerp) {
        addCandidate(t?.markPrice);
        addCandidate(t?.lastPrice);
        addCandidate(midSafe);
        addCandidate(bidNum);
        addCandidate(askNum);
        if (Number.isFinite(entryPrice) && entryPrice > 0) perpEntryCandidates.push(entryPrice);
      }
      return {
        L,
        bid: isExited ? undefined : bidNum,
        ask: isExited ? undefined : askNum,
        mid: midSafe,
        execPrice: execSafe,
        pnlMid,
        pnlExec,
        iv,
        d: dRaw != null ? sgn * dRaw : undefined,
        v: vRaw != null ? sgn * vRaw : undefined,
        th: thRaw != null ? sgn * thRaw : undefined,
        oi,
      };
    });
    const netEntry = det.reduce((a, x) => a + (x.L.side === 'short' ? 1 : -1) * x.L.entryPrice * x.L.qty, 0);
    const netMid = det.reduce((a, x) => a + (x.L.side === 'short' ? 1 : -1) * x.mid * x.L.qty, 0);
    const netExec = det.reduce((a, x) => a + (x.L.side === 'short' ? 1 : -1) * x.execPrice * x.L.qty, 0);
    const pnl = netEntry - netMid;
    const pnlExec = netEntry - netExec;
    const greeks = det.reduce((a, x) => ({
      delta: a.delta + (x.d ?? 0) * x.L.qty,
      vega: a.vega + (x.v ?? 0) * x.L.qty,
      theta: a.theta + (x.th ?? 0) * x.L.qty,
    }), { delta: 0, vega: 0, theta: 0 });
    const dtes = Array.from(new Set(legsCalc.map(L => L.leg.expiryMs))).map(ms => Math.max(0, Math.round((ms - Date.now()) / 86400000)));
    const dteLabel = dtes.length ? (dtes.length === 1 ? `${dtes[0]}d` : `${Math.min(...dtes)}–${Math.max(...dtes)}d`) : '—';
    // Spot proxy from any leg's indexPrice
    const spot = (() => {
      if (preferredLinearSpot != null) return preferredLinearSpot;
      for (const candidate of spotCandidates) {
        if (Number.isFinite(candidate) && candidate > 0) return candidate;
      }
      if (perpEntryCandidates.length) {
        const sum = perpEntryCandidates.reduce((acc, v) => acc + v, 0);
        return sum / perpEntryCandidates.length;
      }
      if (strikeCandidates.length) {
        const sum = strikeCandidates.reduce((acc, v) => acc + v, 0);
        return sum / strikeCandidates.length;
      }
      return undefined;
    })();
    const priceHint = (() => {
      if (preferredLinearSpot != null) return preferredLinearSpot;
      if (spot != null && Number.isFinite(spot) && spot > 0) return spot;
      if (perpEntryCandidates.length) {
        const sum = perpEntryCandidates.reduce((acc, v) => acc + v, 0);
        return sum / perpEntryCandidates.length;
      }
      if (strikeCandidates.length) {
        const sum = strikeCandidates.reduce((acc, v) => acc + v, 0);
        return sum / strikeCandidates.length;
      }
      return undefined;
    })();
    return { det, netEntry, netMid, netExec, pnl, pnlExec, greeks, dteLabel, spot, priceHint };
  }, [legsCalc, linearIndex, tickers]);

  const netPnlValue = useExecPnl ? calc.pnlExec : calc.pnl;

  const optionPriceAt = React.useCallback((leg: PositionLeg, S: number, nowMs: number): number => {
    const exitPxRaw = Number((leg as any)?.exitPrice);
    if (Number.isFinite(exitPxRaw)) return exitPxRaw;
    const isPerp = !String(leg.leg.symbol).includes('-');
    if (isPerp) return S;
    const t = tickers[leg.leg.symbol] || {};
    const fallbackIvRaw = hv30 != null ? Number(hv30) : 60;
    const fallbackIv = isFinite(fallbackIvRaw) ? fallbackIvRaw : 60;
    const markIvRaw = t?.markIv != null ? Number(t.markIv) : undefined;
    const markIvPct = markIvRaw != null && isFinite(markIvRaw)
      ? (Math.abs(markIvRaw) <= 3 ? markIvRaw * 100 : markIvRaw)
      : undefined;
    const baseIvPct = markIvPct != null ? markIvPct : fallbackIv;
    const timeFrac = (() => {
      if (effTimePos <= minTimePos) return 0;
      const span = Math.max(1e-9, 1 - minTimePos);
      return Math.max(0, Math.min(1, (effTimePos - minTimePos) / span));
    })();
    const expiryMs = Number(leg.leg.expiryMs) || 0;
    const K = Math.max(Number(leg.leg.strike) || 0, 1e-8);
    const intrinsic = leg.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
    if (!(expiryMs > nowMs)) return intrinsic;
    const Tfull = Math.max(0, (expiryMs - nowMs) / YEAR_MS);
    const T = Math.max(0, Tfull * (1 - timeFrac));
    if (T <= 1e-8) return intrinsic;
    const sigma = Math.max(0.0001, (baseIvPct / 100) * (1 + ivShift));
    return bsPrice(leg.leg.optionType, Math.max(S, 1e-8), K, T, sigma, rPct / 100);
  }, [tickers, hv30, effTimePos, minTimePos, ivShift, rPct]);

  // Expiry PnL extrema (max profit/loss). Uses expiry payoff across S in {0, strikes, large S} with unbounded detection on S→∞.
  const extrema = React.useMemo(() => {
    const priceAnchor = calc.priceHint;
    const strikeValues = legsCalc
      .map((l) => Number(l.leg.strike))
      .filter((s) => Number.isFinite(s) && s > 0) as number[];
    if (!strikeValues.length && priceAnchor != null && Number.isFinite(priceAnchor) && priceAnchor > 0) {
      strikeValues.push(priceAnchor);
    }
    if (!strikeValues.length) strikeValues.push(100);
    const Ks = Array.from(new Set(strikeValues)).sort((a,b)=>a-b);
    const netEntry = calc.netEntry;
    const pnlAt = (S: number) => {
      let signedVal = 0;
      for (const L of legsCalc) {
        const isPerp = !String(L.leg.symbol).includes('-');
        const K = Number(L.leg.strike) || 0; const q = Number(L.qty) || 1; const sign = L.side === 'short' ? 1 : -1;
        const intrinsic = isPerp ? S : (L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S));
        signedVal += sign * intrinsic * q;
      }
      return netEntry - signedVal;
    };
    const S0 = 0;
    const largestRef = Math.max(
      Ks.length ? Ks[Ks.length - 1] : 0,
      priceAnchor != null && Number.isFinite(priceAnchor) ? Number(priceAnchor) : 0,
    );
    const baseSpan = largestRef > 0 ? largestRef : 1000;
    const Sbig = baseSpan * 3 + 1;
    const candidates = [S0, ...Ks, Sbig];
    if (priceAnchor != null && Number.isFinite(priceAnchor) && priceAnchor > 0) {
      candidates.push(Number(priceAnchor));
    }
    let minV = Infinity, maxV = -Infinity;
    for (const S of candidates) {
      const v = pnlAt(S);
      if (isFinite(v)) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
    }
    // Unbounded check to the right: slope as S→∞ depends on calls and PERP legs
    const slopeRight = (() => {
      let s = 0;
      for (const L of legsCalc) {
        const isPerp = !String(L.leg.symbol).includes('-');
        const sign = L.side === 'short' ? 1 : -1;
        if (L.leg.optionType === 'C' || isPerp) {
          s += sign * (Number(L.qty) || 1);
        }
      }
      // PnL = netEntry - s*S + ... when S > max K for calls
      return -s;
    })();
    // If slope > 0 as S→∞, PnL grows without bound (unbounded profit); if slope < 0, PnL falls without bound (unbounded loss)
    const unboundedProfit = slopeRight > 0;
    const unboundedLoss = slopeRight < 0;
    return {
      maxProfit: maxV,
      maxLoss: minV,
      unboundedProfit,
      unboundedLoss,
    };
  }, [legsCalc, calc.netEntry, calc.priceHint]);

  // Expiry payoff chart (PnL vs S)
  const payoff = React.useMemo(() => {
    const priceHint = calc.priceHint;
    const strikeValues = legsCalc
      .map((l) => Number(l.leg.strike))
      .filter((s) => Number.isFinite(s) && s > 0) as number[];
    if (!strikeValues.length && priceHint != null && Number.isFinite(priceHint) && priceHint > 0) {
      strikeValues.push(priceHint);
    }
    if (!strikeValues.length) strikeValues.push(100);
    const Kmin = Math.min(...strikeValues);
    const Kmax = Math.max(...strikeValues);
    if (!baseDomainRef.current) {
      const spotVal = priceHint != null && Number.isFinite(priceHint) && priceHint > 0 ? Number(priceHint) : undefined;
      if (spotVal != null) {
        const span = Math.max(spotVal * 0.5, 25);
        const minGuess = Math.max(0.01, spotVal - span);
        const maxGuess = Math.max(minGuess + 1, spotVal + span);
        baseDomainRef.current = { minX: minGuess, maxX: maxGuess };
      } else {
        // Fallback: center by strikes
        const uniqK = Array.from(new Set(strikeValues.map(Number)));
        if (uniqK.length === 1) {
          const K = uniqK[0];
          const range = Math.max(50, Math.abs(K) * 0.35);
          baseDomainRef.current = { minX: Math.max(0.01, K - range), maxX: K + range };
        } else {
          const spanK = Math.max(1, Kmax - Kmin);
          baseDomainRef.current = { minX: Math.max(0.01, Kmin - spanK * 1.0), maxX: Kmax + spanK * 1.0 };
        }
      }
    }
    const baseMinX = baseDomainRef.current!.minX;
    const baseMaxX = baseDomainRef.current!.maxX;
    const xCenter = (baseMinX + baseMaxX) / 2;
    const xRange0 = Math.max(0.001, baseMaxX - baseMinX);
    const xRange = xRange0 / Math.max(0.1, xZoom);
    const minX = Math.max(0.01, xCenter - xRange / 2);
    const maxX = minX + xRange;
    const netEntry = calc.netEntry;
    const valueAt = (S: number) => {
      let signedVal = 0;
      for (const L of legsCalc) {
        const K = Number(L.leg.strike) || 0;
        const qty = Number(L.qty) || 1;
        const sign = L.side === 'short' ? 1 : -1;
        const symbol = String(L.leg.symbol || '');
        const expiryMs = Number(L.leg.expiryMs) || 0;
        const isPerp = !symbol.includes('-') || expiryMs <= 0;
        const intrinsic = isPerp
          ? S
          : (L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S));
        signedVal += sign * intrinsic * qty;
      }
      return netEntry - signedVal;
    };
    const W = 640, H = 300, Lm = 44, Rm = 14, Tm = 12, Bm = 36;
    const x0 = Lm, x1 = W - Rm, y0 = Tm, y1 = H - Bm;
    const xs: number[] = [];
    const N = 120;
    for (let i = 0; i <= N; i++) xs.push(minX + (i / N) * (maxX - minX));
    const netClose = useExecPnl ? calc.netExec : calc.netMid;
    const expVals = xs.map(S => valueAt(S));
    // Compute T+0 raw values separately; Y-scaling will prioritize expiry structure for clarity
    const tNow = Date.now();
    const latestMs = Math.max(...legsCalc.map(L => Number(L.leg.expiryMs)));
    // Anchor so that model equals actual PnL at current spot
    let anchorOffset = 0;
    if (latestMs > 0 && tNow < latestMs && calc.spot != null && isFinite(calc.spot)) {
      const S0 = Number(calc.spot);
      let v0 = 0;
      for (const L of legsCalc) {
        const sign = L.side === 'short' ? 1 : -1;
        const qty = Number(L.qty) || 1;
        const price = optionPriceAt(L, S0, tNow);
        v0 += sign * price * qty;
      }
      const model0 = calc.netEntry - v0;
      const actual0 = calc.netEntry - netClose;
      if (isFinite(model0) && isFinite(actual0)) anchorOffset = (actual0 - model0) * anchorWeight;
    }
    const dteDays0 = Math.floor((latestMs - tNow) / 86_400_000);
    const nowVals = (latestMs > 0 && dteDays0 > 0) ? xs.map(S => {
      let valNow = 0;
      for (const L of legsCalc) {
        const sign = L.side === 'short' ? 1 : -1;
        const qty = Number(L.qty) || 1;
        const price = optionPriceAt(L, S, tNow);
        valNow += sign * price * qty;
      }
      return (calc.netEntry - valNow) + anchorOffset;
    }) : undefined;
    const yMin0 = Math.min(...expVals);
    const yMax0 = Math.max(...expVals);
    const yCenter = (yMin0 + yMax0) / 2;
    const yHalf0 = Math.max(0.001, (yMax0 - yMin0) / 2);
    const yHalf = (yHalf0 * 1.6) / Math.max(0.1, yZoom); // allow vertical zoom via wheel (Shift)
    const yLow = yCenter - yHalf;
    const yHigh = yCenter + yHalf;
    const yPad = Math.max(4, (yHigh - yLow) * 0.08);
    const xScale = (x: number) => x0 + ((x - minX) / (maxX - minX)) * (x1 - x0);
    const yScale = (y: number) => y1 - ((y - (yLow - yPad)) / ((yHigh + yPad) - (yLow - yPad))) * (y1 - y0);
    // Build paths
    const path = (() => {
      const d: string[] = [];
      for (let i = 0; i < xs.length; i++) {
        const cmd = i === 0 ? 'M' : 'L';
        d.push(`${cmd} ${xScale(xs[i])},${yScale(expVals[i])}`);
      }
      return d.join(' ');
    })();
    const nowPath = nowVals ? (() => {
      const d: string[] = [];
      for (let i = 0; i < xs.length; i++) {
        const cmd = i === 0 ? 'M' : 'L';
        d.push(`${cmd} ${xScale(xs[i])},${yScale(nowVals[i])}`);
      }
      return d.join(' ');
    })() : null;
    // BE points (expiry) — zero crossings of expiry payoff
    const be: number[] = [];
    const beColors: string[] = [];
    const dS = (maxX - minX) / Math.max(10, N);
    for (let i = 1; i < xs.length; i++) {
      const p1y = expVals[i - 1], p2y = expVals[i];
      if ((p1y <= 0 && p2y >= 0) || (p1y >= 0 && p2y <= 0)) {
        const dy = p2y - p1y;
        if (Math.abs(dy) > 1e-9) {
          const t = (0 - p1y) / dy;
          const Sx = xs[i - 1] + t * (xs[i] - xs[i - 1]);
          be.push(Sx);
          // Determine side with profit to color marker: green if right side profit, else red
          const yRight = valueAt(Sx + dS * 0.5);
          beColors.push(yRight > 0 ? '#2e7d32' : '#c62828');
        }
      }
    }
    const beCoords = be.map((Sx, idx) => ({ S: Sx, x: xScale(Sx), y: yScale(0), color: beColors[idx] }));
    // BE points for T+0 curve (movable with time)
    const beNowCoords = (() => {
      if (!nowVals) return [] as Array<{ S: number; x: number; y: number; color: string }>;
      const out: Array<{ S: number; x: number; y: number; color: string }> = [];
      for (let i = 1; i < xs.length; i++) {
        const p1y = nowVals[i - 1], p2y = nowVals[i];
        if ((p1y <= 0 && p2y >= 0) || (p1y >= 0 && p2y <= 0)) {
          const dy = p2y - p1y;
          if (Math.abs(dy) > 1e-9) {
            const t = (0 - p1y) / dy;
            const Sx = xs[i - 1] + t * (xs[i] - xs[i - 1]);
            out.push({ S: Sx, x: xScale(Sx), y: yScale(0), color: '#2563eb' });
          }
        }
      }
      return out;
    })();
    // Bands between strikes (alternate light shading)
    const Ks = Array.from(new Set(strikeValues.map(Number))).sort((a, b) => a - b);
    const bands: Array<{ x1: number; x2: number; fill: string }> = [];
    for (let i = 0; i < Ks.length - 1; i++) {
      const a = Math.max(minX, Ks[i]);
      const b = Math.min(maxX, Ks[i + 1]);
      if (b > a) bands.push({ x1: a, x2: b, fill: i % 2 === 0 ? 'rgba(127,127,127,.035)' : 'rgba(127,127,127,.06)' });
    }
    const xTicks = (() => {
      const range = maxX - minX;
      if (!(range > 0)) return [] as number[];
      const rough = range / 6;
      const exp = Math.pow(10, Math.floor(Math.log10(rough)));
      const f = rough / exp;
      let n = 1;
      if (f <= 1) n = 1; else if (f <= 2) n = 2; else if (f <= 2.5) n = 2.5; else if (f <= 5) n = 5; else n = 10;
      const step = n * exp;
      const start = Math.ceil(minX / step) * step;
      const out: number[] = [];
      for (let v = start; v <= maxX + 1e-6; v += step) out.push(v);
      return out;
    })();
    const yTicks = (() => {
      const yMinV = yLow - yPad;
      const yMaxV = yHigh + yPad;
      const range = yMaxV - yMinV;
      if (!(range > 0)) return [] as number[];
      const rough = range / 6;
      const exp = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, Math.abs(rough)))));
      const f = rough / exp;
      let n: number;
      if (f <= 1) n = 1; else if (f <= 2) n = 2; else if (f <= 2.5) n = 2.5; else if (f <= 5) n = 5; else n = 10;
      const step = n * exp;
      const start = Math.ceil(yMinV / step) * step;
      const out: number[] = [];
      for (let v = start; v <= yMaxV + 1e-9; v += step) out.push(v);
      // Ensure 0 present if within range
      if (yMinV <= 0 && yMaxV >= 0 && !out.some(t => Math.abs(t) < step * 0.25)) out.push(0);
      out.sort((a,b)=>a-b);
      return out;
    })();
    return { W, H, x0, x1, y0, y1, minX, maxX, xScale, yScale, path, nowPath, xTicks, yTicks, yZero: yScale(0), beCoords, beNowCoords, bands };
  }, [legs, calc.netEntry, calc.netMid, calc.netExec, calc.priceHint, effTimePos, minTimePos, xZoom, yZoom, useExecPnl, optionPriceAt]);

  // Screenshot functionality removed per request

  const closeTimestamp = closeSnapshot?.timestamp ?? (Number.isFinite(closedAt) ? Number(closedAt) : undefined);

  const alreadyExited = closeSnapshot != null || typeof closedAt === 'number';

  const exitTimestamp = closeTimestamp;
  const exitPrice = React.useMemo(() => {
    if (!closeSnapshot) return undefined;
    const toNumber = (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };
    return toNumber(closeSnapshot.spotPrice) ?? toNumber(closeSnapshot.indexPrice);
  }, [closeSnapshot]);

  const closeInfo = React.useMemo(() => {
    if (!(closeTimestamp != null)) return null;
    const dt = new Date(closeTimestamp);
    if (Number.isNaN(dt.getTime())) return null;
    const datePart = dt.toLocaleDateString('ru-RU');
    const timePart = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
    const formatNum = (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(2) : '—';
    };
    const pnlValue = closeSnapshot?.pnlExec;
    const pnlNum = Number(pnlValue);
    const pnlStr = Number.isFinite(pnlNum) ? `${pnlNum >= 0 ? '+' : ''}${pnlNum.toFixed(2)}` : '—';
    const pnlStyle = Number.isFinite(pnlNum)
      ? (pnlNum > 0 ? { color: 'var(--gain)' } : (pnlNum < 0 ? { color: 'var(--loss)' } : undefined))
      : undefined;
    return {
      datePart,
      timePart,
      index: formatNum(closeSnapshot?.indexPrice),
      spot: formatNum(closeSnapshot?.spotPrice),
      pnlStr,
      pnlStyle,
    };
  }, [closeTimestamp, closeSnapshot]);

  const canClosePosition = typeof onClosePosition === 'function' && !alreadyExited;

  const formatPerpExitLines = React.useCallback((): string[] => {
    const lines: string[] = [];
    legs.forEach((L) => {
      const sym = String(L.leg.symbol || '');
      if (!sym || sym.includes('-')) return;
      const t = tickers[sym] || {};
      const { bid, ask } = bestBidAsk(t);
      const price = L.side === 'long' ? bid : ask;
      const display = (price != null && isFinite(Number(price))) ? Number(price).toFixed(2) : 'n/a';
      const label = L.side === 'long' ? 'bid' : 'ask';
      const qty = Number(L.qty) || 1;
      const qtyLabel = Number.isFinite(qty) ? `×${qty}` : '';
      lines.push(`${L.side === 'short' ? 'Short' : 'Long'} ${sym} ${qtyLabel} @ ${label} ${display}`);
    });
    return lines;
  }, [legs, tickers]);

  const handleClosePosition = React.useCallback(() => {
    if (!canClosePosition || !onClosePosition) return;
    const perpLines = formatPerpExitLines();
    const message = perpLines.length
      ? `Exit this item?\n${perpLines.join('\n')}`
      : 'Exit this item?';
    if (window.confirm(message)) onClosePosition();
  }, [canClosePosition, onClosePosition, formatPerpExitLines]);

  const containerStyle: React.CSSProperties = isSummary
    ? {
        background: 'var(--card)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        overflow: 'visible',
      }
    : {
        position: 'absolute',
        left: Math.max(0, pos?.x ?? 0),
        top: Math.max(0, pos?.y ?? 0),
        background: 'var(--card)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        width: 900,
        maxWidth: '95%',
        maxHeight: '90%',
        overflow: 'auto',
        overscrollBehavior: 'contain',
        boxShadow: '0 10px 24px rgba(0,0,0,.35)',
      };

  const card = (
      <div
        ref={containerRef}
        style={containerStyle}
        data-position-id={id}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            cursor: isSummary ? 'default' : 'move',
            userSelect: !isSummary && draggingRef.current ? 'none' : undefined,
          }}
          onMouseDown={(e) => {
            if (isSummary || !pos) return;
            const target = e.target as HTMLElement;
            if (target && target.closest('button, input, select, textarea, a')) return;
            draggingRef.current = { startX: e.clientX, startY: e.clientY, startPos: { ...pos } };
            document.body.style.cursor = 'grabbing';
          }}
        >
          <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <strong>{title || 'Position View'}</strong>
            {closeInfo && (
              <span className="muted" style={{fontSize:'0.85em', display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span>{`Closed ${closeInfo.datePart} ${closeInfo.timePart}`}</span>
                <span>| Index {closeInfo.index}</span>
                <span>| Spot {closeInfo.spot}</span>
                <span style={closeInfo.pnlStyle ?? undefined}>| PNLexec {closeInfo.pnlStr}</span>
              </span>
            )}
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            {canClosePosition && (
              <button className="ghost" onClick={handleClosePosition}>Exit</button>
            )}
            {!isSummary && (
              <button className="ghost" onClick={onClose} aria-label="Close view">Close</button>
            )}
          </div>
        </div>
        <div style={{padding:12}}>
          <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap'}}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <span className="muted">Chart</span>
              <select value={chartMode} onChange={(e) => setChartMode(e.target.value as ChartMode)}>
                <option value="pnl">PnL profile</option>
                <option value="spot">ETH/USDT spot (TradingView)</option>
              </select>
            </div>
            {chartMode === 'pnl' ? (
              <>
                <div className="muted">PnL vs underlying price</div>
                <label style={{display:'flex', alignItems:'center', gap:6}}>
                  <input type="checkbox" checked={showT0} onChange={(e)=>setShowT0(e.target.checked)} />
                  <span className="muted">Show T-curve (today)</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:6}}>
                  <input type="checkbox" checked={showExpiry} onChange={(e)=>setShowExpiry(e.target.checked)} />
                  <span className="muted">Show expiry payoff</span>
                </label>
                <div style={{display:'flex', alignItems:'center', gap:6}}>
                  <span className="muted">IV shift</span>
                  <input type="range" min={-0.5} max={0.5} step={0.01} value={ivShift} onChange={(e)=>setIvShift(Number(e.target.value))} />
                  <span className="muted">{Math.round(ivShift * 100)}%</span>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                  <span className="muted">Rate (r)</span>
                  <input type="number" step={0.25} value={rPct} onChange={(e)=>setRPct(Number(e.target.value))} style={{width:72}} />
                  <span className="muted">%</span>
                  <span style={{marginLeft:12}} className="muted">Time: Today → Expiry</span>
                  <input
                    type="range"
                    min={isZeroDTE ? 0 : minTimePos}
                    max={1}
                    step={0.001}
                    value={isZeroDTE ? 1 : Math.max(minTimePos, timePos)}
                    onChange={(e)=> {
                      const raw = Number(e.target.value);
                      const snapped = raw >= 0.999 ? 1 : raw;
                      setTimePos(Math.max(minTimePos, snapped));
                    }}
                    style={{width:220}}
                  />
                  <span className="muted">{(() => {
                    const expiries = legsCalc.map(L => Number(L.leg.expiryMs)).filter(Boolean);
                    if (!expiries.length) return 'DTE: —';
                    const tNow = Date.now();
                    const latest = Math.max(...expiries);
                    const start = Math.min(positionCreatedAt || tNow, latest);
                    const total = Math.max(1, latest - start);
                    const targetTime = start + effTimePos * total;
                    const ds = expiries.map(ms => Math.max(0, Math.round((ms - targetTime) / 86_400_000)));
                    const d = ds.length ? Math.max(...ds) : 0; // show remaining to latest expiry at target time
                    return `DTE: ${d}d`;
                  })()}</span>
                </div>
              </>
            ) : (
              <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span className="muted">TradingView candlesticks · interval {spotIntervalLabel} (auto refresh every 3 minutes)</span>
                <label style={{display:'flex', alignItems:'center', gap:6}}>
                  <span className="muted">Interval</span>
                  <select value={spotInterval} onChange={(e) => setSpotInterval(e.target.value as '60' | '240' | '1440')}>
                    <option value="60">1H</option>
                    <option value="240">4H</option>
                    <option value="1440">1D</option>
                  </select>
                </label>
              </div>
            )}
          </div>
          {chartMode === 'pnl' ? (
            <svg ref={svgRef} width={payoff.W} height={payoff.H} style={{maxWidth:'100%', height:'auto', cursor:'crosshair'}} viewBox={`0 0 ${payoff.W} ${payoff.H}`}
               onMouseEnter={()=>setGraphHover(true)}
               onMouseMove={(e)=>{
                 const svg = svgRef.current; if (!svg) return;
                 const rect = svg.getBoundingClientRect();
                 const px = e.clientX - rect.left;
                 const xSvg = (px / rect.width) * payoff.W;
                 const xClamped = Math.max(payoff.x0, Math.min(payoff.x1, xSvg));
                 const S = payoff.minX + ((xClamped - payoff.x0) / (payoff.x1 - payoff.x0)) * (payoff.maxX - payoff.minX);
                 // Compute PnL at expiry and today
                 const pnlExpiry = (()=>{
                   let signedVal = 0; const netEntry = calc.netEntry;
                   for (const L of legsCalc) {
                     const isPerp = !String(L.leg.symbol).includes('-');
                     const K = Number(L.leg.strike) || 0; const q = Number(L.qty) || 1; const sign = L.side === 'short' ? 1 : -1;
                     const intrinsic = isPerp ? S : (L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S));
                     signedVal += sign * intrinsic * q;
                   }
                   return netEntry - signedVal;
                 })();
                 const pnlNow = (()=>{
                   const latestMs = Math.max(...legsCalc.map(L => Number(L.leg.expiryMs)));
                   if (!(latestMs > 0) || Date.now() >= latestMs) return undefined;
                   let valNow = 0; const tNow = Date.now();
                   for (const L of legsCalc) {
                     const sign = L.side === 'short' ? 1 : -1;
                     const qty = Number(L.qty) || 1;
                     const price = optionPriceAt(L, S, tNow);
                     valNow += sign * price * qty;
                   }
                   // Anchor offset so crosshair 'Today' value matches actual PnL at spot,
                   // and decays to 0 as we approach expiry
                   let offset = 0;
                   if (calc.spot != null && isFinite(calc.spot)) {
                     const S0 = Number(calc.spot);
                     let v0 = 0; const tNow2 = Date.now();
                     for (const L of legsCalc) {
                       const sign = L.side === 'short' ? 1 : -1;
                       const qty = Number(L.qty) || 1;
                       const price = optionPriceAt(L, S0, tNow2);
                       v0 += sign * price * qty;
                     }
                     const modelPnL0 = calc.netEntry - v0;
                     const netClose = useExecPnl ? calc.netExec : calc.netMid;
                     const actualPnL0 = calc.netEntry - netClose;
                     if (isFinite(modelPnL0) && isFinite(actualPnL0)) {
                       offset = (actualPnL0 - modelPnL0) * anchorWeight;
                     }
                   }
                   return (calc.netEntry - valNow) + offset;
                 })();
                 setHover({ S, pnlExpiry, pnlNow });
               }}
               onMouseLeave={()=>{ setHover(null); setGraphHover(false); }}>
            <line x1={payoff.x0} y1={payoff.y1} x2={payoff.x1} y2={payoff.y1} stroke="var(--border)" />
            <line x1={payoff.x0} y1={payoff.y0} x2={payoff.x0} y2={payoff.y1} stroke="var(--border)" />
            <line x1={payoff.x0} y1={payoff.yZero} x2={payoff.x1} y2={payoff.yZero} stroke="rgba(127,127,127,.5)" strokeDasharray="4 4" />
            {/* Background bands between strikes */}
            {payoff.bands.map((b, i) => (
              <rect key={i} x={payoff.xScale(b.x1)} y={payoff.y0} width={Math.max(0, payoff.xScale(b.x2) - payoff.xScale(b.x1))} height={payoff.y1 - payoff.y0} fill={b.fill} />
            ))}
            {payoff.xTicks.map((v, i) => (
              <g key={i}>
                <line x1={payoff.xScale(v)} y1={payoff.y1} x2={payoff.xScale(v)} y2={payoff.y1 + 6} stroke="var(--border)" />
                <text x={payoff.xScale(v)} y={payoff.y1 + 18} fontSize="10" textAnchor="middle" fill="var(--fg)">{Math.round(v)}</text>
              </g>
            ))}
            {/* Y-axis ticks & labels */}
            {payoff.yTicks && payoff.yTicks.map((v, i) => (
              <g key={`yt-${i}`}>
                <line x1={payoff.x0 - 4} y1={payoff.yScale(v)} x2={payoff.x0} y2={payoff.yScale(v)} stroke="var(--border)" />
                <text x={payoff.x0 - 6} y={payoff.yScale(v) + 3} fontSize="10" textAnchor="end" fill="var(--fg)">{Math.round(v)}</text>
              </g>
            ))}
            {/* Y-axis label */}
            <text x={payoff.x0 - 28} y={(payoff.y0 + payoff.y1) / 2} fontSize="10" fill="var(--fg)" transform={`rotate(-90 ${payoff.x0 - 28}, ${(payoff.y0 + payoff.y1) / 2})`}>PNL</text>
            {/* Live spot and PnL overlay (top-left inside chart) */}
            {(() => {
              const x = payoff.x0 + 8;
              const y = payoff.y0 + 14;
              const dy = 16;
              const spotStr = (calc.spot != null && isFinite(calc.spot)) ? `$${Number(calc.spot).toFixed(0)}` : '—';
              const pnlStr = isFinite(netPnlValue) ? `$${netPnlValue.toFixed(2)}` : '—';
              const maxProfitStr = extrema.unboundedProfit ? '∞' : (isFinite(extrema.maxProfit) ? `$${Math.max(0, extrema.maxProfit).toFixed(2)}` : '—');
              const maxLossStr = extrema.unboundedLoss ? '∞' : (isFinite(extrema.maxLoss) ? `$${Math.max(0, -extrema.maxLoss).toFixed(2)}` : '—');
              const gap = 6; // extra spacing between PnL and Max Profit
              return (
                <g>
                  <text x={x} y={y} fontSize="12" fill="var(--fg)">Index: {spotStr}</text>
                  <text x={x} y={y + dy} fontSize="12" fill="var(--fg)">PnL: {pnlStr}</text>
                  <text x={x} y={y + dy*2 + gap} fontSize="12" fill="var(--fg)">Max Profit: {maxProfitStr}</text>
                  <text x={x} y={y + dy*3 + gap} fontSize="12" fill="var(--fg)">Max Loss: {maxLossStr}</text>
                </g>
              );
            })()}
            {/* Strike markers */}
            {(() => {
              const strikeMarkers = Array.from(new Set(
                legsCalc
                  .filter((l) => {
                    const symbol = String(l.leg.symbol || '');
                    const exp = Number(l.leg.expiryMs) || 0;
                    return symbol.includes('-') && exp > 0;
                  })
                  .map((l) => Number(l.leg.strike) || 0)
                  .filter((s) => Number.isFinite(s) && s > 0),
              ));
              return strikeMarkers.map((K, i) => (
                <line key={i} x1={payoff.xScale(K)} y1={payoff.y0} x2={payoff.xScale(K)} y2={payoff.y1} stroke="#9aa0a6" strokeDasharray="3 3" />
              ));
            })()}
            {/* Per-leg markers at top to reflect option legs */}
            {(() => {
              const byK: Record<string, { K: number; items: { side: 'long'|'short'; type: 'C'|'P'; qty: number }[] }> = {};
              legs.forEach(L => {
                const symbol = String(L.leg.symbol || '');
                const exp = Number(L.leg.expiryMs) || 0;
                if (!symbol.includes('-') || exp <= 0) return;
                const K = Number(L.leg.strike) || 0;
                if (!(Number.isFinite(K) && K > 0)) return;
                const key = String(K);
                if (!byK[key]) byK[key] = { K, items: [] };
                byK[key].items.push({ side: L.side, type: L.leg.optionType, qty: Number(L.qty) || 1 });
              });
              const nodes: JSX.Element[] = [];
              Object.values(byK).forEach(g => {
                g.items.forEach((it, idx) => {
                  const x = payoff.xScale(g.K);
                  const y = payoff.y0 + 12 + idx * 12;
                  const color = it.side === 'long' ? '#43a047' : '#e53935';
                  const label = `${it.side === 'long' ? 'L' : 'S'} ${it.type}${it.qty !== 1 ? '×' + it.qty : ''}`;
                  nodes.push(
                    <g key={`${g.K}-${idx}`}>
                      <circle cx={x} cy={y - 3} r={3} fill={color} />
                      <text x={x + 6} y={y} fontSize="10" fill={color}>{label}</text>
                    </g>
                  );
                });
              });
              return nodes;
            })()}
            {/* Spot marker (if available) */}
            {calc.spot != null && (
              <line x1={payoff.xScale(calc.spot)} y1={payoff.y0} x2={payoff.xScale(calc.spot)} y2={payoff.y1} stroke="#43a047" strokeDasharray="2 3" />
            )}
            {/* Draw T+0 first, structure on top for visibility */}
            {showT0 && payoff.nowPath && <path d={payoff.nowPath} fill="none" stroke="#2563eb" strokeWidth={2} opacity={0.95} />}
            {showExpiry && <path d={payoff.path} fill="none" stroke="#ff9800" strokeWidth={2.5} strokeDasharray="6 4" opacity={0.95} />}
            {/* Legend labels removed per request */}
            {/* Break-even vertical dashed lines (Expiry) — show only when T-curve is hidden */}
            {!showT0 && payoff.beCoords.map((p, i) => (
              <line key={`be-exp-${i}`} x1={p.x} y1={payoff.y0} x2={p.x} y2={payoff.y1} stroke="#f9a825" strokeDasharray="3 3" opacity={0.9} />
            ))}
            {/* Movable BE lines for T+0 with label */}
            {showT0 && payoff.beNowCoords && payoff.beNowCoords.map((p, i) => (
              <g key={`be-now-${i}`}>
                <line x1={p.x} y1={payoff.y0} x2={p.x} y2={payoff.y1} stroke="#2563eb" strokeDasharray="3 3" opacity={0.9} />
                {calc.spot != null && isFinite(calc.spot) && p.S != null && (
                  (() => {
                    const spotV = Number(calc.spot);
                    const beV = Number(p.S);
                    const diffPct = Math.abs(((beV - spotV) / Math.max(1e-9, spotV)) * 100);
                    const sign = (isFinite(netPnlValue) && netPnlValue > 0) ? '-' : '';
                    const shown = `${sign}${diffPct.toFixed(2)}%`;
                    const tx = p.x - 6;
                    const ty = payoff.y0 + (payoff.y1 - payoff.y0) * 0.70; // moved 2% higher (from 28% to 30% above bottom)
                    return (
                      <text x={tx} y={ty} fontSize="10" fontWeight="bold" fill="#c6c6c6" textAnchor="middle" transform={`rotate(-90 ${tx}, ${ty})`} style={{ letterSpacing: '0.8px' }}>
                        <tspan>Breakeven Point</tspan>
                        <tspan dx="10">{shown}</tspan>
                      </text>
                    );
                  })()
                )}
              </g>
            ))}
            {/* BE markers at y=0 (Expiry) — show only when T-curve is hidden */}
            {!showT0 && payoff.beCoords.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={3} fill={p.color} />
                <text x={p.x + 4} y={p.y - 4} fontSize="10" fill={p.color}>BE</text>
              </g>
            ))}
            {/* Hover crosshair and tooltip */}
            {hover && (
              <>
                <line x1={payoff.xScale(hover.S)} y1={payoff.y0} x2={payoff.xScale(hover.S)} y2={payoff.y1} stroke="rgba(127,127,127,.5)" strokeDasharray="3 3" />
                {(() => {
                  const bx = Math.min(payoff.xScale(hover.S) + 8, payoff.x1 - 120);
                  const by = payoff.y0 + 8;
                  const lines = (showT0 ? 1 : 0) + (showExpiry ? 1 : 0);
                  const boxW = 120, boxH = 26 + 18 * Math.max(1, lines);
                  return (
                    <g>
                      <rect x={bx} y={by} width={boxW} height={boxH} rx={6} ry={6} fill="rgba(0,0,0,0.25)" stroke="transparent" />
                      <text x={bx + 8} y={by + 18} fontSize="15" fill="var(--fg)">Price: {Math.round(hover.S)}</text>
                      {showT0 && <text x={bx + 8} y={by + 36} fontSize="15" fill="#2563eb">Today: {hover.pnlNow != null ? hover.pnlNow.toFixed(2) : '—'}</text>}
                      {showExpiry && <text x={bx + 8} y={by + (showT0 ? 54 : 36)} fontSize="15" fill="#ff9800">Expiry: {hover.pnlExpiry.toFixed(2)}</text>}
                    </g>
                  );
                })()}
              </>
            )}
            </svg>
          ) : (
            <SpotPriceChart
              active={chartMode === 'spot'}
              symbol="ETHUSDT"
              interval={spotInterval}
              entryTimestamp={positionCreatedAt}
              exitTimestamp={exitTimestamp}
              exitPrice={exitPrice}
            />
          )}

          {/* Zoom controls removed by request; default X zoom set to 0.5 */}

          <div className="grid" style={{gridTemplateColumns:'repeat(11, minmax(80px, max-content))', columnGap:6, rowGap:2, marginBottom: 6, fontSize:'calc(1em - 2px)'}}>
            <div style={{gridColumn:'1 / -1', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12}}>
              <div style={{minWidth:0}}>
                <div className="muted">Position</div>
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <div style={{fontWeight:600, whiteSpace:'normal', overflowWrap:'anywhere'}}>{title || '—'}</div>
                  {onEdit && (
                    <button className="ghost" onClick={onEdit} style={{flexShrink:0}}>Edit</button>
                  )}
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <input type="checkbox" checked={useExecPnl} onChange={(e)=>setUseExecPnl(e.target.checked)} />
                    <span className="muted">PNL($) exec</span>
                  </label>
                </div>
              </div>
            </div>
            {/* Core meta */}
            <div><div className="muted">Created</div><div>{new Date(positionCreatedAt).toISOString().slice(0,10)}</div></div>
            <div><div className="muted">DTE</div><div>{calc.dteLabel}</div></div>
            {/* Width (if available) */}
            {(() => {
              const exps = Array.from(new Set(legsCalc.map(L => Number(L.leg.expiryMs) || 0)));
              if (exps.length === 1) {
                const Ks = Array.from(new Set(legsCalc.map(L => Number(L.leg.strike) || 0))).sort((a,b)=>a-b);
                if (Ks.length === 2) {
                  const w = Ks[1] - Ks[0];
                  return <div><div className="muted">Width</div><div>{w.toFixed(2)}</div></div>;
                }
                if (Ks.length >= 3) {
                  const left = Ks[1] - Ks[0];
                  const right = Ks[Ks.length - 1] - Ks[Ks.length - 2];
                  if (Math.abs(left - right) <= 1e-6) {
                    return <div><div className="muted">Width</div><div>{left.toFixed(2)}</div></div>;
                  }
                }
              }
              return null;
            })()}
            {/* Net figures moved up to align with Width */}
            <div><div className="muted">Net entry</div><div>{calc.netEntry.toFixed(2)}</div></div>
            <div><div className="muted">Net mid</div><div>{calc.netMid.toFixed(2)}</div></div>
            <div><div className="muted">Kmid</div><div>{(() => {
              const ratio = calc.netEntry !== 0 ? calc.netMid / calc.netEntry : undefined;
              const value = ratio != null && isFinite(ratio) ? ratio.toFixed(2) : '—';
              let style: React.CSSProperties | undefined;
              if (ratio != null && isFinite(ratio)) {
                if (ratio <= 1.5) style = { color: 'var(--gain)' };
                else if (ratio <= 1.7) style = { color: '#fbbf24' };
                else if (ratio <= 2) style = { color: '#f97316' };
                else style = { color: 'var(--loss)' };
              }
              return <span style={style}>{value}</span>;
            })()}</div></div>
            <div>
              <div className="muted">PnL ($){useExecPnl && <span style={{marginLeft:4, fontSize:'0.75em'}}>exec</span>}</div>
              <div>
                {(() => {
                  if (!Number.isFinite(netPnlValue)) return '—';
                  const color = netPnlValue > 0 ? 'var(--gain)' : (netPnlValue < 0 ? 'var(--loss)' : undefined);
                  return <span style={color ? { color } : undefined}>{netPnlValue.toFixed(2)}</span>;
                })()}
              </div>
            </div>
            {/* Greeks after net figures */}
            <div><div className="muted">Δ (Delta)</div><div>{calc.greeks.delta.toFixed(3)}</div></div>
            <div><div className="muted">Vega</div><div>{calc.greeks.vega.toFixed(3)}</div></div>
            <div><div className="muted">Θ (Theta)</div><div>{calc.greeks.theta.toFixed(3)}</div></div>
          </div>

          <div className="grid" style={{gap: 6}}>
                {legs.map((L, legIndex) => {
              const t = tickers[L.leg.symbol] || {};
              const { bid, ask } = bestBidAsk(t);
              const bidNumRaw = bid != null && isFinite(Number(bid)) ? Number(bid) : undefined;
              const askNumRaw = ask != null && isFinite(Number(ask)) ? Number(ask) : undefined;
              const symbol = String(L.leg.symbol || '');
              const expiryMs = Number(L.leg.expiryMs) || 0;
              const isPerp = !symbol.includes('-') || expiryMs <= 0;
              const midRaw = midPrice(t);
              const exitPxRaw = Number((L as any)?.exitPrice);
              const exitPrice = Number.isFinite(exitPxRaw) ? exitPxRaw : undefined;
              const exitedAtRaw = Number((L as any)?.exitedAt);
              const exitedAt = Number.isFinite(exitedAtRaw) ? exitedAtRaw : undefined;
              const isExited = exitPrice != null;
              const midMarket = midRaw != null && isFinite(Number(midRaw)) ? Number(midRaw) : undefined;
              const mid = isExited ? exitPrice : midMarket;
              const iv = isExited ? undefined : (t?.markIv != null ? Number(t.markIv) : undefined);
              const dRaw = isExited ? 0 : (t?.delta != null ? Number(t.delta) : (isPerp ? 1 : undefined));
              const vRaw = isExited ? 0 : (t?.vega != null ? Number(t.vega) : undefined);
              const thRaw = isExited ? 0 : (t?.theta != null ? Number(t.theta) : undefined);
              const qty = Number(L.qty) || 1;
              const entry = Number(L.entryPrice);
              const isShort = L.side === 'short';
              const midSafe = (mid != null && isFinite(mid)) ? mid : (isFinite(entry) ? entry : 0);
              const execPrice = isExited ? exitPrice : (isShort ? (askNumRaw ?? midSafe) : (bidNumRaw ?? midSafe));
              const execSafe = (execPrice != null && isFinite(execPrice)) ? execPrice : midSafe;
              const pnlMid = (isFinite(entry) ? (isShort ? (entry - midSafe) : (midSafe - entry)) * qty : undefined);
              const pnlExec = (isFinite(entry) ? (isShort ? (entry - execSafe) : (execSafe - entry)) * qty : undefined);
              const sgn = L.side === 'long' ? 1 : -1;
              const usdNotional = isPerp && isFinite(qty) ? qty * (midSafe ?? entry ?? 0) : undefined;
              const bidNum = isExited ? undefined : bidNumRaw;
              const askNum = isExited ? undefined : askNumRaw;
              const x = {
                L,
                bid: bidNum,
                ask: askNum,
                mid: midSafe,
                pnlMid,
                pnlExec,
                iv,
                d: dRaw != null ? sgn * dRaw : undefined,
                v: vRaw != null ? sgn * vRaw : undefined,
                th: thRaw != null ? sgn * thRaw : undefined,
                oi: isExited ? undefined : (t?.openInterest != null ? Number(t.openInterest) : undefined),
                exitPrice,
                exitedAt,
                isExited,
              };
              const legId = legKey(L, legIndex);
              const isHidden = (resolvedHiddenLegIds || []).includes(legId);
              const exitTooltip = isExited && exitPrice != null
                ? `Exited at ${exitPrice.toFixed(4)}${exitedAt ? ` · ${new Date(exitedAt).toLocaleString()}` : ''}`
                : 'Exit only this leg (sell/buy back)';
              return (
              <div key={legId} style={{border: '1px solid var(--border)', borderRadius: 8, padding: 6, fontSize: 'calc(1em - 3px)', ...(isHidden ? { background: 'rgba(128,128,128,.12)' } : {})}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 2}}>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    {onToggleLegHidden && (
                      <button type="button" className="ghost" style={{height: 22, lineHeight: '22px', padding: '0 8px', cursor:'pointer', position:'relative', zIndex:2}} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleLegHidden?.(legId, legIndex); }}>
                          {isHidden ? 'Unhide' : 'Hide'}
                      </button>
                    )}
                    <div style={{fontSize:'calc(1em + 2px)'}}><strong>{L.side}</strong> {L.leg.optionType} {L.leg.strike} × {L.qty}{isPerp && usdNotional != null && isFinite(usdNotional) ? ` ($${usdNotional.toFixed(0)})` : ''}</div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <div className="muted" style={{fontSize:'calc(1em + 2px)'}}>{Number(L.leg.expiryMs) > 0 ? new Date(Number(L.leg.expiryMs)).toISOString().slice(0,10) : ''}</div>
                    {onExitLeg && (
                      <button
                        type="button"
                        className="ghost"
                        title={exitTooltip}
                        style={{
                          height: 22,
                          lineHeight: '22px',
                          padding: '0 8px',
                          cursor: isExited ? 'not-allowed' : 'pointer',
                          color: isExited ? '#9ba0a6' : undefined,
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isExited) return;
                          onExitLeg(legIndex);
                        }}
                        disabled={isExited}
                      >{isExited ? 'Exited' : 'Exit'}</button>
                    )}
                    {onDeleteLeg && (
                      <button
                        type="button"
                        className="ghost"
                        style={{height: 22, lineHeight: '22px', padding: '0 8px', cursor:'pointer'}}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDeleteLeg(legIndex);
                        }}
                  >Del</button>
                    )}
                  </div>
                </div>
                {isExited && (
                  <div className="muted" style={{ fontSize: 'calc(1em - 3px)', marginTop: 6, marginBottom: 8 }}>
                    Exited @ {exitPrice?.toFixed(4)}{exitedAt ? ` · ${new Date(exitedAt).toLocaleString()}` : ''}
                  </div>
                )}
                {/* Grid 6x4; first column: row 1 label, rows 2-4 merged value centered */}
                <div className="grid" style={{gridTemplateColumns:'2fr repeat(5, minmax(0,1fr))', gridTemplateRows:'repeat(4, auto)', gap: 6, marginTop: 6}}>
                  {/* First column header (row 1) */}
                  <div style={{gridColumn:1, gridRow:1}} className="muted">Symbol</div>
                  {/* First column value spans rows 2-4 and is vertically centered */}
                  <div style={{gridColumn:1, gridRow:'2 / span 3', paddingRight:12, display:'flex', alignItems:'center'}}>
                    <div title={L.leg.symbol} style={{display:'flex', alignItems:'center', flexWrap:'wrap', gap:6}}>
                      <span style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word', fontSize:'1em'}}>{L.leg.symbol}</span>
                      {(() => {
                    const label = formatCreatedAtLabel(L.createdAt ?? positionCreatedAt);
                        return label ? (
                          <span style={{ color: '#9c9c9c', fontSize: 'calc(1em - 2px)' }}>{label}</span>
                        ) : null;
                      })()}
                    </div>
                  </div>
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
                  <div style={{gridColumn:2, gridRow:2}}>{bidNum != null ? bidNum.toFixed(2) : '—'} / {askNum != null ? askNum.toFixed(2) : '—'}</div>
                  <div style={{gridColumn:3, gridRow:2}}>{mid != null ? mid.toFixed(2) : '—'}</div>
                  <div style={{gridColumn:4, gridRow:2}}>{isFinite(L.entryPrice) ? `$${L.entryPrice.toFixed(2)}` : '—'}</div>
                  <div style={{gridColumn:5, gridRow:2}}>{(() => {
                    const value = useExecPnl ? x.pnlExec : x.pnlMid;
                    if (!(value != null && isFinite(value))) return '—';
                    const color = value > 0 ? 'var(--gain)' : (value < 0 ? 'var(--loss)' : undefined);
                    return <span style={color ? { color } : undefined}>{value.toFixed(2)}</span>;
                  })()}</div>
                  <div style={{gridColumn:6, gridRow:2}}>{(() => {
                    const t = tickers[L.leg.symbol] || {};
                    const markIv = t?.markIv != null ? Number(t.markIv) : (iv != null ? Number(iv) : undefined);
                    if (markIv != null && isFinite(markIv)) return markIv.toFixed(1);
                    const S = t?.indexPrice != null ? Number(t.indexPrice) : (calc.spot != null ? Number(calc.spot) : undefined);
                    const K = Number(L.leg.strike) || 0;
                    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
                    const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
                    if (S != null && isFinite(S) && K > 0 && T > 0 && markPrice != null && isFinite(markPrice) && markPrice >= 0) {
                      const iv = bsImpliedVol(L.leg.optionType, S, K, T, markPrice, rPct / 100);
                      if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
                    }
                    let ivFromBook: number | undefined;
                    if (S != null && isFinite(S) && K > 0 && T > 0) {
                      const ivBid = (bidNum != null && isFinite(bidNum) && bidNum >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, bidNum, rPct / 100) : undefined;
                      const ivAsk = (askNum != null && isFinite(askNum) && askNum >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, askNum, rPct / 100) : undefined;
                      if (ivBid != null && isFinite(ivBid) && ivAsk != null && isFinite(ivAsk)) ivFromBook = 0.5 * (ivBid + ivAsk);
                      else if (ivBid != null && isFinite(ivBid)) ivFromBook = ivBid;
                      else if (ivAsk != null && isFinite(ivAsk)) ivFromBook = ivAsk;
                    }
                    if (ivFromBook != null && isFinite(ivFromBook)) return (ivFromBook * 100).toFixed(1);
                    const mid2 = mid != null ? Number(mid) : undefined;
                    if (S != null && isFinite(S) && K > 0 && T > 0 && mid2 != null && isFinite(mid2) && mid2 >= 0) {
                      const iv = bsImpliedVol(L.leg.optionType, S, K, T, mid2, rPct / 100);
                      if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
                    }
                    const v = hv30;
                    return v != null && isFinite(v) ? Number(v).toFixed(1) : '—';
                  })()}</div>
                  {/* Row 4: values for second line */}
                  <div style={{gridColumn:2, gridRow:4}}>{x.v != null ? x.v.toFixed(3) : '—'}</div>
                  <div style={{gridColumn:3, gridRow:4}}>{x.d != null ? x.d.toFixed(3) : '—'}</div>
                  <div style={{gridColumn:4, gridRow:4}}>{x.th != null ? x.th.toFixed(3) : '—'}</div>
                  <div style={{gridColumn:5, gridRow:4}}>{x.oi != null ? x.oi : '—'}</div>
                  <div style={{gridColumn:6, gridRow:4}}>{(() => {
                    const t = tickers[L.leg.symbol] || {};
                    const S = t?.indexPrice != null ? Number(t.indexPrice) : (calc.spot != null ? Number(calc.spot) : undefined);
                    const K = Number(L.leg.strike) || 0;
                    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
                    if (!(S != null && isFinite(S) && K > 0 && T > 0)) return '—';
                    const mid3 = mid != null ? Number(mid) : undefined;
                    const ivMid = (mid3 != null && isFinite(mid3) && mid3 >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, mid3, rPct / 100) : undefined;
                    const markIvPct = t?.markIv != null ? Number(t.markIv) : undefined;
                    const sigmaFromMarkIv = (markIvPct != null && isFinite(markIvPct)) ? (markIvPct / 100) : undefined;
                    const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
                    const sigmaFromMarkPrice = (markPrice != null && isFinite(markPrice) && markPrice >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, markPrice, rPct / 100) : undefined;
                    let sigmaFromBook: number | undefined;
                    {
                      const ivBid = (bidNum != null && isFinite(bidNum) && bidNum >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, bidNum, rPct / 100) : undefined;
                      const ivAsk = (askNum != null && isFinite(askNum) && askNum >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, askNum, rPct / 100) : undefined;
                      if (ivBid != null && isFinite(ivBid) && ivAsk != null && isFinite(ivAsk)) sigmaFromBook = 0.5 * (ivBid + ivAsk);
                      else if (ivBid != null && isFinite(ivBid)) sigmaFromBook = ivBid;
                      else if (ivAsk != null && isFinite(ivAsk)) sigmaFromBook = ivAsk;
                    }
                    const sigmaFromHV = (hv30 != null && isFinite(hv30)) ? (Number(hv30) / 100) : undefined;
                    const sigmaRef = sigmaFromMarkIv ?? sigmaFromMarkPrice ?? sigmaFromBook ?? sigmaFromHV;
                    if (!(ivMid != null && isFinite(ivMid) && sigmaRef != null && isFinite(sigmaRef))) return '—';
                    const dSigmaPp = (ivMid - sigmaRef) * 100;
                    const badge = dSigmaPp >= 1 ? '↑' : (dSigmaPp <= -1 ? '↓' : '–');
                    return `${dSigmaPp.toFixed(1)} [${badge}]`;
                  })()}</div>
                </div>
              </div>
            ); })}
          </div>

          {/* Export buttons removed */}
        </div>
        <div style={{ margin: '8px 12px 12px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div className="muted" style={{ fontSize: '0.85em' }}>Notes</div>
            <button
              type="button"
              className="ghost"
              onClick={() => setEditingNote((v) => !v)}
              style={{ padding: '2px 8px', fontSize: '0.8em' }}
            >
              {editingNote ? 'Cancel' : (hasNote ? 'Edit note' : 'Add note')}
            </button>
            {hasNote && !editingNote && (
              <button
                type="button"
                className="ghost"
                onClick={clearNote}
                style={{ padding: '2px 8px', fontSize: '0.8em' }}
              >
                Clear
              </button>
            )}
          </div>
          {editingNote ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={4}
                style={{
                  resize: 'vertical',
                  fontSize: 'calc(1em - 2px)',
                  fontFamily: 'inherit',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--fg)',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="primary" onClick={saveNote}>Save</button>
                <button type="button" className="ghost" onClick={() => { setEditingNote(false); setNoteDraft(noteValue); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 'calc(1em - 2px)',
                border: hasNote ? '1px solid var(--border)' : '1px dashed rgba(128,128,128,0.4)',
                borderRadius: 6,
                padding: '8px 12px',
                color: hasNote ? 'inherit' : 'rgba(200,200,200,0.6)',
              }}
            >
              {hasNote ? noteValue.trim() : '—'}
            </div>
          )}
        </div>
      </div>
  );

  if (isSummary) {
    return (
      <div style={{ padding: '12px 0 24px' }}>
        {card}
      </div>
    );
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:70}}>
      {card}
    </div>
  );
}
