import React from 'react';
import { useStore, DEFAULT_PORTFOLIO_ID } from '../store/store';
import { fetchInstruments, fetchOptionTickers, midPrice, bestBidAsk } from '../services/bybit';
import { ensureUsdtSymbol } from '../utils/symbols';
import { subscribeOptionTicker, subscribeSpotTicker } from '../services/ws';
import type { Position, InstrumentInfo, Leg, OptionType } from '../utils/types';

type Props = { id: string; onClose: () => void };

const MONTH_CODES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'] as const;
const MONTH_INDEX: Record<string, number> = MONTH_CODES.reduce((acc, code, idx) => ({ ...acc, [code]: idx }), {} as Record<string, number>);

const dteFrom = (ms: number) => {
  return Math.max(0, Math.round((ms - Date.now()) / (1000 * 60 * 60 * 24)));
};

const parseExpiryCode = (raw: string): number | undefined => {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  const dayPart2 = upper.slice(0, 2);
  let day = Number(dayPart2);
  let monthStart = 2;
  if (!Number.isFinite(day)) {
    day = Number(upper.slice(0, 1));
    monthStart = 1;
  }
  const monthCode = upper.slice(monthStart, monthStart + 3);
  const mon = MONTH_INDEX[monthCode];
  const yearPart = upper.slice(monthStart + 3, monthStart + 5);
  const year = Number(yearPart);
  if (!Number.isFinite(day) || !Number.isFinite(year) || mon == null) return undefined;
  const fullYear = 2000 + year;
  const ms = Date.UTC(fullYear, mon, day, 8, 0, 0, 0);
  return Number.isFinite(ms) ? ms : undefined;
};

const ensureLegCreatedAt = <T extends { createdAt?: number }>(leg: T, fallback: number): T => {
  const raw = Number((leg as any)?.createdAt);
  if (Number.isFinite(raw)) return { ...leg, createdAt: raw };
  return { ...leg, createdAt: fallback };
};

export function EditPositionModal({ id, onClose }: Props) {
  const position = useStore((s) => s.positions.find(p => p.id === id));
  const updatePosition = useStore((s) => s.updatePosition);
  const removePosition = useStore((s) => s.removePosition);
  const portfolios = useStore((s) => s.portfolios);
  const activePortfolioId = useStore((s) => s.activePortfolioId);
  const baseCreatedAt = Number.isFinite(position?.createdAt) ? Number(position?.createdAt) : Date.now();
  const [draft, setDraft] = React.useState(() => position?.legs?.map((L) => ensureLegCreatedAt(L, baseCreatedAt)) || []);
  const [portfolioId, setPortfolioId] = React.useState(() => position?.portfolioId ?? activePortfolioId ?? DEFAULT_PORTFOLIO_ID);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [instruments, setInstruments] = React.useState<InstrumentInfo[]>([]);
  const [optType, setOptType] = React.useState<OptionType>('P');
  const [expiry, setExpiry] = React.useState<number | ''>('');
  const [chain, setChain] = React.useState<InstrumentInfo[]>([]);
  const [symbol, setSymbol] = React.useState<string>('');
  const [side, setSide] = React.useState<'short'|'long'>('short');
  const [qty, setQty] = React.useState<number>(1);
  const [rollIdx, setRollIdx] = React.useState<number | ''>('');
  const [rollExpiry, setRollExpiry] = React.useState<number | ''>('');
  const [rollSymbol, setRollSymbol] = React.useState<string>('');
  const [perpSide, setPerpSide] = React.useState<'short'|'long'>('short');
  const [perpQty, setPerpQty] = React.useState<number>(1);
  const [perpUsdTotal, setPerpUsdTotal] = React.useState<number>(0);
  const [perpMode, setPerpMode] = React.useState<'contracts' | 'usd'>('contracts');

  const parseSymbol = React.useCallback((raw: string) => {
    if (!raw) return null;
    const upper = raw.toUpperCase();
    const parts = upper.split('-');
    if (parts.length < 3) return null;
    const code = parts[1];
    let strike: number | undefined;
    let typeChar: OptionType | undefined;
    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];
      if (!typeChar && (part === 'C' || part === 'P' || part.startsWith('C') || part.startsWith('P'))) {
        typeChar = part.charAt(0) as OptionType;
        continue;
      }
      if (!strike) {
        const numeric = Number(part.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(numeric)) strike = numeric;
      }
    }
    if (!typeChar || !Number.isFinite(strike)) return null;
    return { code, strike: strike!, type: typeChar };
  }, []);

  const inferTypeChar = React.useCallback((segments: string[]): OptionType | undefined => {
    for (let i = segments.length - 1; i >= 0; i--) {
      const raw = segments[i];
      if (!raw) continue;
      const seg = raw.toUpperCase();
      if (!seg) continue;
      if (seg === 'C' || seg === 'CALL' || seg.startsWith('C-')) return 'C';
      if (seg === 'P' || seg === 'PUT' || seg.startsWith('P-')) return 'P';
      if (seg === 'USDT' || seg === 'USD' || /^[0-9.]+$/.test(seg)) continue;
      const head = seg.charAt(0);
      if (head === 'C' || head === 'P') return head as OptionType;
    }
    return undefined;
  }, []);

  const computeExpiries = React.useCallback((type: OptionType | null) => {
    if (!type) return [] as number[];
    const set = new Set<number>();
    draft
      .filter((d) => d.leg.optionType === type && Number.isFinite(d.leg.expiryMs))
      .forEach((d) => set.add(Number(d.leg.expiryMs)));
    instruments
      .filter((i) => i.optionType === type && Number.isFinite(i.deliveryTime))
      .forEach((i) => set.add(Number(i.deliveryTime)));
    Object.keys(tickers || {}).forEach((sym) => {
      if (!sym.includes('-')) return;
      const parts = sym.split('-');
      if (parts.length < 3) return;
      const code = parts[1];
      const typeChar = inferTypeChar(parts.slice(2));
      if (typeChar && typeChar !== type) return;
      const ticker = tickers[sym];
      const expMs = Number((ticker as any)?.expiryDate ?? (ticker as any)?.deliveryTime);
      if (Number.isFinite(expMs) && expMs > 0) {
        set.add(Number(expMs));
        return;
      }
      const ms = parseExpiryCode(code);
      if (ms) set.add(ms);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [draft, inferTypeChar, instruments, tickers]);

  React.useEffect(() => {
    if (!position) return;
    const fallback = Number.isFinite(position.createdAt) ? Number(position.createdAt) : Date.now();
    setDraft(position.legs.map((L) => ensureLegCreatedAt(L, fallback)));
  }, [position?.id]);

  React.useEffect(() => {
    if (!position) return;
    setPortfolioId(position.portfolioId ?? DEFAULT_PORTFOLIO_ID);
  }, [position?.id]);

  React.useEffect(() => {
    let m = true;
    fetchInstruments().then((list) => { if (!m) return; setInstruments(list.filter(i => i.deliveryTime > 0 && Number.isFinite(i.strike))); });
    fetchOptionTickers().then((list) => { if (!m) return; setTickers(Object.fromEntries(list.map(t => [t.symbol, t]))); });
    return () => { m = false; };
  }, []);

  const buildChain = React.useCallback((exp: number | '', type: OptionType | null) => {
    if (!exp || !type) return [] as InstrumentInfo[];
    const map = new Map<string, InstrumentInfo>();
    instruments
      .filter((i) => i.deliveryTime === exp && i.optionType === type)
      .forEach((i) => {
        const key = ensureUsdtSymbol(i.symbol);
        map.set(key, { ...i, symbol: key });
      });

    const expiryCode = (ms: number): string => {
      const d = new Date(ms);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const m = MONTH_CODES[d.getUTCMonth()];
      const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
      return `${dd}${m}${yy}`;
    };

    const code = expiryCode(exp as number);
    const tolerance = 12 * 60 * 60 * 1000; // 12h tolerance for API rounding

    Object.entries(tickers || {}).forEach(([sym, ticker]) => {
      const parsed = parseSymbol(sym);
      if (!parsed || parsed.type !== type) return;

      let expiryMs = Number((ticker as any)?.deliveryTime ?? (ticker as any)?.expiryDate);
      if (!Number.isFinite(expiryMs)) {
        const parsedCodeMs = parseExpiryCode(parsed.code);
        expiryMs = parsedCodeMs ?? NaN;
      }
      if (!Number.isFinite(expiryMs)) return;
      const expiryCandidate = Number(expiryMs);

      if (Math.abs(expiryCandidate - (exp as number)) > tolerance && parsed.code !== code) return;

      const normalized = ensureUsdtSymbol(sym);
      if (!map.has(normalized)) {
        map.set(normalized, {
          symbol: normalized,
          strike: parsed.strike,
          optionType: type,
          deliveryTime: expiryCandidate || (exp as number),
          settleCoin: 'USDT',
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
  }, [instruments, parseSymbol, tickers]);

  React.useEffect(() => {
    setChain(buildChain(expiry, optType));
  }, [buildChain, expiry, optType]);

  React.useEffect(() => {
    const symbols = new Set<string>();
    draft.forEach(l => symbols.add(l.leg.symbol));
    chain.forEach(i => symbols.add(i.symbol));
    symbols.add('ETHUSDT');
    const unsubs = Array.from(symbols).slice(0,300).map(sym => {
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
  }, [draft, chain]);

  if (!position) return null;

  const sideLabel = (s: 'short' | 'long') => (s === 'short' ? 'Short' : 'Long');

  const addLeg = () => {
    const inst = chain.find(c => c.symbol === symbol);
    if (!inst) return;
    const leg: Leg = { symbol: inst.symbol, strike: inst.strike, optionType: inst.optionType, expiryMs: inst.deliveryTime };
    const q = Math.max(0.1, Math.round(Number(qty) * 10) / 10);
    const entryPrice = midPrice(tickers[leg.symbol]) ?? 0;
    const createdAt = Date.now();
    setDraft(d => [...d, { leg, side, qty: q, entryPrice, createdAt }]);
    setSymbol('');
  };

  const addPerpLeg = () => {
    const leg: Leg = { symbol: 'ETHUSDT', strike: 0, optionType: 'C', expiryMs: 0 } as any;
    const ticker = tickers['ETHUSDT'];
    const midEth = midPrice(ticker);
    if (perpMode === 'usd') {
      const usdRaw = Math.abs(Number(perpUsdTotal));
      const usd = Number.isFinite(usdRaw) ? usdRaw : 0;
      if (!(usd > 0 && midEth != null && midEth > 0)) return;
      const qty = Number((usd / midEth).toFixed(4));
      if (!(qty > 0)) return;
      const createdAt = Date.now();
      setDraft(d => [...d, { leg, side: perpSide, qty, entryPrice: midEth, createdAt }]);
      setPerpUsdTotal(0);
    } else {
      const qtyRaw = Number(perpQty);
      const qty = Number.isFinite(qtyRaw) ? Math.max(0.0001, Math.round(qtyRaw * 1000) / 1000) : 0;
      if (!(qty > 0)) return;
      const entryPrice = midEth ?? 0;
      const createdAt = Date.now();
      setDraft(d => [...d, { leg, side: perpSide, qty, entryPrice, createdAt }]);
      setPerpQty(1);
    }
  };

  const save = () => {
    const validPortfolioId = portfolios.some((p) => p.id === portfolioId) ? portfolioId : DEFAULT_PORTFOLIO_ID;
    updatePosition(id, (p) => ({ ...p, legs: draft, portfolioId: validPortfolioId }));
    onClose();
  };

  const handlePortfolioChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setPortfolioId(event.target.value);
  };

  const removeLeg = (idx: number) => setDraft(d => d.filter((_, i) => i !== idx));
  const toggleHide = (idx: number) => setDraft(d => d.map((L, i) => i === idx ? { ...L, hidden: !L.hidden } : L));
  const setLegQty = (idx: number, q: number) => setDraft(d => d.map((L,i)=> i===idx ? { ...L, qty: Math.max(0.1, Math.round(q*10)/10) } : L));

  const expiries = React.useMemo(() => computeExpiries(optType), [computeExpiries, optType]);
  const rollType = React.useMemo<OptionType | null>(() => {
    if (rollIdx === '' || !draft[Number(rollIdx)]) return null;
    return draft[Number(rollIdx)].leg.optionType;
  }, [rollIdx, draft]);
  const rollChain = React.useMemo(() => {
    if (rollIdx === '' || !rollType || !rollExpiry) return [] as InstrumentInfo[];
    return buildChain(rollExpiry, rollType);
  }, [buildChain, rollIdx, rollType, rollExpiry]);
  const rollExpiries = React.useMemo(() => computeExpiries(rollType), [computeExpiries, rollType]);

  React.useEffect(() => {
    if (expiry === '' || expiries.includes(expiry)) return;
    setExpiry('');
  }, [expiries, expiry]);

  React.useEffect(() => {
    if (rollExpiry === '' || rollExpiries.includes(rollExpiry)) return;
    setRollExpiry('');
  }, [rollExpiries, rollExpiry]);

  const midEth = midPrice(tickers['ETHUSDT']);
  const sanitizedPerpQty = (() => {
    const val = Number(perpQty);
    if (!Number.isFinite(val) || val <= 0) return 0;
    return Math.max(0.0001, val);
  })();
  const sanitizedPerpUsd = (() => {
    const val = Math.abs(Number(perpUsdTotal));
    if (!Number.isFinite(val) || val <= 0) return 0;
    return val;
  })();
  const canAddPerp = perpMode === 'contracts'
    ? sanitizedPerpQty > 0
    : (sanitizedPerpUsd > 0 && midEth != null && midEth > 0);

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:70}}>
      <div style={{background:'var(--card)', color:'var(--fg)', border:'1px solid var(--border)', borderRadius:12, width:900, maxWidth:'95%', maxHeight:'90%', overflow:'auto'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <strong>Edit Position</strong>
            <label style={{display:'flex', alignItems:'center', gap:6}}>
              <span className="muted">Portfolio</span>
              <select value={portfolioId} onChange={handlePortfolioChange}>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="ghost" onClick={save}>Save</button>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div style={{padding:12}}>
          {/* Roll helper */}
          <div style={{marginBottom: 12}}>
            <div className="muted" style={{marginBottom:6}}>Roll helper</div>
            <div style={{display:'flex', flexWrap:'nowrap', alignItems:'flex-end', gap:8}}>
              <label style={{display:'flex', flexDirection:'column', minWidth:170}}>
                <div className="muted">Leg to roll</div>
                <select value={rollIdx} onChange={(e)=>{ const v = e.target.value; setRollIdx(v===''? '': Number(v)); setRollExpiry(''); setRollSymbol(''); }}>
                  <option value="">Select leg</option>
                  {draft.map((L, idx)=>{
                    if (!L.leg.symbol.includes('-')) return null;
                    return (
                      <option key={idx} value={idx}>{sideLabel(L.side)} {L.leg.optionType} {L.leg.strike} · {new Date(L.leg.expiryMs).toISOString().slice(0,10)} × {L.qty}</option>
                    );
                  })}
                </select>
              </label>
              <label style={{display:'flex', flexDirection:'column', minWidth:150}}>
                <div className="muted">Target expiry</div>
                <select value={rollExpiry} onChange={(e)=>{ const v=e.target.value; setRollExpiry(v===''?'':Number(v)); setRollSymbol(''); }} disabled={rollIdx===''}>
                  <option value="">Select expiry</option>
                  {rollExpiries.map((ms) => (
                    <option key={ms} value={ms}>
                      {new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d
                    </option>
                  ))}
                </select>
              </label>
              <label style={{display:'flex', flexDirection:'column', flex: '0 1 220px', minWidth:182}}>
                <div className="muted">Target option</div>
                <select value={rollSymbol} onChange={(e)=>setRollSymbol(e.target.value)} disabled={rollIdx==='' || !rollExpiry}>
                  <option value="">Select strike</option>
                  {rollChain.map(i=> {
                    const t = tickers[i.symbol] || {};
                    const { bid: bRaw, ask: aRaw } = bestBidAsk(t);
                    const bid = bRaw != null && Number.isFinite(Number(bRaw)) ? Number(bRaw) : undefined;
                    const ask = aRaw != null && Number.isFinite(Number(aRaw)) ? Number(aRaw) : undefined;
                    const mid = (() => {
                      const m = midPrice(t);
                      return m != null && Number.isFinite(m) ? m : undefined;
                    })();
                    const srcSide = rollIdx !== '' && draft[Number(rollIdx)] ? draft[Number(rollIdx)].side : 'short';
                    const preferred = srcSide === 'short'
                      ? (bid ?? ask ?? mid)
                      : (ask ?? bid ?? mid);
                    const priceLabel = preferred != null ? `$${preferred.toFixed(2)}` : '—';
                    const deltaVal = t?.delta != null && Number.isFinite(Number(t.delta)) ? Number(t.delta) : undefined;
                    const deltaLabel = deltaVal != null ? deltaVal.toFixed(3) : '—';
                    const oiVal = t?.openInterest != null && Number.isFinite(Number(t.openInterest)) ? Number(t.openInterest) : undefined;
                    const oiLabel = oiVal != null ? oiVal : '—';
                    const label = `${i.strike} — ${priceLabel} · Δ ${deltaLabel} · OI ${oiLabel}`;
                    return <option key={i.symbol} value={i.symbol}>{label}</option>;
                  })}
                </select>
              </label>
              <div style={{display:'flex', alignItems:'flex-end'}}>
                <button
                  className="ghost"
                  style={{border:'2px solid var(--border-strong, var(--border))'}}
                  disabled={rollIdx===''}
                  onClick={()=>{
                  if (rollIdx==='') return; const idx = Number(rollIdx); const src = draft[idx]; if (!src) return;
                  // close leg
                  const closeLeg = { ...src, side: (src.side==='short' ? 'long' as const : 'short' as const) };
                  const entryClose = midPrice(tickers[closeLeg.leg.symbol]) ?? 0;
                  // open new leg
                  const inst = rollChain.find(c => c.symbol === rollSymbol);
                  if (!inst) return;
                  const openLeg = { leg: { symbol: inst.symbol, strike: inst.strike, optionType: inst.optionType, expiryMs: inst.deliveryTime }, side: src.side, qty: src.qty, entryPrice: midPrice(tickers[inst.symbol]) ?? 0, createdAt: Date.now() };
                  setDraft(d => [...d, { ...closeLeg, entryPrice: entryClose }, openLeg]);
                }}>Add roll</button>
              </div>
            </div>
          </div>
            <div className="muted" style={{marginBottom:6}}>Add leg</div>
          <div style={{display:'flex', flexWrap:'nowrap', alignItems:'flex-end', gap:8}}>
            <label style={{display:'flex', flexDirection:'column', minWidth:110}}>
              <div className="muted">Type</div>
              <select value={optType} onChange={(e)=>{ setOptType(e.target.value as OptionType); setExpiry(''); setSymbol(''); }}>
                <option value="P">PUT</option>
                <option value="C">CALL</option>
              </select>
            </label>
            <label style={{display:'flex', flexDirection:'column', minWidth:150}}>
              <div className="muted">Expiry</div>
              <select value={expiry} onChange={(e)=>{ const v=e.target.value; setExpiry(v===''?'':Number(v)); setSymbol(''); }}>
                <option value="">Select expiry</option>
                {expiries.map(ms => (
                  <option key={ms} value={ms}>
                    {new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d
                  </option>
                ))}
              </select>
            </label>
            <label style={{display:'flex', flexDirection:'column', flex:'0 1 220px', minWidth:182}}>
              <div className="muted">Option</div>
              <select value={symbol} onChange={(e)=>setSymbol(e.target.value)} disabled={!expiry}>
                <option value="">Select strike</option>
                {chain.map(i=>{
                  const t = tickers[i.symbol] || {};
                  const { bid: bRaw, ask: aRaw } = bestBidAsk(t);
                  const bid = bRaw != null && Number.isFinite(Number(bRaw)) ? Number(bRaw) : undefined;
                  const ask = aRaw != null && Number.isFinite(Number(aRaw)) ? Number(aRaw) : undefined;
                  const mid = (() => {
                    const m = midPrice(t);
                    return m != null && Number.isFinite(m) ? m : undefined;
                  })();
                  const preferred = side === 'short'
                    ? (bid ?? ask ?? mid)
                    : (ask ?? bid ?? mid);
                  const priceLabel = preferred != null ? `$${preferred.toFixed(2)}` : '—';
                  const deltaVal = t?.delta != null && Number.isFinite(Number(t.delta)) ? Number(t.delta) : undefined;
                  const deltaLabel = deltaVal != null ? deltaVal.toFixed(3) : '—';
                  const oiVal = t?.openInterest != null && Number.isFinite(Number(t.openInterest)) ? Number(t.openInterest) : undefined;
                  const oiLabel = oiVal != null ? oiVal : '—';
                  const label = `${i.strike} — ${priceLabel} · Δ ${deltaLabel} · OI ${oiLabel}`;
                  return <option key={i.symbol} value={i.symbol}>{label}</option>;
                })}
              </select>
            </label>
            <label style={{display:'flex', flexDirection:'column', minWidth:110}}>
              <div className="muted">Side</div>
              <select value={side} onChange={(e)=>setSide(e.target.value as 'short'|'long')}>
                <option value="short">Short</option>
                <option value="long">Long</option>
              </select>
            </label>
            <label style={{display:'flex', flexDirection:'column', flex:'0 0 55px'}}>
              <div className="muted">Qty</div>
              <input style={{width:'100%'}} type="number" min={0.1} step={0.1} value={qty} onChange={(e)=>setQty(Math.max(0.1, Number(e.target.value)||0.1))} />
            </label>
            <div style={{display:'flex', alignItems:'flex-end', marginLeft:20}}>
              <button
                className="ghost"
                style={{border:'2px solid var(--border-strong, var(--border))'}}
                onClick={addLeg}
                disabled={!symbol}
              >Add leg</button>
            </div>
          </div>
          <div style={{marginTop:12}}>
            <div className="muted" style={{marginBottom:6}}>Add perpetual</div>
            <div style={{display:'flex', flexWrap:'nowrap', alignItems:'flex-end', gap:8}}>
              <label style={{display:'flex', flexDirection:'column', minWidth:110}}>
                <div className="muted">Side</div>
                <select value={perpSide} onChange={(e)=>setPerpSide(e.target.value as 'short'|'long')}>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                </select>
              </label>
              <label style={{display:'flex', flexDirection:'column', minWidth:220}}>
                <div className="muted">Qty</div>
                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                  <input
                    type="number"
                    min={perpMode === 'contracts' ? 0.0001 : 0.01}
                    step={perpMode === 'contracts' ? 0.001 : 1}
                    value={perpMode === 'contracts' ? perpQty : perpUsdTotal}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (perpMode === 'contracts') {
                        setPerpQty(Number.isFinite(val) ? Math.abs(val) : 0);
                      } else {
                        setPerpUsdTotal(Number.isFinite(val) ? Math.abs(val) : 0);
                      }
                    }}
                  />
                  <select
                    value={perpMode}
                    onChange={(e) => {
                      const next = e.target.value as 'contracts' | 'usd';
                      if (next === perpMode) return;
                      const mid = midPrice(tickers['ETHUSDT']);
                      if (next === 'usd') {
                        const qtyVal = Number(perpQty);
                        if (Number.isFinite(qtyVal) && qtyVal > 0 && mid != null && mid > 0) {
                          setPerpUsdTotal(Number((qtyVal * mid).toFixed(2)));
                        }
                      } else {
                        const usdVal = Math.abs(Number(perpUsdTotal));
                        if (Number.isFinite(usdVal) && usdVal > 0 && mid != null && mid > 0) {
                          setPerpQty(Number((usdVal / mid).toFixed(4)));
                        }
                      }
                      setPerpMode(next);
                    }}
                  >
                    <option value="contracts">Contracts</option>
                    <option value="usd">USD</option>
                  </select>
                </div>
              </label>
              <div style={{display:'flex', alignItems:'flex-end'}}>
                <button
                  className="ghost"
                  style={{border:'2px solid var(--border-strong, var(--border))'}}
                  onClick={addPerpLeg}
                  disabled={!canAddPerp}
                >
                  Add Perp (ETHUSDT)
                </button>
              </div>
            </div>
            <div className="muted" style={{marginTop:4}}>USD amount converts to contracts using the current mid {midEth != null ? `$${midEth.toFixed(2)}` : '—'}; if pricing is unavailable, USD mode is temporarily disabled.</div>
          </div>

          <div style={{marginTop:12}}>
            <div className="muted">Legs</div>
            {draft.length===0 ? <div className="muted">No legs</div> : (
              <div style={{overflowX:'auto'}}>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Expiry</th>
                      <th>Strike</th>
                      <th>Side</th>
                      <th>Qty</th>
                      <th>Entry</th>
                      <th>Mid now</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((L, idx)=>{
                      const isPerp = !String(L.leg.symbol).includes('-');
                      const t = tickers[L.leg.symbol] || {}; const m = midPrice(t);
                      return (
                        <tr key={idx} style={L.hidden ? { background: 'rgba(128,128,128,.12)' } : undefined}>
                          <td>{isPerp ? 'PERP' : L.leg.optionType}</td>
                          <td>{isPerp ? '' : new Date(L.leg.expiryMs).toISOString().slice(0,10)}</td>
                          <td>{isPerp ? '—' : L.leg.strike}</td>
                          <td>{sideLabel(L.side)}</td>
                          <td>
                            <input style={{width:90}} type="number" min={0.1} step={0.1} value={L.qty} onChange={(e)=>setLegQty(idx, Number(e.target.value)||L.qty)} />
                          </td>
                          <td>{Number.isFinite(L.entryPrice) ? L.entryPrice.toFixed(2) : '—'}</td>
                          <td>{m!=null? `$${m.toFixed(2)}`: '—'}</td>
                          <td>
                            <button type="button" className="ghost" onClick={(e)=>{ e.stopPropagation(); toggleHide(idx); }} style={{marginRight:6, cursor:'pointer'}}>{L.hidden ? 'Unhide' : 'Hide'}</button>
                            <button type="button" className="ghost" onClick={(e)=>{ e.stopPropagation(); removeLeg(idx); }} style={{cursor:'pointer'}}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{display:'flex', justifyContent:'space-between', marginTop:8}}>
              <button className="ghost" style={{color:'#c62828'}} onClick={()=>{ if (window.confirm('Delete this position? This cannot be undone.')) { removePosition(id); onClose(); } }}>Delete position</button>
              <div>
                <button className="primary" onClick={save} disabled={!draft.length}>Save</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
