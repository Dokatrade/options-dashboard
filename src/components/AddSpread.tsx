import React from 'react';
import { fetchInstruments, fetchOptionTickers, midPrice, bestBidAsk, fetchOrderbookL1 } from '../services/bybit';
import { subscribeOptionTicker } from '../services/ws';
import { useStore } from '../store/store';
import type { InstrumentInfo, Leg, OptionType } from '../utils/types';

function dteFrom(ms: number) {
  return Math.max(0, Math.round((ms - Date.now()) / (1000 * 60 * 60 * 24)));
}

export function AddSpread() {
  const addSpread = useStore((s) => s.addSpread);
  const [loading, setLoading] = React.useState(false);
  const [instruments, setInstruments] = React.useState<InstrumentInfo[]>([]);
  const [optType, setOptType] = React.useState<OptionType>('P');
  const [expiryShort, setExpiryShort] = React.useState<number | ''>('');
  const [expiryLong, setExpiryLong] = React.useState<number | ''>('');
  const [chainShort, setChainShort] = React.useState<InstrumentInfo[]>([]);
  const [chainLong, setChainLong] = React.useState<InstrumentInfo[]>([]);
  const [short, setShort] = React.useState<string>('');
  const [long, setLong] = React.useState<string>('');
  const [cEnter, setCEnter] = React.useState<string>('');
  const [note, setNote] = React.useState('');
  const [tickers, setTickers] = React.useState<Record<string, any>>({});

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

  // Load tickers once for preview mids
  React.useEffect(() => {
    let m = true;
    fetchOptionTickers().then((list) => {
      if (!m) return;
      setTickers(Object.fromEntries(list.map(t => [t.symbol, t])));
    });
    return () => { m = false; };
  }, []);

  // REST L1 fallback for visible chains
  React.useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const syms = Array.from(new Set([...chainShort, ...chainLong].map(i => i.symbol))).slice(0, 200);
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
  }, [chainShort, chainLong]);

  // Live preview via WS for selected legs
  React.useEffect(() => {
    const unsubs: Array<() => void> = [];
    [short, long].forEach((sym) => {
      if (!sym) return;
      const off = subscribeOptionTicker(sym, (t) => setTickers((prev) => {
        const cur = prev[t.symbol] || {};
        const merged: any = { ...cur };
        const keys: string[] = Object.keys(t as any);
        for (const k of keys) {
          const v: any = (t as any)[k];
          if (v != null && !(Number.isNaN(v))) (merged as any)[k] = v;
        }
        return { ...prev, [t.symbol]: merged };
      }));
      unsubs.push(off);
    });
    return () => { unsubs.forEach(u => u()); };
  }, [short, long]);

  // Subscribe WS for visible chains to show live prices in dropdowns
  React.useEffect(() => {
    const symbols = [...chainShort, ...chainLong].map(i => i.symbol);
    const uniq = Array.from(new Set(symbols));
    const unsubs = uniq.slice(0, 150).map(sym => subscribeOptionTicker(sym, (t) => setTickers((prev) => {
      const cur = prev[t.symbol] || {};
      const merged: any = { ...cur };
      const keys: string[] = Object.keys(t as any);
      for (const k of keys) {
        const v: any = (t as any)[k];
        if (v != null && !(Number.isNaN(v))) (merged as any)[k] = v;
      }
      return { ...prev, [t.symbol]: merged };
    })));
    return () => { unsubs.forEach(u => u()); };
  }, [chainShort, chainLong]);

  React.useEffect(() => {
    const mk = (exp: number | '', type: OptionType) => {
      if (!exp) return [] as InstrumentInfo[];
      return instruments
        .filter((i) => i.deliveryTime === exp && i.optionType === type)
        .sort((a, b) => a.strike - b.strike);
    };
    setChainShort(mk(expiryShort, optType));
    setChainLong(mk(expiryLong, optType));
  }, [expiryShort, expiryLong, instruments, optType]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = chainShort.find((x) => x.symbol === short);
    const l = chainLong.find((x) => x.symbol === long);
    const c = Number(cEnter);
    if (!s || !l || !isFinite(c) || c <= 0) return;
    const mkLeg = (x: InstrumentInfo): Leg => ({ symbol: x.symbol, strike: x.strike, optionType: x.optionType, expiryMs: x.deliveryTime });
    const eShort = midShort != null ? midShort : undefined;
    const eLong = midLong != null ? midLong : undefined;
    addSpread({ short: mkLeg(s), long: mkLeg(l), cEnter: c, entryShort: eShort, entryLong: eLong, qty: 1, note });
    setShort(''); setLong(''); setCEnter(''); setNote('');
  };

  const expiries = Array.from(new Set(instruments.filter(i => i.optionType === optType).map(i => i.deliveryTime))).sort((a, b) => a - b);

  // Derived preview values
  const shortTicker = tickers[short];
  const longTicker = tickers[long];
  const midShort = midPrice(shortTicker);
  const midLong = midPrice(longTicker);
  const previewMid = midShort != null && midLong != null ? (midShort - midLong) : undefined;
  const sLeg = chainShort.find((x) => x.symbol === short);
  const lLeg = chainLong.find((x) => x.symbol === long);
  const sameExpiry = sLeg && lLeg ? (sLeg.deliveryTime === lLeg.deliveryTime) : false;
  const width = sLeg && lLeg && sameExpiry ? Math.abs(sLeg.strike - lLeg.strike) : undefined;
  const roc = width != null && previewMid != null ? (previewMid / Math.max(0.0001, width - previewMid)) : undefined;

  const numericC = Number(cEnter);
  const showWarn = previewMid != null && isFinite(numericC) && numericC > previewMid * 3 && numericC > 50;

  return (
    <div>
      <h3>Add Spread</h3>
      {loading && <div className="muted">Loading expiries…</div>}
      <form onSubmit={onSubmit} className="grid">
        <label>
          <div className="muted">Type</div>
          <select value={optType} onChange={(e) => setOptType(e.target.value as OptionType)}>
            <option value="P">PUT</option>
            <option value="C">CALL</option>
          </select>
        </label>
        <label>
          <div className="muted">Expiry — Short</div>
          <select value={expiryShort} onChange={(e) => {
            const v = e.target.value;
            setExpiryShort(v === '' ? '' : Number(v));
          }} required>
            <option value="">Select expiry</option>
            {expiries.map((ms) => (
              <option key={ms} value={ms}>{new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d</option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted">Expiry — Long</div>
          <select value={expiryLong} onChange={(e) => {
            const v = e.target.value;
            setExpiryLong(v === '' ? '' : Number(v));
          }} required>
            <option value="">Select expiry</option>
            {expiries.map((ms) => (
              <option key={ms} value={ms}>{new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d</option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted">Short {optType === 'P' ? 'PUT' : 'CALL'} (sell)</div>
          <select value={short} onChange={(e) => setShort(e.target.value)} required>
            <option value="">Select short</option>
            {chainShort.map((i) => {
              const t = tickers[i.symbol];
              const { bid: b, ask: a } = bestBidAsk(t);
              const mid = midPrice(t);
              const label = Number.isFinite(i.strike)
                ? `${i.strike} — ${mid != null ? '$'+mid.toFixed(2) : (b!=null && a!=null ? `$${b.toFixed(2)}/${a.toFixed(2)}` : '—')}`
                : i.symbol;
              return <option key={i.symbol} value={i.symbol}>{label}</option>;
            })}
          </select>
        </label>
        <label>
          <div className="muted">Long {optType === 'P' ? 'PUT' : 'CALL'} (buy)</div>
          <select value={long} onChange={(e) => setLong(e.target.value)} required>
            <option value="">Select long</option>
            {chainLong.map((i) => {
              const t = tickers[i.symbol];
              const { bid: b, ask: a } = bestBidAsk(t);
              const mid = midPrice(t);
              const label = Number.isFinite(i.strike)
                ? `${i.strike} — ${mid != null ? '$'+mid.toFixed(2) : (b!=null && a!=null ? `$${b.toFixed(2)}/${a.toFixed(2)}` : '—')}`
                : i.symbol;
              return <option key={i.symbol} value={i.symbol}>{label}</option>;
            })}
          </select>
        </label>
        {previewMid != null && (
          <div style={{gridColumn: '1 / -1'}}>
            <div className="muted">Indicative credit (mid now)</div>
            <div>
              <strong>${previewMid.toFixed(2)}</strong>
              {width != null && (
                <span className="muted" style={{marginLeft: 8}}>Width {width.toFixed(2)} · ROC {roc != null ? (roc * 100).toFixed(1) + '%' : '—'}</span>
              )}
              {sLeg && lLeg && !sameExpiry && (
                <span className="muted" style={{marginLeft: 8}}>(calendar spread: metrics limited)</span>
              )}
              <button type="button" className="ghost" onClick={() => setCEnter(previewMid.toFixed(2))} style={{marginLeft: 12}}>Use mid</button>
            </div>
          </div>
        )}
        <label>
          <div className="muted">Entry credit per contract (USD)</div>
          <input type="number" step="0.01" min="0" value={cEnter} onChange={(e) => setCEnter(e.target.value)} required />
        </label>
        {showWarn && (
          <div className="muted" style={{gridColumn: '1 / -1'}}>Entered credit is far from current mid. Please check units.</div>
        )}
        <label style={{gridColumn: '1 / -1'}}>
          <div className="muted">Note</div>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
        <div style={{gridColumn: '1 / -1'}}>
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
