import React from 'react';
import { fetchHV30, fetchInstruments, fetchSpotEth, fetchOptionTickers } from '../services/bybit';
import { subscribeSpotTicker, subscribeOptionTicker } from '../services/ws';
import { useSlowMode } from '../contexts/SlowModeContext';

function formatPct(v?: number) {
  if (v == null || !isFinite(v)) return '—';
  const val = v <= 1.5 ? v * 100 : v; // normalize fractions like 0.65 -> 65%
  return `${val.toFixed(2)}%`;
}
function formatUsd(v?: number) {
  return v != null && isFinite(v) ? `$${v.toFixed(2)}` : '—';
}

export function MarketContextCard() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [spot, setSpot] = React.useState<{ price: number; change24h?: number } | null>(null);
  const [atmIv, setAtmIv] = React.useState<number | undefined>();
  const [hv30, setHv30] = React.useState<number | undefined>();
  const [dte, setDte] = React.useState<number | undefined>();
  const [expiry, setExpiry] = React.useState<number | undefined>();
  const atmSubRef = React.useRef<() => void>();
  const { slowMode, register } = useSlowMode();
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (atmSubRef.current) {
        atmSubRef.current();
        atmSubRef.current = undefined;
      }
    };
  }, []);

  const extractHv = React.useCallback((stats?: { latest?: number }) => {
    if (!stats || stats.latest == null || !isFinite(stats.latest)) return undefined;
    return Math.abs(stats.latest) <= 5 ? stats.latest * 100 : stats.latest;
  }, []);

  const refreshMarket = React.useCallback(async () => {
    try {
      const [instr, hv, spotSnapshot, tickers] = await Promise.all([
        fetchInstruments(),
        fetchHV30(),
        fetchSpotEth(),
        fetchOptionTickers(),
      ]);
      if (!mountedRef.current) return;
      const hvVal = extractHv(hv);
      if (hvVal != null) setHv30(hvVal);
      setSpot(spotSnapshot);
      const future = instr.filter((i) => i.deliveryTime > Date.now()).sort((a, b) => a.deliveryTime - b.deliveryTime);
      const nearest = future[0];
      if (nearest) {
        setExpiry(nearest.deliveryTime);
        const msLeft = nearest.deliveryTime - Date.now();
        setDte(Math.max(0, Math.round(msLeft / (1000 * 60 * 60 * 24))));
        const expSymbols = new Set(instr.filter(i => i.deliveryTime === nearest.deliveryTime).map(i => i.symbol));
        const chain = tickers.filter(t => expSymbols.has(t.symbol));
        if (chain.length) {
          const best = chain
            .map((t) => ({ t, strike: Number(t.symbol.split('-')[2]) }))
            .filter((x) => Number.isFinite(x.strike))
            .sort((a, b) => Math.abs(a.strike - spotSnapshot.price) - Math.abs(b.strike - spotSnapshot.price))[0]?.t;
          if (best?.markIv != null) setAtmIv(Number(best.markIv));
        }
      } else {
        setExpiry(undefined);
        setDte(undefined);
      }
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to refresh market data');
      }
      throw err;
    }
  }, [extractHv]);

  React.useEffect(() => {
    return register(() => refreshMarket());
  }, [refreshMarket, register]);

  React.useEffect(() => {
    if (!slowMode) return;
    refreshMarket().catch(() => {});
  }, [refreshMarket, slowMode]);

  // Init: fetch snapshot immediately
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refreshMarket();
      } catch {}
      finally {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMarket]);

  // Live spot via WS (ETHUSDT on spot channel)
  React.useEffect(() => {
    if (slowMode) return;
    const off = subscribeSpotTicker('ETHUSDT', (t) => {
      const last = t.lastPrice ?? t.markPrice ?? t.bid1Price ?? t.ask1Price;
      const pct = t.price24hPcnt != null ? t.price24hPcnt * 100 : undefined;
      if (last != null) setSpot({ price: last, change24h: pct });
    });
    return () => off();
  }, [slowMode]);

  // Recompute DTE every hour quietly
  React.useEffect(() => {
    if (!expiry) return;
    const id = setInterval(() => {
      const msLeft = expiry - Date.now();
      setDte(Math.max(0, Math.round(msLeft / (1000 * 60 * 60 * 24))));
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [expiry]);

  // Subscribe to ATM symbol for IV, tracking when underlying crosses strike boundaries
  React.useEffect(() => {
    if (slowMode) {
      if (atmSubRef.current) {
        atmSubRef.current();
        atmSubRef.current = undefined;
      }
      return;
    }
    if (!expiry || !spot?.price) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const instr = await fetchInstruments();
        if (cancelled) return;
        const chain = instr.filter(i => i.deliveryTime === expiry);
        if (!chain.length) return;
        const nearest = chain
          .map(i => ({ i, d: Math.abs(i.strike - spot.price) }))
          .sort((a,b) => a.d - b.d)[0]?.i;
        if (!nearest) return;
        if (atmSubRef.current) atmSubRef.current();
        stop = subscribeOptionTicker(nearest.symbol, (t) => {
          if (t.markIv != null) setAtmIv(t.markIv);
        });
        atmSubRef.current = stop;
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }, [expiry, slowMode, spot?.price]);

  // Fallback: if HV30 is unavailable, show ATM IV as proxy to avoid dash
  React.useEffect(() => {
    if (hv30 == null && atmIv != null) setHv30(atmIv);
  }, [hv30, atmIv]);

  // Refresh HV30 periodically (every 10 min)
  React.useEffect(() => {
    if (slowMode) return;
    const id = setInterval(async () => {
      try {
        const hv = await fetchHV30();
        const hvVal = extractHv(hv);
        if (hvVal != null) setHv30(hvVal);
      } catch {}
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [extractHv, slowMode]);

  return (
    <div>
      <h3>Market</h3>
      {loading ? (
        <div className="muted">Loading market context…</div>
      ) : error ? (
        <div className="muted">Error: {error}</div>
      ) : (
        <div className="grid">
          <div>
            <div className="muted">ETH Spot</div>
            <div>{formatUsd(spot?.price)} {spot?.change24h != null && (<span className="muted">({spot.change24h.toFixed(2)}%)</span>)}</div>
          </div>
          <div>
            <div className="muted">ATM IV</div>
            <div>{formatPct(atmIv)}</div>
          </div>
          <div>
            <div className="muted">HV 30d</div>
            <div>{formatPct(hv30)}</div>
          </div>
          <div>
            <div className="muted">Nearest DTE</div>
            <div>{dte != null ? `${dte}d` : '—'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
