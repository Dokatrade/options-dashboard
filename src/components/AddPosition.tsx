import React from 'react';
import { fetchInstruments, fetchOptionTickers, midPrice } from '../services/bybit';
import { subscribeOptionTicker } from '../services/ws';
import { useStore } from '../store/store';
import type { InstrumentInfo, Leg, OptionType, SpreadPosition } from '../utils/types';

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
    const mk = (exp: number | '', type: OptionType) => {
      if (!exp) return [] as InstrumentInfo[];
      return instruments
        .filter((i) => i.deliveryTime === exp && i.optionType === type)
        .sort((a, b) => a.strike - b.strike);
    };
    setChain(mk(expiry, optType));
  }, [expiry, instruments, optType]);

  React.useEffect(() => {
    let m = true;
    fetchOptionTickers().then((list) => { if (!m) return; setTickers(Object.fromEntries(list.map(t => [t.symbol, t]))); });
    return () => { m = false; };
  }, []);

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
      if (Array.isArray(d?.draft)) {
        const legs = d.draft.map((L: any) => ({
          leg: {
            symbol: String(L?.leg?.symbol || ''),
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
        deltaMin, deltaMax, minOI, maxSpread,
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
    const unsubs = Array.from(symbols).slice(0, 200).map(sym => subscribeOptionTicker(sym, (t) => setTickers((prev) => {
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
  }, [chain, draft]);

  const expiries = Array.from(new Set(instruments.filter(i => i.optionType === optType).map(i => i.deliveryTime))).sort((a, b) => a - b);
  const filteredChain = React.useMemo(() => {
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
  }, [chain, tickers, deltaMin, deltaMax, minOI, maxSpread]);

  const addLeg = (side: 'short' | 'long') => {
    const inst = chain.find(c => c.symbol === strike);
    if (!inst) return;
    const leg: Leg = { symbol: inst.symbol, strike: inst.strike, optionType: inst.optionType, expiryMs: inst.deliveryTime };
    const q = Math.max(0.1, Math.round(Number(qty) * 10) / 10);
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
      addPosition({ legs, note: 'Multi-leg position' });
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
              const b = t?.bid1Price, a = t?.ask1Price; const m = midPrice(t);
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
        <div style={{display:'flex', alignItems:'end', gap: 8}}>
          <button type="button" className="ghost" disabled={!strike} onClick={() => addLeg('short')}>Add Short</button>
          <button type="button" className="ghost" disabled={!strike} onClick={() => addLeg('long')}>Add Long</button>
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
                  return (
                    <tr key={idx}>
                      <td>{d.leg.optionType}</td>
                      <td>{new Date(d.leg.expiryMs).toISOString().slice(0,10)}</td>
                      <td>{d.leg.strike}</td>
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
