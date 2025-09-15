import React from 'react';
import { useStore } from '../store/store';
import { subscribeOptionTicker, subscribeSpotTicker } from '../services/ws';
import { midPrice, bestBidAsk, fetchOptionTickers, fetchHV30, fetchOrderbookL1 } from '../services/bybit';
import { bsImpliedVol } from '../utils/bs';
import type { Position, PositionLeg, SpreadPosition } from '../utils/types';
import { downloadCSV, toCSV } from '../utils/csv';
import { PositionView } from './PositionView';
import { EditPositionModal } from './EditPositionModal';
import { IfModal, IfRule } from './IfModal';

type Row = {
  id: string;
  kind: 'vertical' | 'multi';
  legs: PositionLeg[];
  createdAt: number;
  closedAt?: number;
  note?: string;
  // vertical extras
  cEnter?: number; // per contract
  qty?: number;
  favorite?: boolean;
};

function fromSpread(s: SpreadPosition): Row {
  // Derive per-leg entries with sensible fallbacks preserving net = cEnter
  const entryShort = s.entryShort != null
    ? s.entryShort
    : (s.entryLong != null ? s.cEnter + s.entryLong : s.cEnter);
  const entryLong = s.entryLong != null
    ? s.entryLong
    : (s.entryShort != null ? s.entryShort - s.cEnter : 0);
  return {
    id: 'S:' + s.id,
    kind: 'vertical',
    legs: [
      { leg: s.short, side: 'short', qty: s.qty ?? 1, entryPrice: entryShort },
      { leg: s.long,  side: 'long',  qty: s.qty ?? 1, entryPrice: entryLong },
    ],
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    note: s.note,
    cEnter: s.cEnter,
    qty: s.qty ?? 1,
    favorite: s.favorite,
  };
}

function fromPosition(p: Position): Row {
  return {
    id: 'P:' + p.id,
    kind: 'multi',
    legs: p.legs,
    createdAt: p.createdAt,
    closedAt: p.closedAt,
    note: p.note,
    favorite: p.favorite,
  };
}

export function UnifiedPositionsTable() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const markClosed = useStore((s) => s.markClosed);
  const closePosition = useStore((s) => s.closePosition);
  const removeSpread = useStore((s) => s.remove);
  const removePosition = useStore((s) => s.removePosition);
  const updatePosition = useStore((s) => s.updatePosition);
  const addPosition = useStore((s) => s.addPosition);
  const toggleFavoriteSpread = useStore((s) => s.toggleFavoriteSpread);
  const toggleFavoritePosition = useStore((s) => s.toggleFavoritePosition);
  const [showClosed, setShowClosed] = React.useState(false);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [view, setView] = React.useState<Row | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [tab, setTab] = React.useState<'all'|'fav'>('all');
  const [sortKey, setSortKey] = React.useState<'date'|'pnl'|'theta'|'expiry'>('date');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('desc');
  const [hv30, setHv30] = React.useState<number | undefined>();
  const [rPct, setRPct] = React.useState(0);
  const [ifRow, setIfRow] = React.useState<Row | null>(null);
  const [ifRules, setIfRules] = React.useState<Record<string, IfRule>>(() => {
    try { const raw = localStorage.getItem('if-rules-v1'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  // Real spot for IF-only calculations
  const [ifSpot, setIfSpot] = React.useState<number | undefined>();

  // Load persisted UI prefs
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('positions-ui-v1');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s?.tab === 'all' || s?.tab === 'fav') setTab(s.tab);
      if (s?.sortKey === 'date' || s?.sortKey === 'pnl' || s?.sortKey === 'theta' || s?.sortKey === 'expiry') setSortKey(s.sortKey);
      if (s?.sortDir === 'asc' || s?.sortDir === 'desc') setSortDir(s.sortDir);
      if (typeof s?.showClosed === 'boolean') setShowClosed(s.showClosed);
    } catch {}
  }, []);

  // Persist UI prefs
  React.useEffect(() => {
    const payload = { tab, sortKey, sortDir, showClosed };
    try { localStorage.setItem('positions-ui-v1', JSON.stringify(payload)); } catch {}
  }, [tab, sortKey, sortDir, showClosed]);

  // Gamma removed from tables

  const rows: Row[] = React.useMemo(() => {
    const list = [
      ...spreads.map(fromSpread),
      ...positions.map(fromPosition),
    ].filter(r => (showClosed ? true : !r.closedAt));
    // Optional filter by favorites
    const filtered = tab === 'fav' ? list.filter(r => !!r.favorite) : list;
    // Base order; actual sort by metrics is applied at render time when calc() is available.
    return filtered;
  }, [spreads, positions, showClosed, tab]);

  React.useEffect(() => {
    const symbols = new Set<string>();
    rows.forEach(r => r.legs.forEach(l => symbols.add(l.leg.symbol)));
    const unsubs = Array.from(symbols).slice(0, 1000).map(sym => {
      const isOption = sym.includes('-');
      const sub = isOption ? subscribeOptionTicker : subscribeSpotTicker;
      return sub(sym, (t) => setTickers(prev => {
        const cur = prev[t.symbol] || {};
        // merge without overwriting existing values with undefined/null
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
  }, [rows]);

  // Fetch HV30 once for Δσ (Vol) reference in expanded legs view
  React.useEffect(() => {
    let mounted = true;
    fetchHV30().then(v => { if (mounted) setHv30(v); }).catch(()=>{});
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
    try { localStorage.setItem('if-rules-v1', JSON.stringify(ifRules)); } catch {}
  }, [ifRules]);

  // Helpers to compute per-leg metrics consistent with View
  const computeSpotForRow = (r: Row): number | undefined => {
    // Prefer real spot for IF, fallback to any leg's indexPrice
    if (ifSpot != null && isFinite(ifSpot)) return ifSpot;
    for (const L of r.legs) {
      const t = tickers[L.leg.symbol] || {};
      if (t?.indexPrice != null && isFinite(Number(t.indexPrice))) return Number(t.indexPrice);
    }
    return undefined;
  };
  const ivPctForLeg = (L: PositionLeg, r: Row): number | undefined => {
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
    const v = hv30;
    return (v != null && isFinite(v)) ? Number(v) : undefined;
  };
  const dSigmaForLeg = (L: PositionLeg, r: Row): number | undefined => {
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
    const sigmaFromHV = (hv30 != null && isFinite(hv30)) ? (Number(hv30) / 100) : undefined;
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

  // Evaluate a single condition live for IF modal preview
  const evalSingleCondLive = (r: Row, args: { scope: 'position'|'leg'; legSymbol?: string; cond: { param: string; cmp: any; value: number } }): boolean => {
    const { scope, legSymbol, cond } = args;
    if (scope === 'position') {
      const c = calc(r);
      const spot = computeSpotForRow(r);
      const valOf = (p: string): number | undefined => {
        switch (p) {
          case 'spot': return spot;
          case 'netEntry': return c.netEntry;
          case 'netMid': return c.netMid;
          case 'pnl': return c.pnl;
          case 'pnlPctMax': {
            const mp = maxProfitForRow(r, c);
            if (!(mp != null && isFinite(mp) && mp > 0)) return undefined;
            return (c.pnl / mp) * 100;
          }
          case 'delta': return c.greeks.delta;
          case 'vega': return c.greeks.vega;
          case 'theta': return c.greeks.theta;
          case 'dte': return c.dte ?? undefined;
          default: return undefined;
        }
      };
      return evalCond(valOf(cond.param), cond.cmp, Number(cond.value));
    } else {
      const legs = r.legs.filter(L => !legSymbol || L.leg.symbol === legSymbol);
      for (const L of legs) {
        const t = tickers[L.leg.symbol] || {};
        const { bid, ask } = bestBidAsk(t);
        const mid = midPrice(t);
        const ivp = ivPctForLeg(L, r);
        const d = t?.delta != null ? (L.side === 'long' ? Number(t.delta) : -Number(t.delta)) : undefined;
        const v = t?.vega != null ? (L.side === 'long' ? Number(t.vega) : -Number(t.vega)) : undefined;
        const th = t?.theta != null ? (L.side === 'long' ? Number(t.theta) : -Number(t.theta)) : undefined;
        const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
        const ds = dSigmaForLeg(L, r);
        const spot = computeSpotForRow(r);
        const pnlLeg = (() => {
          const entry = Number(L.entryPrice);
          const m = mid;
          const qty = Number(L.qty) || 1;
          const sgn2 = L.side === 'short' ? 1 : -1;
          return (isFinite(entry) && m != null && isFinite(m)) ? sgn2 * (entry - m) * qty : undefined;
        })();
        const valOf = (p: string): number | undefined => {
          switch (p) {
            case 'spot': return spot;
            case 'bid': return bid; case 'ask': return ask; case 'mid': return mid; case 'entry': return Number(L.entryPrice);
            case 'pnlLeg': return pnlLeg;
            case 'ivPct': return ivp;
            case 'vega': return v; case 'delta': return d; case 'theta': return th; case 'oi': return oi;
            case 'dSigma': return ds;
            default: return undefined;
          }
        };
        if (evalCond(valOf(cond.param), cond.cmp, Number(cond.value))) return true;
      }
      return false;
    }
  };

  const evalCond = (lhs: number | undefined, cmp: '>' | '<' | '=' | '>=' | '<=', rhs: number): boolean => {
    if (!(lhs != null && isFinite(lhs))) return false;
    if (cmp === '>') return lhs > rhs;
    if (cmp === '<') return lhs < rhs;
    if (cmp === '>=') return lhs >= rhs;
    if (cmp === '<=') return lhs <= rhs;
    return Math.abs(lhs - rhs) < 1e-9;
  };
  const evalChainLeg = (r: Row, c: any, chain: { legSymbol?: string; conds: Array<{ conj?: 'AND'|'OR'; cond: { param: string; cmp: any; value: number } }> }) => {
    const matchedSyms = new Set<string>();
    // Evaluate against target legs (all or specific);
    const iterLegs = r.legs.filter(L => !chain.legSymbol || L.leg.symbol === chain.legSymbol);
    for (const L of iterLegs) {
      const t = tickers[L.leg.symbol] || {};
      const { bid, ask } = bestBidAsk(t);
      const mid = midPrice(t);
      const ivp = ivPctForLeg(L, r);
      const d = t?.delta != null ? (L.side === 'long' ? Number(t.delta) : -Number(t.delta)) : undefined;
      const v = t?.vega != null ? (L.side === 'long' ? Number(t.vega) : -Number(t.vega)) : undefined;
      const th = t?.theta != null ? (L.side === 'long' ? Number(t.theta) : -Number(t.theta)) : undefined;
      const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
      const ds = dSigmaForLeg(L, r);
      const spot = computeSpotForRow(r);
      const pnlLeg = (() => {
        const entry = Number(L.entryPrice);
        const m = mid;
        const qty = Number(L.qty) || 1;
        const sgn2 = L.side === 'short' ? 1 : -1;
        return (isFinite(entry) && m != null && isFinite(m)) ? sgn2 * (entry - m) * qty : undefined;
      })();
      const valOf = (p: string): number | undefined => {
        switch (p) {
          case 'spot': return spot;
          case 'bid': return bid; case 'ask': return ask; case 'mid': return mid; case 'entry': return Number(L.entryPrice);
          case 'pnlLeg': return pnlLeg;
          case 'ivPct': return ivp;
          case 'vega': return v; case 'delta': return d; case 'theta': return th; case 'oi': return oi;
          case 'dSigma': return ds;
          default: return undefined;
        }
      };
      let ok: boolean | undefined = undefined;
      for (let i = 0; i < chain.conds.length; i++) {
        const it = chain.conds[i];
        const cur = evalCond(valOf(it.cond.param), it.cond.cmp, Number(it.cond.value));
        if (i === 0) ok = cur; else ok = (it.conj === 'OR') ? ((ok as boolean) || cur) : ((ok as boolean) && cur);
      }
      if (ok) matchedSyms.add(L.leg.symbol);
    }
    return matchedSyms;
  };
  const evalChainPos = (r: Row, c: any, chain: { conds: Array<{ conj?: 'AND'|'OR'; cond: { param: string; cmp: any; value: number } }> }) => {
    const spot = computeSpotForRow(r);
      const valOf = (p: string): number | undefined => {
        switch (p) {
          case 'spot': return spot;
          case 'netEntry': return c.netEntry;
          case 'netMid': return c.netMid;
          case 'pnl': return c.pnl;
          case 'pnlPctMax': {
            const mp = maxProfitForRow(r, c);
            if (!(mp != null && isFinite(mp) && mp > 0)) return undefined;
            return (c.pnl / mp) * 100;
          }
          case 'delta': return c.greeks.delta;
          case 'vega': return c.greeks.vega;
          case 'theta': return c.greeks.theta;
          case 'dte': return c.dte ?? undefined;
          default: return undefined;
        }
      };
    let ok: boolean | undefined = undefined;
    for (let i = 0; i < chain.conds.length; i++) {
      const it = chain.conds[i];
      const cur = evalCond(valOf(it.cond.param), it.cond.cmp, Number(it.cond.value));
      if (i === 0) ok = cur; else ok = (it.conj === 'OR') ? ((ok as boolean) || cur) : ((ok as boolean) && cur);
    }
    return !!ok;
  };
  const evalRule = (r: Row, c: any, rule?: IfRule): { matched: boolean; matchedLegs?: Set<string> } => {
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
  const matchedLegsOnly = (r: Row, c: any, rule?: IfRule): Set<string> => {
    const out = new Set<string>();
    if (!rule || !rule.chains.length) return out;
    const legChains = rule.chains.filter(w => w.chain.scope === 'leg');
    if (!legChains.length) return out;
    for (const L of r.legs) {
      // Only consider chains that target this symbol or any
      const relevant = legChains.filter(w => !w.chain.legSymbol || w.chain.legSymbol === L.leg.symbol);
      if (!relevant.length) continue;
      let agg: boolean | undefined = undefined;
      for (let i = 0; i < relevant.length; i++) {
        const wrap = relevant[i];
        const ch = wrap.chain;
        // evaluate this leg against chain conds
        const t = tickers[L.leg.symbol] || {};
        const { bid, ask } = bestBidAsk(t);
        const mid = midPrice(t);
        const ivp = ivPctForLeg(L, r);
        const d = t?.delta != null ? (L.side === 'long' ? Number(t.delta) : -Number(t.delta)) : undefined;
        const v = t?.vega != null ? (L.side === 'long' ? Number(t.vega) : -Number(t.vega)) : undefined;
        const th = t?.theta != null ? (L.side === 'long' ? Number(t.theta) : -Number(t.theta)) : undefined;
        const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
        const ds = dSigmaForLeg(L, r);
        const spot = computeSpotForRow(r);
        const pnlLeg = (() => {
          const entry = Number(L.entryPrice);
          const m = mid;
          const qty = Number(L.qty) || 1;
          const sgn2 = L.side === 'short' ? 1 : -1;
          return (isFinite(entry) && m != null && isFinite(m)) ? sgn2 * (entry - m) * qty : undefined;
        })();
        const valOf = (p: string): number | undefined => {
          switch (p) {
            case 'spot': return spot;
            case 'bid': return bid; case 'ask': return ask; case 'mid': return mid; case 'entry': return Number(L.entryPrice);
            case 'pnlLeg': return pnlLeg;
            case 'ivPct': return ivp;
            case 'vega': return v; case 'delta': return d; case 'theta': return th; case 'oi': return oi;
            case 'dSigma': return ds;
            default: return undefined;
          }
        };
        let cur: boolean | undefined = undefined;
        for (let j = 0; j < ch.conds.length; j++) {
          const it = ch.conds[j];
          const here = evalCond(valOf(it.cond.param), it.cond.cmp, Number(it.cond.value));
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
            // Backfill missing fields (iv/greeks/oi/mark) from REST without clobbering existing values
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
  }, [rows]);

  // REST L1 fallback for stubborn symbols (polls small set of visible legs)
  React.useEffect(() => {
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
  }, [rows]);

  const calc = (r: Row) => {
    // Per-leg live mid and greeks (ignore hidden legs)
    const legs = r.legs.filter(L => !L.hidden).map((L) => {
      const t = tickers[L.leg.symbol] || {};
      const mid = midPrice(t) ?? 0;
      const greeks = {
        delta: t?.delta != null ? Number(t.delta) : 0,
        gamma: t?.gamma != null ? Number(t.gamma) : 0,
        vega: t?.vega != null ? Number(t.vega) : 0,
        theta: t?.theta != null ? Number(t.theta) : 0,
      };
      const { bid, ask } = bestBidAsk(t);
      const spread = bid != null && ask != null && bid > 0 && ask > 0 ? Math.max(0, ask - bid) : undefined;
      const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
      return { ...L, mid, greeks, bid, ask, spread, oi };
    });
    const netEntry = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * L.entryPrice * L.qty, 0);
    const netMid = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * L.mid * L.qty, 0);
    const pnl = netEntry - netMid;
    const g = legs.reduce((a, L) => {
      const s = L.side === 'long' ? 1 : -1;
      return {
        delta: a.delta + s * L.greeks.delta * L.qty,
        gamma: a.gamma + s * L.greeks.gamma * L.qty,
        vega: a.vega + s * L.greeks.vega * L.qty,
        theta: a.theta + s * L.greeks.theta * L.qty,
      };
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
    const spreads = legs.map(L => L.spread).filter((v): v is number => v != null && Number.isFinite(v));
    const ois = legs.map(L => L.oi).filter((v): v is number => v != null && Number.isFinite(v));
    const spreadPcts = legs
      .map(L => (L.spread != null && Number.isFinite(L.spread) && L.mid > 0) ? (L.spread / L.mid) * 100 : undefined)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const liq = {
      maxSpread: spreads.length ? Math.max(...spreads) : undefined,
      minOI: ois.length ? Math.min(...ois) : undefined,
      maxSpreadPct: spreadPcts.length ? Math.max(...spreadPcts) : undefined,
    } as { maxSpread?: number; minOI?: number; maxSpreadPct?: number };

    // Vertical extras and nearest DTE (works for any position)
    let width: number | undefined;
    let maxLoss: number | undefined;
    let dte: number | undefined;
    const expSet = Array.from(new Set(legs.map(L => Number(L.leg.expiryMs)).filter(ms => Number.isFinite(ms) && ms > 0)));
    if (expSet.length >= 1) {
      const nearest = Math.min(...expSet);
      dte = Math.max(0, Math.round((nearest - Date.now()) / (1000 * 60 * 60 * 24)));
    }
    if (r.kind === 'vertical' && expSet.length === 1) {
      const strikes = legs.map(L => L.leg.strike);
      width = Math.abs(strikes[0] - strikes[1]);
      maxLoss = Math.max(0, (width - (r.cEnter ?? 0)) * (r.qty ?? 1));
    }

    return { legs, netEntry, netMid, pnl, greeks: g, liq, width, maxLoss, dte };
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

  const onCloseRow = (r: Row) => {
    if (r.id.startsWith('S:')) markClosed(r.id.slice(2)); else closePosition(r.id.slice(2));
  };
  const onDeleteRow = (r: Row) => {
    if (r.id.startsWith('S:')) removeSpread(r.id.slice(2)); else removePosition(r.id.slice(2));
  };

  return (
    <div>
      <h3>My Positions</h3>
      <div style={{display:'flex', gap: 12, alignItems:'center', marginBottom: 6}}>
        <label style={{display:'flex', gap:6, alignItems:'center'}}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span className="muted">Show closed</span>
        </label>
        <button className="ghost" onClick={exportCSV}>Export CSV</button>
        <div style={{display:'flex', gap:6, marginLeft: 'auto'}}>
          <button className={tab==='all' ? 'primary' : 'ghost'} onClick={() => setTab('all')}>All</button>
          <button className={tab==='fav' ? 'primary' : 'ghost'} onClick={() => setTab('fav')}>Favorites</button>
        </div>
        <div style={{display:'flex', gap:6}}>
          <span className="muted">Sort:</span>
          <button className={sortKey==='date' ? 'primary' : 'ghost'} onClick={() => setSortKey('date')}>Date</button>
          <button className={sortKey==='pnl' ? 'primary' : 'ghost'} onClick={() => setSortKey('pnl')}>PnL</button>
          <button className={sortKey==='theta' ? 'primary' : 'ghost'} onClick={() => setSortKey('theta')}>Theta</button>
          <button className={sortKey==='expiry' ? 'primary' : 'ghost'} onClick={() => { setSortKey('expiry'); setSortDir('asc'); }}>Expiry</button>
          <button className="ghost" title={sortDir==='desc' ? 'Descending' : 'Ascending'} onClick={() => setSortDir(d => d==='desc'?'asc':'desc')}>{sortDir==='desc' ? '↓' : '↑'}</button>
        </div>
      </div>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Legs</th>
              <th>Expiry / DTE</th>
              <th>Net entry</th>
              <th>Net mid</th>
              <th>PnL ($)</th>
              <th>Δ</th>
              <th>Vega</th>
              <th>Θ ($/day)</th>
              <th>Liquidity</th>
              <th>Actions</th>
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
                if (sortKey === 'pnl') return sgn * ((B.c.pnl || 0) - (A.c.pnl || 0));
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
              return (
                <>
                  <tr key={r.id} style={evalRes.matched ? { background:'rgba(64,64,64,.30)' } : undefined}>
                    <td style={r.favorite ? { borderLeft: '3px solid rgba(255, 215, 0, 0.5)', paddingLeft: 6 } : undefined}>
                      {typeLabel}
                      {r.closedAt && (
                        <span style={{ marginLeft: 8, background: 'rgba(128,128,128,.18)', color: '#7a7a7a', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>closed</span>
                      )}
                      {r.legs.some(L => L.hidden) && (() => {
                        const hiddenCount = r.legs.reduce((acc, L) => acc + (L.hidden ? 1 : 0), 0);
                        return (
                          <span style={{ marginLeft: 6, background: 'rgba(128,128,128,.18)', color: '#7a7a7a', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>hidden ×{hiddenCount}</span>
                        );
                      })()}
                      {(!!ifRules[r.id]?.chains?.length) && (
                        <span style={{ marginLeft: 6, background: 'rgba(160,120,60,.18)', color: '#8B4513', padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)' }}>IF</span>
                      )}
                    </td>
                    <td style={{fontSize: 'calc(1em - 1.5px)'}}>
                      {r.legs.map((L, i) => {
                        const isPerp = !String(L.leg.symbol).includes('-');
                        return (
                          <div key={i} className="muted">{L.side} {isPerp ? 'PERP' : L.leg.optionType} {isPerp ? '' : L.leg.strike} × {L.qty}</div>
                        );
                      })}
                    </td>
                    <td>{expLabel} · {dte}</td>
                    <td>{c.netEntry.toFixed(2)}</td>
                    <td>{c.netMid.toFixed(2)}</td>
                    <td>{c.pnl.toFixed(2)}</td>
                    <td>{c.greeks.delta.toFixed(3)}</td>
                    <td>{c.greeks.vega.toFixed(3)}</td>
                    <td>{c.greeks.theta.toFixed(3)}</td>
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
                    <td>
                      <div style={{display:'flex', flexDirection:'column', gap:4}}>
                        <div style={{display:'flex', alignItems:'center', gap:6}}>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 6px', fontSize: 18}} title={r.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => {
                            if (r.id.startsWith('S:')) toggleFavoriteSpread(r.id.slice(2));
                            else toggleFavoritePosition(r.id.slice(2));
                          }}>{r.favorite ? '★' : '☆'}</button>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 6px', fontSize: 28}} title={expanded[r.id] ? 'Hide legs' : 'Show legs'} onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>{expanded[r.id] ? '▴' : '▾'}</button>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} onClick={() => setView(r)}>View</button>
                          <button className="ghost" onClick={() => {
                            if (r.kind === 'multi') {
                              setEditId(r.id.slice(2));
                            } else {
                              // Convert vertical row into editable multi-leg position
                              try {
                                addPosition({ legs: r.legs, note: r.note });
                                const latest = useStore.getState().positions?.[0]?.id;
                                // Remove original spread so item becomes editable multi-leg entry
                                removeSpread(r.id.slice(2));
                                if (latest) setEditId(latest);
                              } catch {}
                            }
                          }} style={{height: 28, lineHeight: '28px', padding: '0 10px'}}>Edit</button>
                        </div>
                        <div style={{display:'flex', alignItems:'center', gap:6}}>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} title="IF" onClick={() => setIfRow(r)}>IF</button>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} onClick={() => { if (window.confirm('Close this item?')) onCloseRow(r); }}>Close</button>
                          <button className="ghost" style={{height: 28, lineHeight: '28px', padding: '0 10px'}} onClick={() => { if (window.confirm('Delete this item? This cannot be undone.')) onDeleteRow(r); }}>Delete</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {expanded[r.id] && (
                    <tr>
                      <td colSpan={11}>
                        <div className="grid" style={{gap: 6}}>
                          {r.legs.map((L, i) => {
                            const rule = ifRules[r.id];
                            const matchedLegs = matchedLegsOnly(r, c, rule);
                            const t = tickers[L.leg.symbol] || {};
                            const { bid, ask } = bestBidAsk(t);
                            const mid = midPrice(t);
                            const iv = t?.markIv != null ? Number(t.markIv) : undefined;
                            const dRaw = t?.delta != null ? Number(t.delta) : undefined;
                            const vRaw = t?.vega != null ? Number(t.vega) : undefined;
                            const thRaw = t?.theta != null ? Number(t.theta) : undefined;
                            const sgn = L.side === 'long' ? 1 : -1;
                            const d = dRaw != null ? sgn * dRaw : undefined;
                            const v = vRaw != null ? sgn * vRaw : undefined;
                            const th = thRaw != null ? sgn * thRaw : undefined;
                            const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
                            return (
                              <div
                                key={L.leg.symbol}
                                style={{
                                  border: '1px solid var(--border)',
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
                                          addPosition({ legs: r.legs, note: r.note });
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
                                    <div><strong>{L.side}</strong> {L.leg.optionType} {L.leg.strike} × {L.qty}</div>
                                  </div>
                                  <div className="muted">{new Date(L.leg.expiryMs).toISOString().slice(0,10)}</div>
                                </div>
                                <div className="grid" style={{gridTemplateColumns:'2fr repeat(5, minmax(0,1fr))', gridTemplateRows:'repeat(4, auto)', gap: 6}}>
                                  {/* First column header (row 1) */}
                                  <div style={{gridColumn:1, gridRow:1}} className="muted">Symbol</div>
                                  {/* First column value spans rows 2-4 and is vertically centered */}
                                  <div style={{gridColumn:1, gridRow:'2 / span 3', paddingRight:12, display:'flex', alignItems:'center'}}>
                                    <div title={L.leg.symbol} style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word', fontSize:'1em'}}>{L.leg.symbol}</div>
                                  </div>
                                  {/* Row 1: titles (left to right) */}
                                  <div style={{gridColumn:2, gridRow:1}} className="muted">Bid / Ask</div>
                                  <div style={{gridColumn:3, gridRow:1}} className="muted">Mid</div>
                                  <div style={{gridColumn:4, gridRow:1}} className="muted">Entry</div>
                                  <div style={{gridColumn:5, gridRow:1}} className="muted">PnL ($)</div>
                                  <div style={{gridColumn:6, gridRow:1}} className="muted">IV %</div>
                                  {/* Row 3: titles second line */}
                                  <div style={{gridColumn:2, gridRow:3}} className="muted">Vega</div>
                                  <div style={{gridColumn:3, gridRow:3}} className="muted">Δ (Delta)</div>
                                  <div style={{gridColumn:4, gridRow:3}} className="muted">Θ (Theta)</div>
                                  <div style={{gridColumn:5, gridRow:3}} className="muted">OI (Ctrs)</div>
                                  <div style={{gridColumn:6, gridRow:3}} className="muted">Δσ (Vol)</div>
                                  {/* Row 2: values for first line */}
                                  <div style={{gridColumn:2, gridRow:2}}>{bid != null ? bid.toFixed(2) : '—'} / {ask != null ? ask.toFixed(2) : '—'}</div>
                                  <div style={{gridColumn:3, gridRow:2}}>{mid != null ? mid.toFixed(2) : '—'}</div>
                                  <div style={{gridColumn:4, gridRow:2}}>{isFinite(L.entryPrice) ? `$${L.entryPrice.toFixed(2)}` : '—'}</div>
                                  <div style={{gridColumn:5, gridRow:2}}>{(() => { const sgn2 = L.side === 'short' ? 1 : -1; const entry = Number(L.entryPrice); const m = mid; const qty = Number(L.qty) || 1; const pnl = (isFinite(entry) && m != null && isFinite(m)) ? sgn2 * (entry - m) * qty : undefined; return pnl != null ? pnl.toFixed(2) : '—'; })()}</div>
                                  <div style={{gridColumn:6, gridRow:2}}>{(() => {
                                    const rawMarkIv = t?.markIv != null ? Number(t.markIv) : (iv != null ? Number(iv) : undefined);
                                    if (rawMarkIv != null && isFinite(rawMarkIv)) {
                                      const pct = rawMarkIv <= 3 ? rawMarkIv * 100 : rawMarkIv;
                                      return pct.toFixed(1);
                                    }
                                    const spotAny = (() => { for (const LL of r.legs) { const tt = tickers[LL.leg.symbol] || {}; if (tt?.indexPrice != null && isFinite(Number(tt.indexPrice))) return Number(tt.indexPrice); } return undefined; })();
                                    const S = t?.indexPrice != null ? Number(t.indexPrice) : spotAny;
                                    const K = Number(L.leg.strike) || 0;
                                    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
                                    const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
                                    if (S != null && isFinite(S) && K > 0 && T > 0 && markPrice != null && isFinite(markPrice) && markPrice >= 0) {
                                      const iv = bsImpliedVol(L.leg.optionType, S, K, T, markPrice, rPct / 100);
                                      if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
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
                                    if (ivFromBook != null && isFinite(ivFromBook)) return (ivFromBook * 100).toFixed(1);
                                    const S2 = t?.indexPrice != null ? Number(t.indexPrice) : spotAny;
                                    const mid2 = mid != null ? Number(mid) : undefined;
                                    if (S2 != null && isFinite(S2) && K > 0 && T > 0 && mid2 != null && isFinite(mid2) && mid2 >= 0) {
                                      const iv = bsImpliedVol(L.leg.optionType, S2, K, T, mid2, rPct / 100);
                                      if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
                                    }
                                    const v = hv30;
                                    return v != null && isFinite(v) ? Number(v).toFixed(1) : '—';
                                  })()}</div>
                                  {/* Row 4: values for second line */}
                                  <div style={{gridColumn:2, gridRow:4}}>{v != null ? v.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:3, gridRow:4}}>{d != null ? d.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:4, gridRow:4}}>{th != null ? th.toFixed(3) : '—'}</div>
                                  <div style={{gridColumn:5, gridRow:4}}>{oi != null ? oi : '—'}</div>
                                  <div style={{gridColumn:6, gridRow:4}}>{(() => {
                                    const spotAny2 = (() => { for (const LL of r.legs) { const tt = tickers[LL.leg.symbol] || {}; if (tt?.indexPrice != null && isFinite(Number(tt.indexPrice))) return Number(tt.indexPrice); } return undefined; })();
                                    const S = t?.indexPrice != null ? Number(t.indexPrice) : spotAny2;
                                    const K = Number(L.leg.strike) || 0;
                                    const T = Math.max(0, (Number(L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
                                    if (!(S != null && isFinite(S) && K > 0 && T > 0)) return '—';
                                    const mid3 = mid != null ? Number(mid) : undefined;
                                    const ivMid = (mid3 != null && isFinite(mid3) && mid3 >= 0) ? bsImpliedVol(L.leg.optionType, S, K, T, mid3, rPct / 100) : undefined;
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
                                    const sigmaFromHV = (hv30 != null && isFinite(hv30)) ? (Number(hv30) / 100) : undefined;
                                    const sigmaRef = sigmaFromMarkIv ?? sigmaFromMarkPrice ?? sigmaFromBook ?? sigmaFromHV;
                                    if (!(ivMid != null && isFinite(ivMid) && sigmaRef != null && isFinite(sigmaRef))) return '—';
                                    const dSigmaPp = (ivMid - sigmaRef) * 100;
                                    const badge = dSigmaPp >= 1 ? '↑' : (dSigmaPp <= -1 ? '↓' : '–');
                                    return `${dSigmaPp.toFixed(1)} [${badge}]`;
                                  })()}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
              });
            })()}
          </tbody>
        </table>
      </div>
      {view && (
        <PositionView
          legs={view.legs}
          createdAt={view.createdAt}
          note={view.note}
          title={strategyName(view.legs)}
          onClose={() => setView(null)}
          hiddenSymbols={view.legs.filter(L=>L.hidden).map(L=>L.leg.symbol)}
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
                addPosition({ legs: view.legs, note: view.note });
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
                    setView({ id: 'P:' + pos.id, kind: 'multi', legs: pos.legs, createdAt: pos.createdAt, closedAt: pos.closedAt, note: pos.note, favorite: pos.favorite });
                  }
                }
              } catch {}
            }
          }}
        />
      )}
      {ifRow && (
        <IfModal
          title={strategyName(ifRow.legs)}
          legOptions={ifRow.legs.map(L=>({ symbol: L.leg.symbol, label: `${L.side === 'short' ? 'Short' : 'Long'} · ${L.leg.optionType}${L.leg.strike} × ${L.qty} · ${L.leg.symbol}` }))}
          initial={ifRules[ifRow.id]}
          onClose={() => setIfRow(null)}
          onSave={(rule) => { setIfRules(prev => ({ ...prev, [ifRow.id]: rule })); setIfRow(null); }}
          evalCondLive={({ scope, legSymbol, cond }) => evalSingleCondLive(ifRow, { scope, legSymbol, cond })}
        />
      )}
      {editId && <EditPositionModal id={editId} onClose={() => setEditId(null)} />}
    </div>
  );
}
  const netEntryFor = (legs: PositionLeg[]) => legs.filter(L=>!L.hidden).reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);

  const strategyName = (legs: PositionLeg[]): string => {
    legs = legs.filter(L=>!L.hidden);
    if (!legs.length) return '—';
    const Ls = legs.map(l => ({ side: l.side, type: l.leg.optionType, exp: l.leg.expiryMs, k: l.leg.strike, qty: l.qty }));
    const tol = 1e-6;
    const same = (a: number, b: number) => Math.abs(a - b) <= tol;
    const allSameExp = Ls.every(x => same(x.exp, Ls[0].exp));
    const allSameType = Ls.every(x => x.type === Ls[0].type);
    const byType = (t: 'C' | 'P') => Ls.filter(x => x.type === t);
    const bySide = (s: 'long' | 'short') => Ls.filter(x => x.side === s);
    const sumQty = (arr: typeof Ls) => arr.reduce((a, x) => a + (Number(x.qty) || 0), 0);
    const sortedByK = (arr: typeof Ls) => [...arr].sort((a, b) => a.k - b.k);
    const net = netEntryFor(legs);

    // 1 leg
    if (Ls.length === 1) {
      const a = Ls[0];
      const side = a.side === 'long' ? 'Long' : 'Short';
      const kind = a.type === 'C' ? 'Call' : 'Put';
      return `${side} ${kind}`;
    }

    // 2 legs
    if (Ls.length === 2) {
      const [a, b] = Ls;
      const sameType = a.type === b.type;
      const sameExp = same(a.exp, b.exp);
      const sameStrike = same(a.k, b.k);
      const bothLong = a.side === 'long' && b.side === 'long';
      const bothShort = a.side === 'short' && b.side === 'short';
      const opposite = a.side !== b.side;
      if (!sameType && sameExp) {
        if (bothLong) return sameStrike ? 'Long Straddle' : 'Long Strangle';
        if (bothShort) return sameStrike ? 'Short Straddle' : 'Short Strangle';
      }
      if (sameType && opposite) {
        const typ = a.type === 'C' ? 'Call' : 'Put';
        if (!sameExp && sameStrike) {
          const longIsLater = (a.side === 'long' ? a : b).exp > (a.side === 'short' ? a : b).exp;
          return `${longIsLater ? 'Long' : 'Short'} ${typ} Calendar`;
        }
        if (!sameExp && !sameStrike) {
          const longIsLater = (a.side === 'long' ? a : b).exp > (a.side === 'short' ? a : b).exp;
          return `${longIsLater ? 'Long' : 'Short'} ${typ} Diagonal`;
        }
        if (sameExp && !sameStrike) {
          const longK = (a.side === 'long' ? a : b).k;
          const shortK = (a.side === 'short' ? a : b).k;
          const isCredit = net > 0;
          if (typ === 'Call') {
            const bull = longK < shortK;
            return `${bull ? 'Bull' : 'Bear'} Call ${isCredit ? 'Credit' : 'Debit'} Spread`;
          } else {
            const bull = shortK > longK;
            return `${bull ? 'Bull' : 'Bear'} Put ${isCredit ? 'Credit' : 'Debit'} Spread`;
          }
        }
      }
    }

    // 3 legs
    if (Ls.length === 3) {
      if (allSameExp && allSameType) {
        const S = sortedByK(Ls);
        const sgnQty = S.map(x => (x.side === 'long' ? 1 : -1) * (Number(x.qty) || 0));
        const isButterflyLike = same(Math.abs(sgnQty[0]), Math.abs(sgnQty[2])) && same(Math.abs(sgnQty[1]), Math.abs(sgnQty[0] + sgnQty[2]));
        if (isButterflyLike) {
          const longWings = sgnQty[0] > 0 && sgnQty[2] > 0 && sgnQty[1] < 0;
          const shortWings = sgnQty[0] < 0 && sgnQty[2] < 0 && sgnQty[1] > 0;
          const wingLeft = S[1].k - S[0].k;
          const wingRight = S[2].k - S[1].k;
          const broken = !same(wingLeft, wingRight);
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          if (longWings) return `${broken ? 'Broken Wing ' : ''}Long ${typ} Butterfly`;
          if (shortWings) return `${broken ? 'Broken Wing ' : ''}Short ${typ} Butterfly`;
        }
        const longs = bySide('long');
        const shorts = bySide('short');
        if ((longs.length === 1 && shorts.length === 2) || (longs.length === 2 && shorts.length === 1)) {
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          const lq = sumQty(longs);
          const sq = sumQty(shorts);
          const ratio = longs.length === 1 ? `${Math.round(lq)}x${Math.round(sq)}` : `${Math.round(lq)}x${Math.round(sq)}`;
          return `Ratio ${typ} Spread (${ratio})`;
        }
      }
      return 'Three‑leg Combo';
    }

    // 4 legs
    if (Ls.length === 4) {
      const calls = byType('C');
      const puts = byType('P');
      if (allSameExp) {
        if (calls.length === 2 && puts.length === 2) {
          // Iron Butterfly
          const cKs = sortedByK(calls).map(x => x.k);
          const pKs = sortedByK(puts).map(x => x.k);
          const midK = cKs.find(k => pKs.includes(k));
          if (midK != null) {
            const cMid = calls.find(x => same(x.k, midK));
            const pMid = puts.find(x => same(x.k, midK));
            const wings = Ls.filter(x => !same(x.k, midK));
            if (cMid && pMid && wings.length === 2) {
              const midsShort = cMid.side === 'short' && pMid.side === 'short';
              const midsLong = cMid.side === 'long' && pMid.side === 'long';
              if (midsShort) return 'Short Iron Butterfly';
              if (midsLong) return 'Long Iron Butterfly';
            }
          }
          // Iron Condor
          const c = sortedByK(calls);
          const p = sortedByK(puts);
          const condorShort = c[0].side === 'short' && c[1].side === 'long' && p[0].side === 'long' && p[1].side === 'short';
          const condorLong  = c[0].side === 'long' && c[1].side === 'short' && p[0].side === 'short' && p[1].side === 'long';
          if (condorShort) return 'Short Iron Condor';
          if (condorLong) return 'Long Iron Condor';
        }
        // Same-type Condor (all Calls or all Puts)
        if (allSameType) {
          const S = sortedByK(Ls);
          const wingsLong = S[0].side === 'long' && S[3].side === 'long' && S[1].side === 'short' && S[2].side === 'short';
          const wingsShort = S[0].side === 'short' && S[3].side === 'short' && S[1].side === 'long' && S[2].side === 'long';
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          if (wingsLong) return `Long ${typ} Condor`;
          if (wingsShort) return `Short ${typ} Condor`;
        }
        // Box Spread
        if (calls.length === 2 && puts.length === 2) {
          const kSet = Array.from(new Set(Ls.map(x => x.k))).sort((a,b)=>a-b);
          if (kSet.length === 2) {
            const k1 = kSet[0], k2 = kSet[1];
            const hasLongCallK1 = calls.some(x => same(x.k, k1) && x.side === 'long');
            const hasShortCallK2 = calls.some(x => same(x.k, k2) && x.side === 'short');
            const hasLongPutK2 = puts.some(x => same(x.k, k2) && x.side === 'long');
            const hasShortPutK1 = puts.some(x => same(x.k, k1) && x.side === 'short');
            const longBox = hasLongCallK1 && hasShortCallK2 && hasLongPutK2 && hasShortPutK1;
            const shortBox = calls.some(x => same(x.k, k1) && x.side === 'short') && calls.some(x => same(x.k, k2) && x.side === 'long') &&
                             puts.some(x => same(x.k, k2) && x.side === 'short') && puts.some(x => same(x.k, k1) && x.side === 'long');
            if (longBox) return 'Long Box Spread';
            if (shortBox) return 'Short Box Spread';
          }
        }
      } else {
        // Double Calendar / Double Diagonal
        const expSet = Array.from(new Set(Ls.map(x => x.exp))).sort();
        if (expSet.length === 2 && calls.length === 2 && puts.length === 2) {
          const cStrikeSame = same(calls[0].k, calls[1].k);
          const pStrikeSame = same(puts[0].k, puts[1].k);
          const cOppSides = calls[0].side !== calls[1].side;
          const pOppSides = puts[0].side !== puts[1].side;
          if (cStrikeSame && pStrikeSame && cOppSides && pOppSides) return 'Double Calendar (Straddle)';
          if (!cStrikeSame && !pStrikeSame && cOppSides && pOppSides) return 'Double Diagonal';
        }
      }
      return 'Four‑leg Combo';
    }

    if (Ls.length >= 5) return `Complex (${Ls.length} legs)`;
    return 'Multi‑leg';
  };
