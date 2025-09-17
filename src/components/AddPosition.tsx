import React from 'react';
import { fetchInstruments, fetchOptionTickers, midPrice, bestBidAsk, fetchOrderbookL1 } from '../services/bybit';
import { subscribeOptionTicker, subscribeSpotTicker } from '../services/ws';
import { useStore } from '../store/store';
import type { InstrumentInfo, Leg, OptionType, SpreadPosition } from '../utils/types';
import { ensureUsdtSymbol } from '../utils/symbols';

type DraftLeg = {
  leg: Leg;
  side: 'short' | 'long';
  qty: number;
};

function dteFrom(ms: number) {
  return Math.max(0, Math.round((ms - Date.now()) / (1000 * 60 * 60 * 24)));
}

export function AddPosition() {
  const addSpread = useStore((s) => s.addSpread);
  const addPosition = useStore((s) => s.addPosition);
  const [loading, setLoading] = React.useState(false);
  const [instruments, setInstruments] = React.useState<InstrumentInfo[]>([]);
  const [optType, setOptType] = React.useState<OptionType>('P');
  const [expiry, setExpiry] = React.useState<number | ''>('');
  const [chain, setChain] = React.useState<InstrumentInfo[]>([]);
  const [strike, setStrike] = React.useState<string>('');
  const [qty, setQty] = React.useState<number>(1);
  const [draft, setDraft] = React.useState<DraftLeg[]>([]);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [deltaMin, setDeltaMin] = React.useState<number>(0.15);
  const [deltaMax, setDeltaMax] = React.useState<number>(0.30);
  const [minOI, setMinOI] = React.useState<number>(0);
  const [maxSpread, setMaxSpread] = React.useState<number>(9999);
  const [showAllStrikes, setShowAllStrikes] = React.useState<boolean>(false);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchInstruments()
      .then((list) => {
        if (!mounted) return;
        const onlyActive = list.filter((i) => i.deliveryTime > Date.now() && isFinite(i.strike));
        setInstruments(onlyActive);
      })
      .finally(() => setLoading(false));
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    const monthCodes = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const expiryCode = (ms: number): string => {
      const d = new Date(ms);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const m = monthCodes[d.getUTCMonth()];
      const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
      return `${dd}${m}${yy}`;
    };
    const mk = (exp: number | '', type: OptionType) => {
      if (!exp) return [] as InstrumentInfo[];
      const base = instruments
        .filter((i) => i.deliveryTime === exp && i.optionType === type)
        .sort((a, b) => a.strike - b.strike);
      // Union with tickers-derived symbols for this expiry if any are missing (Bybit occasionally skips items in instruments-info)
      try {
        const code = expiryCode(exp as number);
        const seen = new Set(base.map(i => i.symbol));
        const extras: InstrumentInfo[] = [];
        Object.keys(tickers || {}).forEach(sym => {
          if (!sym.includes(`-${code}-`)) return;
          const parts = sym.split('-');
          const optPart = (parts?.[3] || '').toUpperCase();
          if (!optPart.startsWith(type)) return;
          if (seen.has(sym)) return;
          const strike = Number(parts?.[2]);
          if (!Number.isFinite(strike)) return;
          const settleCoin = parts?.[4] ? parts[4].toUpperCase() : 'USDT';
          extras.push({ symbol: ensureUsdtSymbol(sym), strike, optionType: type, deliveryTime: exp as number, settleCoin });
        });
        if (extras.length) {
          const merged = [...base, ...extras].sort((a,b)=>a.strike - b.strike);
          return merged;
        }
      } catch {}
      return base;
    };
    setChain(mk(expiry, optType));
  }, [expiry, instruments, optType, tickers]);

  React.useEffect(() => {
    let m = true;
    fetchOptionTickers().then((list) => { if (!m) return; setTickers(Object.fromEntries(list.map(t => [t.symbol, t]))); });
    return () => { m = false; };
  }, []);

  // REST L1 fallback for visible chain symbols
  React.useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const syms = Array.from(new Set([...chain.map(i=>i.symbol), ...draft.map(d=>d.leg.symbol)])).slice(0, 200);
      for (const sym of syms) {
        if (stopped) return;
        try {
          const { bid, ask } = await fetchOrderbookL1(sym);
          if (bid != null || ask != null) setTickers(prev => ({ ...prev, [sym]: { ...(prev[sym] || {}), obBid: bid, obAsk: ask } }));
        } catch {}
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { stopped = true; clearInterval(id); };
  }, [chain, draft]);

  // Load draft from localStorage
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('options-draft-v1');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.optType === 'P' || d?.optType === 'C') setOptType(d.optType);
      if (typeof d?.expiry === 'number' || d?.expiry === '') setExpiry(d.expiry);
      if (typeof d?.strike === 'string') setStrike(d.strike);
      if (typeof d?.qty === 'number') setQty(d.qty);
      if (typeof d?.deltaMin === 'number') setDeltaMin(d.deltaMin);
      if (typeof d?.deltaMax === 'number') setDeltaMax(d.deltaMax);
      if (typeof d?.minOI === 'number') setMinOI(d.minOI);
      if (typeof d?.maxSpread === 'number') setMaxSpread(d.maxSpread);
      if (typeof d?.showAllStrikes === 'boolean') setShowAllStrikes(d.showAllStrikes);
      if (Array.isArray(d?.draft)) {
          const legs = d.draft.map((L: any) => ({
          leg: {
            symbol: ensureUsdtSymbol(String(L?.leg?.symbol || '')),
            strike: Number(L?.leg?.strike) || 0,
            optionType: L?.leg?.optionType === 'P' ? 'P' : 'C',
            expiryMs: Number(L?.leg?.expiryMs) || 0,
          },
          side: L?.side === 'long' ? 'long' : 'short',
          qty: Math.max(0.1, Number(L?.qty) || 1),
        })).filter((L: any) => L.leg.symbol);
        setDraft(legs);
      }
    } catch {}
  }, []);

  // Save draft to localStorage (debounced)
  React.useEffect(() => {
    const id = setTimeout(() => {
      const payload = {
        optType, expiry, strike, qty,
        deltaMin, deltaMax, minOI, maxSpread, showAllStrikes,
        draft,
      };
      try { localStorage.setItem('options-draft-v1', JSON.stringify(payload)); } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [optType, expiry, strike, qty, deltaMin, deltaMax, minOI, maxSpread, draft]);

  // Live pricing in dropdown and draft
  React.useEffect(() => {
    const symbols = new Set<string>();
    chain.forEach(i => symbols.add(i.symbol));
    draft.forEach(d => symbols.add(d.leg.symbol));
    const unsubs = Array.from(symbols).slice(0, 400).map(sym => {
      const isOption = sym.includes('-');
      const sub = isOption ? subscribeOptionTicker : subscribeSpotTicker;
      return sub(sym, (t) => setTickers((prev) => {
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
  }, [chain, draft]);

  const expiries = Array.from(new Set(instruments.filter(i => i.optionType === optType).map(i => i.deliveryTime))).sort((a, b) => a - b);
  const filteredChain = React.useMemo(() => {
    if (showAllStrikes) return chain;
    return chain.filter((i) => {
      const t = tickers[i.symbol] || {};
      const d = t?.delta != null ? Math.abs(Number(t.delta)) : undefined;
      const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
      const b = t?.bid1Price, a = t?.ask1Price;
      const spr = b != null && a != null ? Math.max(0, Number(a) - Number(b)) : undefined;
      const dOk = d == null ? true : (d >= deltaMin && d <= deltaMax);
      const oiOk = oi == null ? true : (oi >= minOI);
      const spOk = spr == null ? true : (spr <= maxSpread);
      return dOk && oiOk && spOk;
    });
  }, [chain, tickers, deltaMin, deltaMax, minOI, maxSpread, showAllStrikes]);

  const addLeg = (side: 'short' | 'long') => {
    const inst = chain.find(c => c.symbol === strike);
    if (!inst) return;
    const leg: Leg = { symbol: inst.symbol, strike: inst.strike, optionType: inst.optionType, expiryMs: inst.deliveryTime };
    const q = Math.max(0.1, Math.round(Number(qty) * 10) / 10);
    setDraft((d) => [...d, { leg, side, qty: q }]);
  };

  const addPerpLeg = (side: 'short' | 'long') => {
    const q = Math.max(0.1, Math.round(Number(qty) * 10) / 10);
    // Represent Perp as spot symbol with empty option fields
    const leg: Leg = { symbol: 'ETHUSDT', strike: 0, optionType: 'C', expiryMs: 0 } as any;
    setDraft((d) => [...d, { leg, side, qty: q }]);
  };

  const removeLeg = (idx: number) => setDraft((d) => d.filter((_, i) => i !== idx));

  const totalCreditPer = React.useMemo(() => {
    return draft.reduce((acc, d) => {
      const t = tickers[d.leg.symbol];
      const m = midPrice(t);
      const sign = d.side === 'short' ? 1 : -1;
      if (m == null) return acc;
      return acc + sign * m * d.qty;
    }, 0);
  }, [draft, tickers]);

  const canSaveAsVertical = React.useMemo(() => {
    if (draft.length !== 2) return false;
    const [a, b] = draft;
    return (
      a.leg.optionType === b.leg.optionType &&
      a.leg.expiryMs === b.leg.expiryMs &&
      ((a.side === 'short' && b.side === 'long') || (a.side === 'long' && b.side === 'short')) &&
      a.qty === b.qty
    );
  }, [draft]);

  const onSave = () => {
    if (canSaveAsVertical) {
      const [a, b] = draft;
      const short = a.side === 'short' ? a : b;
      const long = a.side === 'long' ? a : b;
      const qty = short.qty; // equal by guard
      // cEnter per contract = mid(short) - mid(long)
      const mShort = midPrice(tickers[short.leg.symbol]) ?? 0;
      const mLong = midPrice(tickers[long.leg.symbol]) ?? 0;
      const cEnter = mShort - mLong;
      const payload: Omit<SpreadPosition, 'id' | 'createdAt' | 'closedAt'> = {
        short: short.leg,
        long: long.leg,
        cEnter,
        // Store per-leg entry prices so single-leg view shows correct values
        entryShort: mShort,
        entryLong: mLong,
        qty,
        note: `Built via Add Position (${qty}x)`
      };
      addSpread(payload);
      setDraft([]);
      setStrike('');
    } else {
      // Save generic multi-leg position with per-leg entry prices
      const legs = draft.map(d => ({
        leg: d.leg,
        side: d.side,
        qty: d.qty,
        entryPrice: midPrice(tickers[d.leg.symbol]) ?? 0
      }));
      addPosition({ legs, note: 'Custom position' });
      setDraft([]);
      setStrike('');
    }
  };

  return (
    <div>
      <h3>Add Position</h3>
      {loading && <div className="muted">Loading instruments…</div>}
      <div className="grid">
        <label>
          <div className="muted">Type</div>
          <select value={optType} onChange={(e) => { setOptType(e.target.value as OptionType); setExpiry(''); setStrike(''); }}>
            <option value="P">PUT</option>
            <option value="C">CALL</option>
          </select>
        </label>
        <label>
          <div className="muted">Δ range</div>
          <div style={{display:'flex', gap: 6}}>
            <input type="number" step={0.01} min={0} max={1} value={deltaMin} onChange={(e) => setDeltaMin(Number(e.target.value))} style={{width:80}} />
            <span>to</span>
            <input type="number" step={0.01} min={0} max={1} value={deltaMax} onChange={(e) => setDeltaMax(Number(e.target.value))} style={{width:80}} />
          </div>
        </label>
        <label>
          <div className="muted">Min OI</div>
          <input type="number" min={0} step={1} value={minOI} onChange={(e) => setMinOI(Number(e.target.value)||0)} />
        </label>
        <label>
          <div className="muted">Max spread ($)</div>
          <input type="number" min={0} step={0.01} value={maxSpread} onChange={(e) => setMaxSpread(Number(e.target.value)||0)} />
        </label>
        <label style={{display:'flex', alignItems:'end', gap:6}}>
          <input type="checkbox" checked={showAllStrikes} onChange={(e)=> setShowAllStrikes(e.target.checked)} />
          <span className="muted">Show all strikes</span>
        </label>
        <label>
          <div className="muted">Expiry</div>
          <select value={expiry} onChange={(e) => { const v = e.target.value; setExpiry(v === '' ? '' : Number(v)); setStrike(''); }}>
            <option value="">Select expiry</option>
            {expiries.map((ms) => (
              <option key={ms} value={ms}>{new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d</option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted">Option</div>
          <select value={strike} onChange={(e) => setStrike(e.target.value)} disabled={!expiry}>
            <option value="">Select strike</option>
            {filteredChain.map((i) => {
              const t = tickers[i.symbol];
              const { bid: b, ask: a } = bestBidAsk(t);
              const m = (b != null && a != null) ? (Number(b) + Number(a)) / 2 : undefined; // strict mid from book
              const d = t?.delta != null ? Math.abs(Number(t.delta)) : undefined;
              const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
              const label = Number.isFinite(i.strike)
                ? `${i.strike} — ${m != null ? '$'+m.toFixed(2) : (b!=null && a!=null ? `$${b.toFixed(2)}/${a.toFixed(2)}` : '—')} · Δ ${d!=null? d.toFixed(2):'—'} · OI ${oi!=null? oi: '—'}`
                : i.symbol;
              return <option key={i.symbol} value={i.symbol}>{label}</option>;
            })}
          </select>
        </label>
        <label>
          <div className="muted">Volume (qty)</div>
          <input type="number" min={0.1} step={0.1} value={qty} onChange={(e) => setQty(Math.max(0.1, Number(e.target.value) || 0.1))} />
        </label>
        <div style={{display:'flex', alignItems:'end', gap: 8, flexWrap:'wrap'}}>
          <button type="button" className="ghost" disabled={!strike} onClick={() => addLeg('short')}>Add Short</button>
          <button type="button" className="ghost" disabled={!strike} onClick={() => addLeg('long')}>Add Long</button>
          <span className="muted" style={{margin:'0 6px'}}>or</span>
          <button type="button" className="ghost" onClick={() => addPerpLeg('short')}>Add Perp Short (ETHUSDT)</button>
          <button type="button" className="ghost" onClick={() => addPerpLeg('long')}>Add Perp Long (ETHUSDT)</button>
          <button type="button" className="ghost" onClick={() => { setDraft([]); localStorage.removeItem('options-draft-v1'); }}>Clear draft</button>
        </div>
      </div>

      {/* Draft table */}
      <div style={{marginTop: 12}}>
        <div className="muted">Position builder</div>
        {draft.length === 0 ? (
          <div className="muted">No legs added yet.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Expiry</th>
                  <th>Strike</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Mid now</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((d, idx) => {
                  const t = tickers[d.leg.symbol];
                  const m = midPrice(t);
                  const isPerp = !d.leg.symbol.includes('-');
                  return (
                    <tr key={idx}>
                      <td>{isPerp ? 'PERP' : d.leg.optionType}</td>
                      <td>{isPerp ? '—' : new Date(d.leg.expiryMs).toISOString().slice(0,10)}</td>
                      <td>{isPerp ? '—' : d.leg.strike}</td>
                      <td>{d.side}</td>
                      <td>{d.qty}</td>
                      <td>{m != null ? `$${m.toFixed(2)}` : '—'}</td>
                      <td><button className="ghost" onClick={() => removeLeg(idx)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop: 8}}>
          <div className="muted">Net credit (mid, total): {draft.length ? `$${totalCreditPer.toFixed(2)}` : '—'}</div>
          <button className="primary" type="button" disabled={!draft.length} onClick={onSave}>Save</button>
        </div>
        {!canSaveAsVertical && draft.length > 0 && (
          <div className="muted" style={{marginTop: 6}}>Note: saving to main table поддерживает пока только 2 ноги одинаковой экспирации, равный объём и противоположные стороны.</div>
        )}
      </div>
    </div>
  );
}
