import React from 'react';
import { useStore } from '../store/store';
import { midPrice, bestBidAsk, fetchOptionTickers, fetchSpotEth } from '../services/bybit';
import { describeStrategy, type StrategyLeg } from '../utils/strategyDetection';
import { useSlowMode } from '../contexts/SlowModeContext';

export function PortfolioSummary() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const deposit = useStore((s) => s.settings.depositUsd);
  const setDeposit = useStore((s) => s.setDeposit);
  const clearRealizedHistory = useStore((s) => s.clearRealizedHistory);
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

  const spreadsSel = React.useMemo(() => (onlyFav ? spreads.filter(s => !!s.favorite) : spreads), [spreads, onlyFav]);
  const positionsSel = React.useMemo(() => (onlyFav ? positions.filter(p => !!p.favorite) : positions), [positions, onlyFav]);

  // List of open option constructions: "Label YYYY-MM-DD · Nd"
  const openOptionConstructions = React.useMemo(() => {
    const out: string[] = [];
    const fmt = (ms: number | undefined) => {
      if (!(Number(ms) > 0)) return { date: '—', d: '—' };
      const date = new Date(Number(ms));
      const iso = date.toISOString().slice(0, 10);
      const days = Math.max(0, Math.floor((Number(ms) - Date.now()) / 86_400_000));
      return { date: iso, d: `${days}d` };
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
      out.push(`${label} ${date} · ${d}`);
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
      out.push(`${label} ${date} · ${d}`);
    });
    return out;
  }, [spreadsSel, positionsSel]);

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

  const toNumber = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const metrics = React.useMemo(() => {
    // Helpers
    const legMid = (symbol: string): number | undefined => {
      const t = tickers[symbol];
      const m = midPrice(t);
      return (m != null && isFinite(m)) ? Number(m) : undefined;
    };
    const isOptionSym = (sym: string) => String(sym || '').includes('-');

    // Realized PnL (sum of closeSnapshot.pnlExec for closed items)
    const realizedFromSpreads = spreadsSel.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realizedFromPositions = positionsSel.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realized = realizedFromSpreads + realizedFromPositions;

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
      const legs = Array.isArray(p.legs) ? p.legs.filter(L => !L.hidden) : [];
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
      const ml = Math.max(0, width - Number(p.cEnter)) * qty;
      return Number.isFinite(ml) ? ml : undefined;
    };
    const riskFromSpreads = spreadsSel.map(riskForSpread).filter((v): v is number => v != null).reduce((a,b)=>a+b,0);

    // Примерная оценка MaxLoss для произвольной позиции по payoff на экспирации
    const approxMaxLossForPosition = (p: typeof positions[number]): number | undefined => {
      if (p.closedAt) return undefined;
      const legs = Array.isArray(p.legs) ? p.legs.filter(L => !L.hidden) : [];
      if (!legs.length) return undefined;
      const Ks = Array.from(new Set(legs.map(L => Number(L.leg.strike) || 0).filter(s => isFinite(s) && s > 0))).sort((a,b)=>a-b);
      const netEntry = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);
      const intrinsicAt = (S: number) => {
        let signed = 0;
        for (const L of legs) {
          const isPerp = !String(L.leg.symbol || '').includes('-');
          if (isPerp) {
            // Перпы делают риск потенциально неограниченным; не считаем такую позицию в Risk
            return undefined;
          }
          const K = Number(L.leg.strike) || 0;
          const q = Number(L.qty) || 1;
          const sign = L.side === 'short' ? 1 : -1;
          const intrinsic = L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
          signed += sign * intrinsic * q;
        }
        return signed;
      };
      const S0 = 0;
      const Sbig = (Ks.length ? Ks[Ks.length - 1] : 1000) * 5 + 1;
      const candidates = [S0, ...Ks, Sbig];
      let minPnl = Infinity;
      for (const S of candidates) {
        const val = intrinsicAt(S);
        if (val == null) return undefined; // содержит перпы — пропускаем
        const pnl = netEntry - val;
        if (isFinite(pnl) && pnl < minPnl) minPnl = pnl;
      }
      return isFinite(minPnl) ? Math.max(0, -minPnl) : undefined;
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
      positionsSel.filter(p => !p.closedAt).forEach(p => p.legs.filter(L => !L.hidden).forEach(L => symbols.add(L.leg.symbol)));
      return Array.from(symbols);
    };
    const refresh = async () => {
      try {
        const [list, spot] = await Promise.all([
          fetchOptionTickers().catch(() => []),
          fetchSpotEth().catch(() => undefined),
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
            };
          });
          if (spot?.price != null && isFinite(spot.price) && needed.has('ETHUSDT')) {
            const price = Number(spot.price);
            const cur = next['ETHUSDT'] || {};
            next['ETHUSDT'] = { ...cur, markPrice: price, bid1Price: cur.bid1Price ?? price, ask1Price: cur.ask1Price ?? price };
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

  const fmtMoney = (v: number) => `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
  const pnlColor = metrics.realized > 0 ? 'var(--gain)' : (metrics.realized < 0 ? 'var(--loss)' : undefined);
  const upnlColor = metrics.unrealized > 0 ? 'var(--gain)' : (metrics.unrealized < 0 ? 'var(--loss)' : undefined);

  // removed Last Exit details from compact portfolio header

  return (
    <div>
      <h3>Portfolio</h3>
      <div className="grid" style={{ alignItems: 'end' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div>
            Deposit {fmtMoney(deposit)} · Realized <span style={pnlColor ? { color: pnlColor } : undefined}>{fmtMoney(metrics.realized)}</span> · UnRealized <span style={upnlColor ? { color: upnlColor } : undefined}>{fmtMoney(metrics.unrealized)}</span> · Risk {fmtMoney(metrics.openRisk)} ({metrics.riskShare.toFixed(1)}%)
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1', marginTop: 6 }}>
          <div className="muted">Open options ({openOptionConstructions.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {openOptionConstructions.length ? openOptionConstructions.map((line, idx) => (
              <div key={idx} style={{ fontFamily: 'monospace' }}>{line}</div>
            )) : <div className="muted">—</div>}
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
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
              <span className="muted">Only favorites</span>
            </label>
            <div style={{ marginLeft: 'auto' }} />
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
        )}
      </div>
    </div>
  );
}
