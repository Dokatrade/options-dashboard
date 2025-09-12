import React from 'react';
import type { PositionLeg } from '../utils/types';
import { subscribeOptionTicker } from '../services/ws';
import { midPrice, fetchHV30 } from '../services/bybit';
import { bsPrice, bsImpliedVol } from '../utils/bs';

type Props = {
  legs: PositionLeg[];
  createdAt: number;
  note?: string;
  title?: string;
  onClose: () => void;
};

export function PositionView({ legs, createdAt, note, title, onClose }: Props) {
  // Lock initial X-domain to ±50% around current spot (if available) to prevent re-centering
  const baseDomainRef = React.useRef<{ minX: number; maxX: number } | null>(null);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [showT0, setShowT0] = React.useState(true);
  const [showExpiry, setShowExpiry] = React.useState(true);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = React.useState<{ S: number; pnlExpiry: number; pnlNow?: number } | null>(null);
  const [ivShift, setIvShift] = React.useState(0); // proportion
  const [rPct, setRPct] = React.useState(0);
  const [timePos, setTimePos] = React.useState(0); // 0..1 (today -> expiry)
  const [clock, setClock] = React.useState(0); // timer to refresh min allowed time
  const [hv30, setHv30] = React.useState<number | undefined>();
  const [graphHover, setGraphHover] = React.useState(false);
  const [xZoom, setXZoom] = React.useState(1); // default: show exactly ±50% around spot at open
  const [yZoom, setYZoom] = React.useState(1);
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
    } catch {}
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem('position-view-ui-v1', JSON.stringify({ showT0, showExpiry, ivShift, rPct, timePos, xZoom, yZoom })); } catch {}
  }, [showT0, showExpiry, ivShift, rPct, timePos, xZoom, yZoom]);

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
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('position-view-ui-bypos-v1');
      const map = raw ? JSON.parse(raw) : {};
      map[viewKey] = { xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry };
      localStorage.setItem('position-view-ui-bypos-v1', JSON.stringify(map));
    } catch {}
  }, [viewKey, xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry]);

  // (Reset view handler removed per request)

  // Tick every minute to bump min allowed time (cannot move into past)
  React.useEffect(() => {
    const id = setInterval(() => setClock(c => (c + 1) % 1_000_000), 60_000);
    return () => clearInterval(id);
  }, []);

  // Minimum allowed time position based on days already passed (createdAt → latest expiry)
  const minTimePos = React.useMemo(() => {
    const expiries = legs.map(L => Number(L.leg.expiryMs)).filter(Boolean);
    if (!expiries.length) return 0;
    const latest = Math.max(...expiries);
    const start = Math.min(createdAt || Date.now(), latest);
    const total = Math.max(1, latest - start);
    const elapsed = Math.max(0, Math.min(Date.now() - start, total));
    return Math.max(0, Math.min(1, elapsed / total));
  }, [legs, createdAt, clock]);

  // Zero-DTE flag (calendar day of expiry): snap slider to the end
  const isZeroDTE = React.useMemo(() => {
    const expiries = legs.map(L => Number(L.leg.expiryMs)).filter(Boolean);
    if (!expiries.length) return false;
    const latest = Math.max(...expiries);
    const dteDays = Math.floor((latest - Date.now()) / 86_400_000);
    return dteDays <= 0;
  }, [legs, clock]);

  // Effective time position used in calculations
  const effTimePos = isZeroDTE ? 1 : Math.max(minTimePos, Math.max(0, Math.min(1, timePos)));

  React.useEffect(() => {
    const symbols = Array.from(new Set(legs.map(l => l.leg.symbol)));
    const unsubs = symbols.slice(0, 300).map(sym => subscribeOptionTicker(sym, (t) => setTickers(prev => ({ ...prev, [t.symbol]: { ...(prev[t.symbol] || {}), ...t } }))));
    return () => { unsubs.forEach(u => u()); };
  }, [legs]);

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
    fetchHV30().then(v => { if (m) setHv30(v); }).catch(()=>{});
    return () => { m = false; };
  }, []);
  // Spot price comes from option index price (per-leg underlying)


  const calc = React.useMemo(() => {
    const det = legs.map((L) => {
      const t = tickers[L.leg.symbol] || {};
      const bid = t?.bid1Price != null ? Number(t.bid1Price) : undefined;
      const ask = t?.ask1Price != null ? Number(t.ask1Price) : undefined;
      const mid = midPrice(t) ?? 0;
      const iv = t?.markIv != null ? Number(t.markIv) : undefined;
      const dRaw = t?.delta != null ? Number(t.delta) : undefined;
      const vRaw = t?.vega != null ? Number(t.vega) : undefined;
      const thRaw = t?.theta != null ? Number(t.theta) : undefined;
      const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
      const sgn = L.side === 'long' ? 1 : -1;
      return { L, bid, ask, mid, iv, d: dRaw != null ? sgn * dRaw : undefined, v: vRaw != null ? sgn * vRaw : undefined, th: thRaw != null ? sgn * thRaw : undefined, oi };
    });
    const netEntry = det.reduce((a, x) => a + (x.L.side === 'short' ? 1 : -1) * x.L.entryPrice * x.L.qty, 0);
    const netMid = det.reduce((a, x) => a + (x.L.side === 'short' ? 1 : -1) * x.mid * x.L.qty, 0);
    const pnl = netEntry - netMid;
    const greeks = det.reduce((a, x) => ({
      delta: a.delta + (x.d ?? 0) * x.L.qty,
      vega: a.vega + (x.v ?? 0) * x.L.qty,
      theta: a.theta + (x.th ?? 0) * x.L.qty,
    }), { delta: 0, vega: 0, theta: 0 });
    const dtes = Array.from(new Set(legs.map(L => L.leg.expiryMs))).map(ms => Math.max(0, Math.round((ms - Date.now()) / 86400000)));
    const dteLabel = dtes.length ? (dtes.length === 1 ? `${dtes[0]}d` : `${Math.min(...dtes)}–${Math.max(...dtes)}d`) : '—';
    // Spot proxy from any leg's indexPrice
    const spot = (() => {
      for (const L of legs) {
        const t = tickers[L.leg.symbol];
        if (t?.indexPrice != null) return Number(t.indexPrice);
      }
      return undefined;
    })();
    return { det, netEntry, netMid, pnl, greeks, dteLabel, spot };
  }, [legs, tickers]);

  // Expiry payoff chart (PnL vs S)
  const payoff = React.useMemo(() => {
    const strikes = legs.map(l => l.leg.strike);
    const Kmin = Math.min(...strikes);
    const Kmax = Math.max(...strikes);
    if (!baseDomainRef.current) {
      const spotVal = calc.spot != null && isFinite(calc.spot) ? Number(calc.spot) : undefined;
      if (spotVal != null && spotVal > 0) {
        const mMin = Math.max(0.01, spotVal * 0.5);
        const mMax = spotVal * 1.5;
        baseDomainRef.current = { minX: mMin, maxX: mMax };
      } else {
        // Fallback: center by strikes
        const uniqK = Array.from(new Set(strikes.map(Number)));
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
      for (const L of legs) {
        const K = L.leg.strike;
        const qty = Number(L.qty) || 1;
        const sign = L.side === 'short' ? 1 : -1;
        const intrinsic = L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
        signedVal += sign * intrinsic * qty;
      }
      return netEntry - signedVal;
    };
    const W = 640, H = 300, Lm = 44, Rm = 14, Tm = 12, Bm = 36;
    const x0 = Lm, x1 = W - Rm, y0 = Tm, y1 = H - Bm;
    const xs: number[] = [];
    const N = 120;
    for (let i = 0; i <= N; i++) xs.push(minX + (i / N) * (maxX - minX));
    const expVals = xs.map(S => valueAt(S));
    // Compute T+0 raw values separately; Y-scaling will prioritize expiry structure for clarity
    const tNow = Date.now();
    const latestMs = Math.max(...legs.map(L => Number(L.leg.expiryMs)));
    // Anchor so that model equals actual PnL at current spot
    let anchorOffset = 0;
    if (latestMs > 0 && tNow < latestMs && calc.spot != null && isFinite(calc.spot)) {
      const S0 = Number(calc.spot);
      let v0 = 0;
      for (const L of legs) {
        const t = tickers[L.leg.symbol] || {};
        const baseIvPct = t?.markIv != null ? Number(t.markIv) : (hv30 != null ? hv30 : 60);
        const sigma = Math.max(0.0001, (baseIvPct * (1 + ivShift)) / 100);
        const Tfull = Math.max(0, (Number(L.leg.expiryMs) - tNow) / (365 * 24 * 60 * 60 * 1000));
        const T = Math.max(0, Tfull * (1 - Math.min(1, Math.max(0, effTimePos))));
        const price = bsPrice(L.leg.optionType, S0, Number(L.leg.strike) || 0, T, sigma, rPct / 100);
        const sign = L.side === 'short' ? 1 : -1;
        v0 += sign * price * (Number(L.qty) || 1);
      }
      const model0 = calc.netEntry - v0;
      const actual0 = calc.netEntry - calc.netMid;
      if (isFinite(model0) && isFinite(actual0)) anchorOffset = (actual0 - model0) * (1 - Math.min(1, Math.max(0, effTimePos)));
    }
    const dteDays0 = Math.floor((latestMs - tNow) / 86_400_000);
    const nowVals = (latestMs > 0 && dteDays0 > 0) ? xs.map(S => {
      let valNow = 0;
      for (const L of legs) {
        const t = tickers[L.leg.symbol] || {};
        const baseIvPct = t?.markIv != null ? Number(t.markIv) : (hv30 != null ? hv30 : 60);
        const sigma = Math.max(0.0001, (baseIvPct * (1 + ivShift)) / 100);
        const Tfull = Math.max(0, (Number(L.leg.expiryMs) - tNow) / (365 * 24 * 60 * 60 * 1000));
        const T = Math.max(0, Tfull * (1 - Math.min(1, Math.max(0, effTimePos))));
        const price = bsPrice(L.leg.optionType, S, Number(L.leg.strike) || 0, T, sigma, rPct / 100);
        const sign = L.side === 'short' ? 1 : -1;
        valNow += sign * price * (Number(L.qty) || 1);
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
    const Ks = Array.from(new Set(strikes.map(Number))).sort((a, b) => a - b);
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
  }, [legs, calc.netEntry, tickers, ivShift, effTimePos, rPct, hv30, xZoom, yZoom]);

  // Screenshot functionality removed per request

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:70}}>
      <div style={{background:'var(--card)', color:'var(--fg)', border:'1px solid var(--border)', borderRadius:12, width:900, maxWidth:'95%', maxHeight:'90%', overflow:'auto', overscrollBehavior:'contain'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)'}}>
          <strong>{title || 'Position View'}</strong>
          <div style={{display:'flex', gap:8}}>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div style={{padding:12}}>
          <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap'}}>
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
                const expiries = legs.map(L => Number(L.leg.expiryMs)).filter(Boolean);
                if (!expiries.length) return 'DTE: —';
                const tNow = Date.now();
                const latest = Math.max(...expiries);
                const targetTime = tNow + effTimePos * Math.max(0, latest - tNow);
                const ds = expiries.map(ms => Math.max(0, Math.round((ms - targetTime) / 86_400_000)));
                const d = ds.length ? Math.max(...ds) : 0; // show remaining to latest expiry at target time
                return `DTE: ${d}d`;
              })()}</span>
            </div>
          </div>
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
                   for (const L of legs) {
                     const K = Number(L.leg.strike) || 0; const q = Number(L.qty) || 1; const sign = L.side === 'short' ? 1 : -1;
                     const intrinsic = L.leg.optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
                     signedVal += sign * intrinsic * q;
                   }
                   return netEntry - signedVal;
                 })();
                 const pnlNow = (()=>{
                   const latestMs = Math.max(...legs.map(L => Number(L.leg.expiryMs)));
                   if (!(latestMs > 0) || Date.now() >= latestMs) return undefined;
                   let valNow = 0; const tNow = Date.now();
                   for (const L of legs) {
                     const t = tickers[L.leg.symbol] || {};
                     const baseIvPct = t?.markIv != null ? Number(t.markIv) : (hv30 != null ? hv30 : 60);
                     const sigma = Math.max(0.0001, (baseIvPct * (1 + ivShift)) / 100);
                     const Tfull = Math.max(0, (Number(L.leg.expiryMs) - tNow) / (365 * 24 * 60 * 60 * 1000));
                     const T = Math.max(0, Tfull * (1 - Math.min(1, Math.max(0, effTimePos))));
                     const price = bsPrice(L.leg.optionType, S, Number(L.leg.strike) || 0, T, sigma, rPct / 100);
                     const sign = L.side === 'short' ? 1 : -1;
                     valNow += sign * price * (Number(L.qty) || 1);
                   }
                   // Anchor offset so crosshair 'Today' value matches actual PnL at spot,
                   // and decays to 0 as we approach expiry
                   let offset = 0;
                   if (calc.spot != null && isFinite(calc.spot)) {
                     const S0 = Number(calc.spot);
                     let v0 = 0; const tNow2 = Date.now();
                     for (const L of legs) {
                       const t = tickers[L.leg.symbol] || {};
                       const baseIvPct = t?.markIv != null ? Number(t.markIv) : (hv30 != null ? hv30 : 60);
                       const sigma = Math.max(0.0001, (baseIvPct * (1 + ivShift)) / 100);
                       const Tfull = Math.max(0, (Number(L.leg.expiryMs) - tNow2) / (365 * 24 * 60 * 60 * 1000));
                       const T = Math.max(0, Tfull * (1 - Math.min(1, Math.max(0, effTimePos))));
                       const price = bsPrice(L.leg.optionType, S0, Number(L.leg.strike) || 0, T, sigma, rPct / 100);
                       const sign = L.side === 'short' ? 1 : -1;
                       v0 += sign * price * (Number(L.qty) || 1);
                     }
                     const modelPnL0 = calc.netEntry - v0;
                     const actualPnL0 = calc.netEntry - calc.netMid;
                     if (isFinite(modelPnL0) && isFinite(actualPnL0)) offset = (actualPnL0 - modelPnL0) * (1 - Math.min(1, Math.max(0, effTimePos)));
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
              const pnlStr = isFinite(calc.pnl) ? `$${calc.pnl.toFixed(2)}` : '—';
              return (
                <g>
                  <text x={x} y={y} fontSize="12" fill="var(--fg)">Spot: {spotStr}</text>
                  <text x={x} y={y + dy} fontSize="12" fill="var(--fg)">PnL: {pnlStr}</text>
                </g>
              );
            })()}
            {/* Strike markers */}
            {Array.from(new Set(legs.map(l => Number(l.leg.strike) || 0))).map((K, i) => (
              <line key={i} x1={payoff.xScale(K)} y1={payoff.y0} x2={payoff.xScale(K)} y2={payoff.y1} stroke="#9aa0a6" strokeDasharray="3 3" />
            ))}
            {/* Per-leg markers at top to reflect option legs */}
            {(() => {
              const byK: Record<string, { K: number; items: { side: 'long'|'short'; type: 'C'|'P'; qty: number }[] }> = {};
              legs.forEach(L => {
                const K = Number(L.leg.strike) || 0;
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
                    const sign = (isFinite(calc.pnl) && calc.pnl > 0) ? '-' : '';
                    const shown = `${sign}${diffPct.toFixed(2)}%`;
                    const tx = p.x - 6;
                    const ty = payoff.y0 + (payoff.y1 - payoff.y0) * 0.72; // 28% above bottom
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

          {/* Zoom controls removed by request; default X zoom set to 0.5 */}

          <div className="grid" style={{gridTemplateColumns:'repeat(10, minmax(90px, max-content))', gap:3, marginBottom: 6, fontSize:'calc(1em - 2px)'}}>
            {/* Core meta */}
            <div><div className="muted">Created</div><div>{new Date(createdAt).toISOString().slice(0,10)}</div></div>
            <div><div className="muted">DTE</div><div>{calc.dteLabel}</div></div>
            {/* Width (if available) */}
            {(() => {
              const exps = Array.from(new Set(legs.map(L => Number(L.leg.expiryMs) || 0)));
              if (exps.length === 1) {
                const Ks = Array.from(new Set(legs.map(L => Number(L.leg.strike) || 0))).sort((a,b)=>a-b);
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
            <div><div className="muted">PnL ($)</div><div>{calc.pnl.toFixed(2)}</div></div>
            {/* Greeks after net figures */}
            <div><div className="muted">Δ (Delta)</div><div>{calc.greeks.delta.toFixed(3)}</div></div>
            <div><div className="muted">Vega</div><div>{calc.greeks.vega.toFixed(3)}</div></div>
            <div><div className="muted">Θ (Theta)</div><div>{calc.greeks.theta.toFixed(3)}</div></div>
            {note && <div style={{gridColumn:'1 / -1'}}><div className="muted">Note</div><div>{note}</div></div>}
          </div>

          <div className="grid" style={{gap: 6}}>
            {calc.det.map((x) => (
              <div key={x.L.leg.symbol} style={{border: '1px solid var(--border)', borderRadius: 8, padding: 6, fontSize: 'calc(1em - 3px)'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 2}}>
                  <div style={{fontSize:'calc(1em + 2px)'}}><strong>{x.L.side}</strong> {x.L.leg.optionType} {x.L.leg.strike} × {x.L.qty}</div>
                  <div className="muted" style={{fontSize:'calc(1em + 2px)'}}>{new Date(x.L.leg.expiryMs).toISOString().slice(0,10)}</div>
                </div>
                {/* Two-row grid with Symbol spanning both rows */}
                <div className="grid" style={{gridTemplateColumns:'2fr repeat(5, minmax(0,1fr))', gap: 6}}>
                  {/* Symbol spans 2 rows */}
                  <div style={{paddingRight:12, gridRow:'1 / span 2'}}>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Symbol</div>
                    <div title={x.L.leg.symbol} style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word'}}>{x.L.leg.symbol}</div>
                  </div>
                  {/* Row 1 cells */}
                  <div style={{paddingRight:8}}>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, whiteSpace:'nowrap', fontWeight:600}}>Bid / Ask</div>
                    <div>{x.bid != null ? x.bid.toFixed(2) : '—'} / {x.ask != null ? x.ask.toFixed(2) : '—'}</div>
                  </div>
                  <div style={{marginLeft:8}}>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Mid</div>
                    <div>{x.mid != null ? x.mid.toFixed(2) : '—'}</div>
                  </div>
                  <div style={{paddingRight:8}}>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, whiteSpace:'nowrap', fontWeight:600}}>Entry @</div>
                    <div>{isFinite(x.L.entryPrice) ? `$${x.L.entryPrice.toFixed(2)}` : '—'}</div>
                  </div>
                  {(() => { const sgn = x.L.side === 'short' ? 1 : -1; const entry = Number(x.L.entryPrice); const mid = x.mid; const qty = Number(x.L.qty) || 1; const pnl = (isFinite(entry) && mid != null && isFinite(mid)) ? sgn * (entry - mid) * qty : undefined; return (
                    <div style={{marginLeft:8}}>
                      <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>PnL ($)</div>
                      <div>{pnl != null ? pnl.toFixed(2) : '—'}</div>
                    </div>
                  ); })()}
                  <div>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>IV %</div>
                    <div>{(() => {
                      // Prefer Bybit markIv (matches UI). Fallbacks: implied from markPrice, then order book average IV, then Mid IV, then HV30
                      const t = tickers[x.L.leg.symbol] || {};
                      const markIv = t?.markIv != null ? Number(t.markIv) : (x.iv != null ? Number(x.iv) : undefined);
                      if (markIv != null && isFinite(markIv)) return markIv.toFixed(1);
                      const S = t?.indexPrice != null ? Number(t.indexPrice) : (calc.spot != null ? Number(calc.spot) : undefined);
                      const K = Number(x.L.leg.strike) || 0;
                      const T = Math.max(0, (Number(x.L.leg.expiryMs) - Date.now()) / (365 * 24 * 60 * 60 * 1000));
                      // Try fair price (markPrice) first — this is what Bybit displays near IV
                      const markPrice = t?.markPrice != null ? Number(t.markPrice) : undefined;
                      if (S != null && isFinite(S) && K > 0 && T > 0 && markPrice != null && isFinite(markPrice) && markPrice >= 0) {
                        const iv = bsImpliedVol(x.L.leg.optionType, S, K, T, markPrice, rPct / 100);
                        if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
                      }
                      let ivFromBook: number | undefined;
                      if (S != null && isFinite(S) && K > 0 && T > 0) {
                        const bid = t?.bid1Price != null ? Number(t.bid1Price) : undefined;
                        const ask = t?.ask1Price != null ? Number(t.ask1Price) : undefined;
                        const ivBid = (bid != null && isFinite(bid) && bid >= 0) ? bsImpliedVol(x.L.leg.optionType, S, K, T, bid, rPct / 100) : undefined;
                        const ivAsk = (ask != null && isFinite(ask) && ask >= 0) ? bsImpliedVol(x.L.leg.optionType, S, K, T, ask, rPct / 100) : undefined;
                        if (ivBid != null && isFinite(ivBid) && ivAsk != null && isFinite(ivAsk)) ivFromBook = 0.5 * (ivBid + ivAsk);
                        else if (ivBid != null && isFinite(ivBid)) ivFromBook = ivBid;
                        else if (ivAsk != null && isFinite(ivAsk)) ivFromBook = ivAsk;
                      }
                      if (ivFromBook != null && isFinite(ivFromBook)) return (ivFromBook * 100).toFixed(1);
                      const mid = x.mid != null ? Number(x.mid) : undefined;
                      if (S != null && isFinite(S) && K > 0 && T > 0 && mid != null && isFinite(mid) && mid >= 0) {
                        const iv = bsImpliedVol(x.L.leg.optionType, S, K, T, mid, rPct / 100);
                        if (iv != null && isFinite(iv)) return (iv * 100).toFixed(1);
                      }
                      const v = hv30;
                      return v != null && isFinite(v) ? Number(v).toFixed(1) : '—';
                    })()}</div>
                  </div>
                  {/* Row 2 cells */}
                  <div>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Δ (Delta)</div>
                    <div>{x.d != null ? x.d.toFixed(3) : '—'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Vega</div>
                    <div>{x.v != null ? x.v.toFixed(3) : '—'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Θ (Theta)</div>
                    <div>{x.th != null ? x.th.toFixed(3) : '—'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>OI</div>
                    <div>{x.oi != null ? x.oi : '—'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Export buttons removed */}
        </div>
      </div>
    </div>
  );
}
