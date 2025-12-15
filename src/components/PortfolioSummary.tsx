import React from 'react';
import { useStore, DEFAULT_PORTFOLIO_ID } from '../store/store';
import { midPrice, bestBidAsk, fetchOptionTickers, fetchPerpEth } from '../services/bybit';
import { describeStrategy, type StrategyLeg } from '../utils/strategyDetection';
import { useSlowMode } from '../contexts/SlowModeContext';
import { PositionView } from './PositionView';
import type { CloseSnapshot, SpreadPosition, Position } from '../utils/types';
import { buildPositionViewPayload, buildSpreadViewPayload, type ViewPayload } from '../utils/viewPayload';

type PortfolioSummaryProps = {
  onOpenSummary?: (portfolioId: string) => void;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

export function PortfolioSummary({ onOpenSummary }: PortfolioSummaryProps) {
  const allSpreads = useStore((s) => s.spreads);
  const allPositions = useStore((s) => s.positions);
  const deposit = useStore((s) => s.settings.depositUsd);
  const riskLimitPct = useStore((s) => s.settings.riskLimitPct);
  const setDeposit = useStore((s) => s.setDeposit);
  const setRiskLimit = useStore((s) => s.setRiskLimitPct);
  const clearRealizedHistory = useStore((s) => s.clearRealizedHistory);
  const portfolios = useStore((s) => s.portfolios);
  const activePortfolioId = useStore((s) => s.activePortfolioId);
  const markClosed = useStore((s) => s.markClosed);
  const closePosition = useStore((s) => s.closePosition);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const { register } = useSlowMode();
  const [onlyFav, setOnlyFav] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('portfolio-only-favorites');
      return raw === '1';
    } catch { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('portfolio-only-favorites', onlyFav ? '1' : '0'); } catch {}
  }, [onlyFav]);

  const matchPortfolio = React.useCallback((portfolioId?: string) => {
    if (activePortfolioId === DEFAULT_PORTFOLIO_ID) return true;
    return (portfolioId ?? DEFAULT_PORTFOLIO_ID) === activePortfolioId;
  }, [activePortfolioId]);
  const spreads = React.useMemo(() => allSpreads.filter((s) => matchPortfolio(s.portfolioId)), [allSpreads, matchPortfolio]);
  const positions = React.useMemo(() => allPositions.filter((p) => matchPortfolio(p.portfolioId)), [allPositions, matchPortfolio]);
  const activePortfolio = React.useMemo(() => portfolios.find((p) => p.id === activePortfolioId), [portfolios, activePortfolioId]);

  const spreadsSel = React.useMemo(() => (onlyFav ? spreads.filter(s => !!s.favorite) : spreads), [spreads, onlyFav]);
  const positionsSel = React.useMemo(() => (onlyFav ? positions.filter(p => !!p.favorite) : positions), [positions, onlyFav]);

  // Follow main table preference for PnL calculation (exec vs mid)
  const [useExecPref, setUseExecPref] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('positions-ui-v1');
      const s = raw ? JSON.parse(raw) : {};
      return !!s?.useExecPnl;
    } catch { return true; }
  });
  React.useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem('positions-ui-v1');
        const s = raw ? JSON.parse(raw) : {};
        setUseExecPref(!!s?.useExecPnl);
      } catch {}
    };
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === 'positions-ui-v1') read(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // List of open option constructions with per-item uPnL and expiry
  const openOptionConstructions = React.useMemo(() => {
    const entries: Array<{
      text: string;
      title: string;
      expiry: number;
      upnl?: number;
      type: 'spread' | 'position';
      id: string;
      ref: SpreadPosition | Position;
    }> = [];
    const fmt = (ms: number | undefined) => {
      if (!(Number(ms) > 0)) return { date: '—', d: '—' };
      const date = new Date(Number(ms));
      const iso = date.toISOString().slice(0, 10);
      const days = Math.max(0, Math.floor((Number(ms) - Date.now()) / 86_400_000));
      return { date: iso, d: `${days}d` };
    };
    const midOf = (sym: string) => {
      const t = tickers[sym];
      const m = midPrice(t);
      return (m != null && isFinite(m)) ? Number(m) : undefined;
    };
    const execFor = (sym: string, side: 'short'|'long') => {
      const t = tickers[sym] || {};
      const { bid, ask } = bestBidAsk(t);
      if (side === 'short') return (ask != null && isFinite(Number(ask))) ? Number(ask) : undefined;
      return (bid != null && isFinite(Number(bid))) ? Number(bid) : undefined;
    };
    // spreads
    spreadsSel.filter(s => !s.closedAt).forEach(s => {
      const legs: StrategyLeg[] = [
        { side: 'short', type: s.short.optionType, expiryMs: Number(s.short.expiryMs)||0, strike: Number(s.short.strike)||0, qty: Number(s.qty)||1, symbol: s.short.symbol },
        { side: 'long',  type: s.long.optionType,  expiryMs: Number(s.long.expiryMs)||0,  strike: Number(s.long.strike)||0,  qty: Number(s.qty)||1, symbol: s.long.symbol },
      ];
      const label = describeStrategy(legs, Number(s.cEnter)||0);
      const expiries = legs.map(l=>Number(l.expiryMs)).filter(v=>v>0);
      const nearest = expiries.length ? Math.min(...expiries) : undefined;
      const { date, d } = fmt(nearest);
      // uPnL for spread
      const mShort = midOf(s.short.symbol);
      const mLong = midOf(s.long.symbol);
      const exShort = execFor(s.short.symbol, 'short');
      const exLong = execFor(s.long.symbol, 'long');
      const nowShort = useExecPref ? (exShort ?? mShort) : mShort;
      const nowLong = useExecPref ? (exLong ?? mLong) : mLong;
      const qty = Number(s.qty) > 0 ? Number(s.qty) : 1;
      const upnl = (nowShort != null && nowLong != null) ? ((Number(s.cEnter) * qty) - ((Number(nowShort) - Number(nowLong)) * qty)) : undefined;
      const expiryKey = nearest ?? Number.MAX_SAFE_INTEGER;
      entries.push({
        text: `${label} ${date} · ${d}`,
        title: label,
        expiry: expiryKey,
        upnl,
        type: 'spread',
        id: s.id,
        ref: s,
      });
    });
    // positions
    positionsSel.filter(p => !p.closedAt).forEach(p => {
      const legs: StrategyLeg[] = (p.legs||[]).filter(L=>!L.hidden).map(L => ({
        side: L.side,
        type: L.leg.optionType,
        expiryMs: Number(L.leg.expiryMs)||0,
        strike: Number(L.leg.strike)||0,
        qty: Number(L.qty)||1,
        symbol: L.leg.symbol,
        isUnderlying: !String(L.leg.symbol||'').includes('-') || !(Number(L.leg.expiryMs)>0),
      }));
      if (!legs.length) return;
      const label = describeStrategy(legs, 0);
      const expiries = legs.filter(l=>!l.isUnderlying).map(l=>Number(l.expiryMs)).filter(v=>v>0);
      const nearest = expiries.length ? Math.min(...expiries) : undefined;
      const { date, d } = fmt(nearest);
      // uPnL for position (sum per leg)
      const items = (p.legs||[]).filter(L => !L.hidden);
      let upnl: number | undefined = 0;
      for (const L of items) {
        const sym = String(L.leg.symbol||'');
        const mid = midOf(sym);
        const ex = execFor(sym, L.side);
        const now = useExecPref ? (ex ?? mid) : mid;
        if (now == null) { upnl = undefined; break; }
        const entry = Number(L.entryPrice) || 0;
        const qty = Number(L.qty) || 1;
        const sign = L.side === 'short' ? +1 : -1;
        upnl += sign * (entry - Number(now)) * qty;
      }
      const expiryKey = nearest ?? Number.MAX_SAFE_INTEGER;
      entries.push({
        text: `${label} ${date} · ${d}`,
        title: label,
        expiry: expiryKey,
        upnl,
        type: 'position',
        id: p.id,
        ref: p,
      });
    });
    entries.sort((a, b) => a.expiry - b.expiry);
    return entries;
  }, [spreadsSel, positionsSel, tickers, useExecPref]);


  const toNumber = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const legExitPnl = (leg: Position['legs'][number]): number | undefined => {
    const exit = toFiniteNumber((leg as any)?.exitPrice);
    if (exit == null) return undefined;
    const entry = Number(leg.entryPrice) || 0;
    const qty = Number(leg.qty) || 1;
    const pnl = leg.side === 'short' ? (entry - exit) * qty : (exit - entry) * qty;
    return Number.isFinite(pnl) ? pnl : undefined;
  };

  const formatLegLabel = (leg: Position['legs'][number]): string => {
    const sym = String(leg.leg.symbol || '');
    const isOption = sym.includes('-');
    const expiry = Number(leg.leg.expiryMs) || 0;
    const base = isOption
      ? `${leg.side} ${leg.leg.optionType}${leg.leg.strike}`
      : `${leg.side} ${sym}`;
    if (isOption && expiry > 0) {
      try { return `${base} · ${new Date(expiry).toISOString().slice(0,10)}`; } catch { return base; }
    }
    return base;
  };

  const metrics = React.useMemo(() => {
    // Helpers
    const legMid = (symbol: string): number | undefined => {
      const t = tickers[symbol];
      const m = midPrice(t);
      return (m != null && isFinite(m)) ? Number(m) : undefined;
    };
    const isOptionSym = (sym: string) => String(sym || '').includes('-');

    // Realized PnL (closed items + legs exited in open positions)
    const realizedFromSpreads = spreadsSel.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realizedFromPositions = positionsSel.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realizedFromLegs = positionsSel
      .filter((p) => !p.closeSnapshot)
      .reduce((acc, p) => {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        const sum = legs.reduce((s, L) => s + (legExitPnl(L) ?? 0), 0);
        return acc + sum;
      }, 0);
    const realized = realizedFromSpreads + realizedFromPositions + realizedFromLegs;

    // Unrealized PnL (open only); совпадает с настройкой таблицы: exec vs mid
    let unrealized = 0;
    // Spreads
    spreadsSel.filter(p => !p.closedAt).forEach((p) => {
      const tShort = tickers[p.short.symbol] || {};
      const tLong = tickers[p.long.symbol] || {};
      const { bid: bidS, ask: askS } = bestBidAsk(tShort);
      const { bid: bidL, ask: askL } = bestBidAsk(tLong);
      const mShort = legMid(p.short.symbol);
      const mLong = legMid(p.long.symbol);
      const execShort = askS != null && isFinite(Number(askS)) ? Number(askS) : (mShort != null ? Number(mShort) : undefined);
      const execLong = bidL != null && isFinite(Number(bidL)) ? Number(bidL) : (mLong != null ? Number(mLong) : undefined);
      const priceShort = useExecPref ? execShort : mShort;
      const priceLong = useExecPref ? execLong : mLong;
      if (priceShort == null || priceLong == null) return;
      const qty = Number(p.qty) > 0 ? Number(p.qty) : 1;
      const netNow = (Number(priceShort) - Number(priceLong)) * qty;
      const netEntry = Number(p.cEnter) * qty;
      unrealized += (netEntry - netNow);
    });
    // Generic positions
    positionsSel.filter(p => !p.closedAt).forEach((p) => {
      const legs = Array.isArray(p.legs) ? p.legs.filter(L => !L.hidden && !(L.exitPrice != null && isFinite(Number(L.exitPrice)))) : [];
      if (!legs.length) return;
      // Требуем цену для всех ног (exec или mid), иначе пропускаем
      const rows: Array<{ now: number; entry: number; qty: number; sign: number; sym: string } | null> = legs.map((L) => {
        const sym = String(L.leg.symbol || '');
        const t = tickers[sym] || {};
        const { bid, ask } = bestBidAsk(t);
        const mid = legMid(sym);
        const exec = L.side === 'short' ? (ask != null && isFinite(Number(ask)) ? Number(ask) : undefined)
                                        : (bid != null && isFinite(Number(bid)) ? Number(bid) : undefined);
        const nowPrice = useExecPref ? (exec != null ? exec : (mid as number)) : (mid as number);
        if (nowPrice == null) return null;
        const entry = Number(L.entryPrice) || 0;
        const qty = Number(L.qty) || 1;
        const sign = L.side === 'short' ? +1 : -1;
        return { now: nowPrice, entry, qty, sign, sym };
      });
      if (rows.some(v => v == null)) return;
      const netEntry = rows.reduce((a, x) => a + x!.sign * x!.entry * x!.qty, 0);
      const netNow = rows.reduce((a, x) => a + x!.sign * x!.now * x!.qty, 0);
      unrealized += (netEntry - netNow);
    });

    // Risk: сумма MaxLoss по всем открытым конструкциям (где можно оценить конечный риск)
    const riskForSpread = (p: typeof spreads[number]): number | undefined => {
      if (p.closedAt) return undefined;
      const sameExpiry = Number(p.short.expiryMs) === Number(p.long.expiryMs) && p.short.expiryMs > 0;
      if (!sameExpiry) return undefined;
      const width = Math.abs(Number(p.short.strike) - Number(p.long.strike));
      const qty = Number(p.qty) > 0 ? Number(p.qty) : 1;
      const c = Number(p.cEnter);
      const perContract = c >= 0 ? Math.max(0, width - c) : Math.abs(c);
      const ml = perContract * qty;
      return Number.isFinite(ml) ? ml : undefined;
    };
    const riskFromSpreads = spreadsSel.map(riskForSpread).filter((v): v is number => v != null).reduce((a,b)=>a+b,0);

    // Примерная оценка MaxLoss для произвольной позиции по payoff на экспирации
    const approxMaxLossForPosition = (p: typeof positions[number]): number | undefined => {
      if (p.closedAt) return undefined;
      const legs = Array.isArray(p.legs) ? p.legs.filter(L => !L.hidden && !(L.exitPrice != null && isFinite(Number(L.exitPrice)))) : [];
      if (!legs.length) return undefined;
      const Ks = Array.from(new Set(legs.map(L => Number(L.leg.strike) || 0).filter(s => isFinite(s) && s > 0))).sort((a,b)=>a-b);
      const netEntry = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);
      const intrinsicAt = (S: number) => {
        let signed = 0;
        for (const L of legs) {
          const isPerp = !String(L.leg.symbol || '').includes('-') || !(Number(L.leg.expiryMs) > 0);
          if (isPerp) {
            signed += (L.side === 'short' ? 1 : -1) * Number(S) * (Number(L.qty) || 1);
            continue;
          }
          const K = Number(L.leg.strike) || 0;
          const q = Number(L.qty) || 1;
          const sign = L.side === 'short' ? 1 : -1;
          const intrinsic = L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
          signed += sign * intrinsic * q;
        }
        return signed;
      };
      const evalPnL = (S: number) => {
        const val = intrinsicAt(S);
        if (val == null) return undefined; // содержит перпы — пропускаем
        const pnl = netEntry - val;
        return Number.isFinite(pnl) ? pnl : undefined;
      };
      const S0 = 0;
      const topStrike = Ks.length ? Ks[Ks.length - 1] : undefined;
      const Sfar = (topStrike ?? 1000) * 5 + 1;
      const Sfurther = (topStrike ?? 1000) * 10 + 1;
      const candidateSet = new Set([S0, ...Ks, Sfar, Sfurther]);
      let minPnl = Infinity;
      let unbounded = false;
      for (const S of candidateSet) {
        const pnl = evalPnL(S);
        if (pnl == null) return undefined;
        if (pnl < minPnl) minPnl = pnl;
      }
      // Если PnL продолжает резко ухудшаться при дальнейшем росте базового актива — считаем риск неограниченным и не учитываем
      const pnlFar = evalPnL(Sfar);
      const pnlFarthest = evalPnL(Sfurther);
      if (pnlFar == null || pnlFarthest == null) return undefined;
      if (pnlFarthest < pnlFar - 1e-6) unbounded = true;
      if (unbounded) return Number.POSITIVE_INFINITY;
      return Number.isFinite(minPnl) ? Math.max(0, -minPnl) : undefined;
    };
    const riskFromPositions = positionsSel.map(approxMaxLossForPosition).filter((v): v is number => v != null).reduce((a,b)=>a+b,0);
    const openRisk = riskFromSpreads + riskFromPositions;
    const riskShare = deposit > 0 ? (openRisk / deposit) * 100 : 0;

    return { realized, unrealized, openRisk, riskShare };
  }, [deposit, positionsSel, spreadsSel, tickers]);

  // Refresh mids for Unrealized PnL via REST when SlowMode triggers (initial/schedule/manual)
  React.useEffect(() => {
    let stopped = false;
    const collectSymbols = () => {
      const symbols = new Set<string>();
      spreadsSel.filter(p => !p.closedAt).forEach(p => { symbols.add(p.short.symbol); symbols.add(p.long.symbol); });
      positionsSel.filter(p => !p.closedAt).forEach(p => p.legs.filter(L => !L.hidden && !(L.exitPrice != null && isFinite(Number(L.exitPrice)))).forEach(L => symbols.add(L.leg.symbol)));
      return Array.from(symbols);
    };
    const refresh = async () => {
      try {
        const [list, perp] = await Promise.all([
          fetchOptionTickers().catch(() => []),
          fetchPerpEth().catch(() => undefined),
        ]);
        if (stopped) return;
        const needed = new Set(collectSymbols());
        setTickers(prev => {
          const next = { ...prev } as Record<string, any>;
          list.forEach((t: any) => {
            const sym = String(t.symbol || '');
            if (!needed.has(sym)) return;
            const cur = next[sym] || {};
            next[sym] = {
              ...cur,
              bid1Price: t?.bid1Price != null ? Number(t.bid1Price) : cur.bid1Price,
              ask1Price: t?.ask1Price != null ? Number(t.ask1Price) : cur.ask1Price,
              markPrice: t?.markPrice != null ? Number(t.markPrice) : cur.markPrice,
              indexPrice: t?.indexPrice != null ? Number(t.indexPrice) : cur.indexPrice,
              delta: t?.delta != null ? Number(t.delta) : cur.delta,
              gamma: t?.gamma != null ? Number(t.gamma) : cur.gamma,
              vega: t?.vega != null ? Number(t.vega) : cur.vega,
              theta: t?.theta != null ? Number(t.theta) : cur.theta,
              openInterest: t?.openInterest != null ? Number(t.openInterest) : cur.openInterest,
            };
          });
          const mark = Number.isFinite(perp?.markPrice) ? Number(perp?.markPrice) : undefined;
          const last = Number.isFinite(perp?.lastPrice) ? Number(perp?.lastPrice) : undefined;
          const idx = Number.isFinite(perp?.indexPrice) ? Number(perp?.indexPrice) : undefined;
          const bid = Number.isFinite(perp?.bid) ? Number(perp?.bid) : undefined;
          const ask = Number.isFinite(perp?.ask) ? Number(perp?.ask) : undefined;
          const price = Number.isFinite(perp?.price) ? Number(perp?.price) : undefined;
          if (needed.has('ETHUSDT') && (mark != null || last != null || idx != null || bid != null || ask != null || price != null)) {
            const cur = next['ETHUSDT'] || {};
            const anchor = mark ?? last ?? price ?? idx ?? cur.markPrice ?? cur.lastPrice;
            next['ETHUSDT'] = {
              ...cur,
              markPrice: mark ?? anchor ?? cur.markPrice,
              lastPrice: last ?? cur.lastPrice,
              indexPrice: idx ?? anchor ?? cur.indexPrice,
              bid1Price: bid ?? cur.bid1Price ?? anchor,
              ask1Price: ask ?? cur.ask1Price ?? anchor,
            };
          }
          return next;
        });
      } catch { /* ignore */ }
    };
    // register with global slow mode so manual "Refresh now" triggers this too
    const unregister = register(() => refresh());
    // do an initial refresh so values are not stale on mount
    refresh().catch(() => {});
    return () => { stopped = true; unregister(); };
  }, [positionsSel, spreadsSel, register]);

  const [showManage, setShowManage] = React.useState(false);
  const [showRealizedModal, setShowRealizedModal] = React.useState(false);
  const [viewClosed, setViewClosed] = React.useState<ViewPayload | null>(null);

  const fmtMoney = (v: number) => {
    if (!Number.isFinite(v)) return '∞';
    return `$${v.toFixed(2)}`;
  };
  const riskShareDisplay = Number.isFinite(metrics.riskShare) ? `${metrics.riskShare.toFixed(1)}%` : '∞';
  const riskLimit = Number.isFinite(riskLimitPct ?? NaN) && (riskLimitPct ?? 0) >= 0 ? (riskLimitPct as number) : undefined;
  const riskExceeded = riskLimit != null && metrics.riskShare != null && Number.isFinite(metrics.riskShare) ? metrics.riskShare >= riskLimit : (riskLimit != null && !Number.isFinite(metrics.riskShare));
  const riskHighlightStyle = riskExceeded ? { color: 'var(--loss)' } : undefined;
  const riskRatioText = riskLimit != null ? `${riskShareDisplay} / ${riskLimit.toFixed(1)}%` : riskShareDisplay;
  const pnlColor = metrics.realized > 0 ? 'var(--gain)' : (metrics.realized < 0 ? 'var(--loss)' : undefined);
  const upnlColor = metrics.unrealized > 0 ? 'var(--gain)' : (metrics.unrealized < 0 ? 'var(--loss)' : undefined);

  type RealizedEntry = { id: string; type: 'spread' | 'position' | 'leg'; label: string; closedAt: number; pnl?: number; ref: SpreadPosition | Position };

  const realizedEntries = React.useMemo<RealizedEntry[]>(() => {
    const entries: RealizedEntry[] = [];
    spreadsSel.filter(s => !!s.closedAt && !!s.closeSnapshot).forEach((s) => {
      const legs: StrategyLeg[] = [
        { side: 'short', type: s.short.optionType, expiryMs: Number(s.short.expiryMs) || 0, strike: Number(s.short.strike) || 0, qty: Number(s.qty) || 1, symbol: s.short.symbol },
        { side: 'long', type: s.long.optionType, expiryMs: Number(s.long.expiryMs) || 0, strike: Number(s.long.strike) || 0, qty: Number(s.qty) || 1, symbol: s.long.symbol },
      ];
      const label = describeStrategy(legs, Number(s.cEnter) || 0);
      const pnl = (() => {
        const raw = Number(s?.closeSnapshot?.pnlExec);
        return Number.isFinite(raw) ? raw : undefined;
      })();
      entries.push({ id: s.id, type: 'spread', label, closedAt: Number(s.closedAt) || 0, pnl, ref: s });
    });
    positionsSel.filter(p => !!p.closedAt && !!p.closeSnapshot).forEach((p) => {
      const legs: StrategyLeg[] = Array.isArray(p.legs)
        ? p.legs.filter(L => !L.hidden).map(L => ({
          side: L.side,
          type: L.leg.optionType,
          expiryMs: Number(L.leg.expiryMs) || 0,
          strike: Number(L.leg.strike) || 0,
          qty: Number(L.qty) || 1,
          symbol: L.leg.symbol,
          isUnderlying: !String(L.leg.symbol || '').includes('-') || !(Number(L.leg.expiryMs) > 0),
        }))
        : [];
      if (!legs.length) return;
      const label = describeStrategy(legs, 0);
      const pnl = (() => {
        const raw = Number(p?.closeSnapshot?.pnlExec);
        return Number.isFinite(raw) ? raw : undefined;
      })();
      entries.push({ id: p.id, type: 'position', label, closedAt: Number(p.closedAt) || 0, pnl, ref: p });
    });
    // Legs exited inside open positions
    positionsSel.filter(p => !p.closeSnapshot).forEach((p) => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      legs.forEach((L, idx) => {
        const pnl = legExitPnl(L);
        if (pnl == null) return;
        const exitAt = Number((L as any)?.exitedAt) || Number(p.closedAt) || Number(p.createdAt) || Date.now();
        const label = `Leg · ${formatLegLabel(L)}`;
        entries.push({ id: `${p.id}-leg-${idx}-${exitAt}`, type: 'leg', label, closedAt: exitAt, pnl, ref: p });
      });
    });
    return entries.sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0));
  }, [positionsSel, spreadsSel]);

  const fmtDateTime = (ms: number) => {
    if (!(Number(ms) > 0)) return '—';
    try {
      return new Date(ms).toLocaleString();
    } catch { return '—'; }
  };

  const buildSpreadCloseSnapshot = React.useCallback((spread: SpreadPosition): CloseSnapshot => {
    const now = Date.now();
    const shortTicker = tickers[spread.short.symbol] || {};
    const longTicker = tickers[spread.long.symbol] || {};
    const { bid: shortBid, ask: shortAsk } = bestBidAsk(shortTicker);
    const { bid: longBid, ask: longAsk } = bestBidAsk(longTicker);
    const shortMid = toFiniteNumber(midPrice(shortTicker));
    const longMid = toFiniteNumber(midPrice(longTicker));
    const shortExec = toFiniteNumber(shortAsk) ?? shortMid ?? undefined;
    const longExec = toFiniteNumber(longBid) ?? longMid ?? undefined;
    const entryShortRaw = toFiniteNumber(spread.entryShort);
    const entryLongRaw = toFiniteNumber(spread.entryLong);
    const cEnter = toFiniteNumber(spread.cEnter) ?? 0;
    const qty = Math.max(1, toFiniteNumber(spread.qty) ?? 1);
    const entryShort = entryShortRaw ?? (entryLongRaw != null ? cEnter + entryLongRaw : cEnter);
    const entryLong = entryLongRaw ?? (entryShortRaw != null ? entryShortRaw - cEnter : 0);
    const snapshot: CloseSnapshot = { timestamp: now };
    const indexCandidate = toFiniteNumber(shortTicker?.indexPrice) ?? toFiniteNumber(longTicker?.indexPrice);
    if (indexCandidate != null) snapshot.indexPrice = indexCandidate;
    const spotCandidate = toFiniteNumber((shortTicker as any)?.spotPrice) ?? toFiniteNumber((longTicker as any)?.spotPrice);
    if (spotCandidate != null) snapshot.spotPrice = spotCandidate;
    if (snapshot.spotPrice == null && snapshot.indexPrice != null) snapshot.spotPrice = snapshot.indexPrice;
    if (shortExec != null && longExec != null) {
      const netEntry = (entryShort * qty) - (entryLong * qty);
      const netExec = (shortExec * qty) - (longExec * qty);
      const pnlExec = netEntry - netExec;
      if (Number.isFinite(pnlExec)) snapshot.pnlExec = pnlExec;
    }
    return snapshot;
  }, [tickers]);

  const buildPositionCloseSnapshot = React.useCallback((position: Position): CloseSnapshot => {
    const now = Date.now();
    const legs = Array.isArray(position.legs) ? position.legs : [];
    let netEntry = 0;
    let netExec = 0;
    let hasQuote = false;
    let indexPrice: number | undefined;
    let spotPrice: number | undefined;
    legs.forEach((leg) => {
      const qty = Math.max(1, toFiniteNumber(leg.qty) ?? 1);
      const entry = toFiniteNumber(leg.entryPrice) ?? 0;
      const sign = leg.side === 'short' ? 1 : -1;
      netEntry += sign * entry * qty;
      const sym = String(leg.leg.symbol || '');
      const ticker = tickers[sym] || {};
      const { bid, ask } = bestBidAsk(ticker);
      const mid = toFiniteNumber(midPrice(ticker));
      const exec = leg.side === 'short'
        ? (toFiniteNumber(ask) ?? mid)
        : (toFiniteNumber(bid) ?? mid);
      if (exec != null) {
        hasQuote = true;
        netExec += sign * exec * qty;
      } else {
        netExec += sign * entry * qty;
      }
      if (indexPrice == null) indexPrice = toFiniteNumber(ticker?.indexPrice);
      if (spotPrice == null) {
        const spotCandidate = toFiniteNumber((ticker as any)?.spotPrice) ?? toFiniteNumber(ticker?.markPrice);
        if (spotCandidate != null) spotPrice = spotCandidate;
      }
    });
    const snapshot: CloseSnapshot = { timestamp: now };
    if (indexPrice != null) snapshot.indexPrice = indexPrice;
    if (spotPrice != null) snapshot.spotPrice = spotPrice;
    if (snapshot.spotPrice == null && snapshot.indexPrice != null) snapshot.spotPrice = snapshot.indexPrice;
    if (snapshot.spotPrice == null) {
      const underlying = tickers['ETHUSDT'];
      const fallback = toFiniteNumber(underlying?.markPrice) ?? toFiniteNumber(underlying?.indexPrice);
      if (fallback != null) snapshot.spotPrice = fallback;
    }
    if (hasQuote) {
      const pnlExec = netEntry - netExec;
      if (Number.isFinite(pnlExec)) snapshot.pnlExec = pnlExec;
    }
    return snapshot;
  }, [tickers]);

  const exitSpread = React.useCallback((spreadId: string) => {
    const spread = useStore.getState().spreads.find((s) => s.id === spreadId);
    if (!spread || spread.closedAt) return;
    const snapshot = buildSpreadCloseSnapshot(spread);
    markClosed(spreadId, snapshot);
    setViewClosed((current) => {
      if (!current || current.id !== `S:${spreadId}`) return current;
      return { ...current, closedAt: snapshot.timestamp, closeSnapshot: snapshot };
    });
  }, [buildSpreadCloseSnapshot, markClosed]);

  const exitPosition = React.useCallback((positionId: string) => {
    const position = useStore.getState().positions.find((p) => p.id === positionId);
    if (!position || position.closedAt) return;
    const snapshot = buildPositionCloseSnapshot(position);
    closePosition(positionId, snapshot);
    setViewClosed((current) => {
      if (!current || current.id !== `P:${positionId}`) return current;
      return { ...current, closedAt: snapshot.timestamp, closeSnapshot: snapshot };
    });
  }, [buildPositionCloseSnapshot, closePosition]);

  const openEntryView = (entry: RealizedEntry) => {
    setShowRealizedModal(false);
    if (entry.type === 'spread') {
      const spread = entry.ref as SpreadPosition;
      setViewClosed(buildSpreadViewPayload(spread, entry.label || 'Spread'));
      return;
    }
    const position = entry.ref as Position;
    setViewClosed(buildPositionViewPayload(position, entry.label || 'Position'));
  };

  const openConstructionView = (entry: { type: 'spread' | 'position'; ref: SpreadPosition | Position; title: string }) => {
    if (entry.type === 'spread') {
      const spread = entry.ref as SpreadPosition;
      setViewClosed(buildSpreadViewPayload(spread, entry.title || 'Spread', {
        onClosePosition: () => exitSpread(spread.id),
      }));
      return;
    }
    const position = entry.ref as Position;
    setViewClosed(buildPositionViewPayload(position, entry.title || 'Position', {
      onClosePosition: () => exitPosition(position.id),
    }));
  };

  // removed Last Exit details from compact portfolio header

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Portfolio{activePortfolio ? ` · ${activePortfolio.name}` : ''}</h3>
        {onOpenSummary && (
          <button
            type="button"
            className="ghost"
            onClick={() => onOpenSummary(activePortfolioId)}
          >
            Summary
          </button>
        )}
      </div>
      <div className="grid" style={{ alignItems: 'end' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div>
            Deposit {fmtMoney(deposit)} ·
            <button
              type="button"
              onClick={() => setShowRealizedModal(true)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                margin: '0 4px 0 6px',
                textDecoration: 'none',
                cursor: 'pointer',
                color: 'inherit',
                font: 'inherit',
              }}
            >
              Realized
            </button>
            <span style={pnlColor ? { color: pnlColor } : undefined}>{fmtMoney(metrics.realized)}</span>
            · UnRealized <span style={upnlColor ? { color: upnlColor } : undefined}>{fmtMoney(metrics.unrealized)}</span> · Risk {fmtMoney(metrics.openRisk)} (
            {riskLimit != null ? (
              <span style={riskHighlightStyle}>{riskRatioText}</span>
            ) : riskRatioText}
            )
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
          <div className="muted">Open options ({openOptionConstructions.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {openOptionConstructions.length ? openOptionConstructions.map((e) => {
              const v = e.upnl;
              const color = (v == null) ? 'transparent' : (v > 1e-9 ? '#1f6f3b' : (v < -1e-9 ? '#7a1f1f' : '#777'));
              return (
                <div key={`${e.type}-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
                  <button
                    type="button"
                    onClick={() => openConstructionView({ type: e.type, ref: e.ref, title: e.title })}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      color: 'inherit',
                      fontFamily: 'monospace',
                      fontSize: '1.1em',
                      textAlign: 'left',
                    }}
                  >
                    {e.text}
                  </button>
                </div>
              );
            }) : <div className="muted">—</div>}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button className="ghost" onClick={() => setShowManage((v) => !v)}>{showManage ? 'Hide manage' : 'Manage'}</button>
        </div>
        {showManage && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
            <label>
              <div className="muted">Deposit (USD)</div>
              <input type="number" min="0" step="100" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} />
            </label>
            <label>
              <div className="muted">Risk limit (%)</div>
              <input
                type="number"
                min="0"
                step="0.1"
                value={riskLimit != null ? riskLimit : ''}
                placeholder="—"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setRiskLimit(undefined);
                    return;
                  }
                  const num = Number(raw);
                  setRiskLimit(Number.isFinite(num) && num >= 0 ? num : undefined);
                }}
              />
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
                <span className="muted">Only favorites</span>
              </label>
              <button
                className="ghost"
                onClick={() => {
                  const ok = window.confirm('Clear all realized PnL history? This removes close snapshots from all items.');
                  if (!ok) return;
                  try { clearRealizedHistory(); } catch {}
                }}
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </div>
      {showRealizedModal && (
        <div
          onClick={() => setShowRealizedModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              width: 'min(600px, 95%)',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 10px 30px rgba(0,0,0,.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <strong>Closed constructions</strong>
              <button className="ghost" type="button" onClick={() => setShowRealizedModal(false)}>Close</button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {realizedEntries.length === 0 ? (
                <div className="muted">Нет закрытых конструкций в текущем фильтре.</div>
              ) : (
                <>
                  {realizedEntries.map((entry) => {
                    const color = entry.pnl != null ? (entry.pnl > 0 ? 'var(--gain)' : (entry.pnl < 0 ? 'var(--loss)' : undefined)) : undefined;
                    return (
                      <div key={`${entry.type}-${entry.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                        <div>
                          <button
                            type="button"
                            onClick={() => openEntryView(entry)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              margin: 0,
                              cursor: 'pointer',
                              color: 'inherit',
                              fontWeight: 600,
                              fontSize: '1em',
                              textAlign: 'left',
                            }}
                          >
                            {entry.label || (entry.type === 'spread' ? 'Spread' : (entry.type === 'leg' ? 'Leg' : 'Position'))}
                          </button>
                          <div className="muted" style={{ fontSize: '0.9em' }}>{fmtDateTime(entry.closedAt)}</div>
                        </div>
                        <div style={{ fontFamily: 'monospace', color, fontSize: '1.1em' }}>{entry.pnl != null ? fmtMoney(entry.pnl) : '—'}</div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', paddingTop: 12 }}>
                    <div style={{ fontWeight: 600 }}>Total</div>
                    {(() => {
                      const sum = realizedEntries.reduce((acc, entry) => acc + (entry.pnl ?? 0), 0);
                      const color = sum > 0 ? 'var(--gain)' : (sum < 0 ? 'var(--loss)' : undefined);
                      return <div style={{ fontFamily: 'monospace', fontSize: '1.15em', color }}>{fmtMoney(sum)}</div>;
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {viewClosed && (
        <PositionView
          id={viewClosed.id}
          legs={viewClosed.legs}
          createdAt={viewClosed.createdAt}
          closedAt={viewClosed.closedAt}
          closeSnapshot={viewClosed.closeSnapshot}
          note={viewClosed.note}
          title={viewClosed.title}
          hiddenLegIds={viewClosed.hiddenLegIds}
          onClosePosition={viewClosed.onClosePosition}
          onClose={() => setViewClosed(null)}
        />
      )}
    </div>
  );
}
