import React from 'react';
import { fetchInstruments, fetchOptionTickers, midPrice, bestBidAsk, fetchOrderbookL1, fetchSpotEth } from '../services/bybit';
import { subscribeOptionTicker, subscribeSpotTicker } from '../services/ws';
import { useSlowMode } from '../contexts/SlowModeContext';
import { useStore, DEFAULT_PORTFOLIO_ID } from '../store/store';
import type { InstrumentInfo, Leg, OptionType, SpreadPosition } from '../utils/types';
import { ensureUsdtSymbol } from '../utils/symbols';
import { FiltersPanel } from './add-position/FiltersPanel';
import { OptionChainTable } from './add-position/OptionChainTable';
import { SelectionPanel } from './add-position/SelectionPanel';
import { DraftTable } from './add-position/DraftTable';
import type { ChainRow, DraftLeg } from './add-position/types';
import { describeStrategy, type StrategyLeg } from '../utils/strategyDetection';

const MONTH_CODES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'] as const;
const MONTH_INDEX: Record<string, number> = MONTH_CODES.reduce((acc, code, idx) => ({ ...acc, [code]: idx }), {} as Record<string, number>);

export function AddPosition() {
  const addSpread = useStore((s) => s.addSpread);
  const addPosition = useStore((s) => s.addPosition);
  const activePortfolioId = useStore((s) => s.activePortfolioId);
  const portfolios = useStore((s) => s.portfolios);
  const createPortfolio = useStore((s) => s.createPortfolio);
  const [loading, setLoading] = React.useState(false);
  const [instruments, setInstruments] = React.useState<InstrumentInfo[]>([]);
  const [optType, setOptType] = React.useState<OptionType>('P');
  const [expiry, setExpiry] = React.useState<number | ''>('');
  const [chain, setChain] = React.useState<InstrumentInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = React.useState<string>('');
  const [qty, setQty] = React.useState<number>(1);
  const [draft, setDraft] = React.useState<DraftLeg[]>([]);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [deltaMin, setDeltaMin] = React.useState<number>(0.15);
  const [deltaMax, setDeltaMax] = React.useState<number>(0.30);
  const [minOI, setMinOI] = React.useState<number>(0);
  const [maxSpread, setMaxSpread] = React.useState<number>(9999);
  const [showAllStrikes, setShowAllStrikes] = React.useState<boolean>(false);
  const [perpQty, setPerpQty] = React.useState<number>(1);
  const [perpNotional, setPerpNotional] = React.useState<number>(0);
  const [perpQtySource, setPerpQtySource] = React.useState<'contracts' | 'usd'>('contracts');
  const { slowMode, register } = useSlowMode();
  const mountedRef = React.useRef(true);
  const chainRef = React.useRef<InstrumentInfo[]>([]);
  const draftRef = React.useRef<DraftLeg[]>([]);
  const [portfolioId, setPortfolioId] = React.useState<string>(() => activePortfolioId ?? DEFAULT_PORTFOLIO_ID);
  const [showCreatePortfolio, setShowCreatePortfolio] = React.useState(false);
  const [newPortfolioName, setNewPortfolioName] = React.useState('');
  const [newPortfolioError, setNewPortfolioError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPortfolioId((current) => {
      const exists = portfolios.some((p) => p.id === current);
      if (exists) return current;
      const fallback = portfolios.find((p) => p.id === activePortfolioId)?.id;
      return fallback ?? DEFAULT_PORTFOLIO_ID;
    });
  }, [activePortfolioId, portfolios]);

  const handleCreatePortfolio = React.useCallback(() => {
    const trimmed = newPortfolioName.trim();
    if (!trimmed) {
      setNewPortfolioError('Введите название');
      return;
    }
    const exists = portfolios.some((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setNewPortfolioError('Портфель с таким названием уже существует');
      return;
    }
    const id = createPortfolio(trimmed);
    if (!id) {
      setNewPortfolioError('Не удалось создать портфель');
      return;
    }
    setPortfolioId(id);
    setShowCreatePortfolio(false);
    setNewPortfolioName('');
    setNewPortfolioError(null);
  }, [createPortfolio, newPortfolioName, portfolios]);

  const mergeTickerUpdate = React.useCallback((sym: string, payload: Record<string, any>) => {
    setTickers(prev => {
      const cur = prev[sym] || {};
      const merged: any = { ...cur };
      for (const [key, value] of Object.entries(payload)) {
        if (value == null) continue;
        if (typeof value === 'number' && Number.isNaN(value)) continue;
        merged[key] = value;
      }
      return { ...prev, [sym]: merged };
    });
  }, []);

  const captureRealtimeSnapshot = React.useCallback(async (symbols: string[]) => {
    const limited = symbols.slice(0, 180);
    await Promise.all(limited.map((sym) => new Promise<void>((resolve) => {
      let resolved = false;
      const stop = (sym.includes('-') ? subscribeOptionTicker : subscribeSpotTicker)(sym, (t) => {
        if (resolved) return;
        resolved = true;
        mergeTickerUpdate(sym, t as Record<string, any>);
        stop();
        resolve();
      });
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try { stop(); } catch {}
        resolve();
      }, 500);
    })));
  }, [mergeTickerUpdate]);

  React.useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshInstruments = React.useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const list = await fetchInstruments();
      if (!mountedRef.current) return;
      const active = list.filter((i) => i.deliveryTime > Date.now() && isFinite(i.strike));
      setInstruments(active);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshInstruments().catch(() => {});
    const interval = setInterval(() => {
      refreshInstruments().catch(() => {});
    }, slowMode ? 10 * 60 * 1000 : 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshInstruments, slowMode]);

  React.useEffect(() => {
    chainRef.current = chain;
  }, [chain]);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    const expiryCode = (ms: number): string => {
      const d = new Date(ms);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const m = MONTH_CODES[d.getUTCMonth()];
      const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
      return `${dd}${m}${yy}`;
    };
    const parseSymbol = (raw: string) => {
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
    };
    const mk = (exp: number | '', type: OptionType) => {
      if (!exp) return [] as InstrumentInfo[];
      const map = new Map<string, InstrumentInfo>();
      instruments
        .filter((i) => i.deliveryTime === exp && i.optionType === type)
        .forEach((i) => {
          const key = ensureUsdtSymbol(i.symbol);
          map.set(key, { ...i, symbol: key });
        });

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
    };
    setChain(mk(expiry, optType));
  }, [expiry, instruments, optType, tickers]);

  const performSlowRefresh = React.useCallback(async () => {
    const [list, spotData] = await Promise.all([
      fetchOptionTickers(),
      fetchSpotEth().catch(() => undefined),
    ]);
    if (!mountedRef.current) return;
    setTickers(prev => {
      const next = { ...prev } as Record<string, any>;
      list.forEach((t) => {
        const sym = t.symbol;
        const cur = next[sym] || {};
        const merged: any = { ...cur };
        const keys = ['bid1Price','ask1Price','markPrice','markIv','indexPrice','delta','gamma','vega','theta','openInterest'];
        for (const k of keys) {
          const freshV = (t as any)[k];
          if (freshV != null && !Number.isNaN(freshV)) merged[k] = freshV;
        }
        next[sym] = merged;
      });
      if (spotData?.price != null && isFinite(spotData.price)) {
        const price = Number(spotData.price);
        const existing = next['ETHUSDT'] || {};
        next['ETHUSDT'] = {
          ...existing,
          markPrice: price,
          indexPrice: price,
          bid1Price: existing.bid1Price ?? price,
          ask1Price: existing.ask1Price ?? price,
        };
      }
      return next;
    });

    const syms = Array.from(new Set([
      ...chainRef.current.map((i) => i.symbol),
      ...draftRef.current.map((d) => d.leg.symbol),
    ])).slice(0, 200);
    const chunkSize = 25;
    for (let i = 0; i < syms.length; i += chunkSize) {
      const chunk = syms.slice(i, i + chunkSize);
      const results = await Promise.allSettled(chunk.map(async (sym) => {
        const { bid, ask } = await fetchOrderbookL1(sym);
        return { sym, bid, ask };
      }));
      if (!mountedRef.current) return;
      const updates: Record<string, { bid?: number; ask?: number }> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { sym, bid, ask } = result.value;
          if (bid != null || ask != null) updates[sym] = { bid, ask };
        }
      }
      if (Object.keys(updates).length) {
        setTickers(prev => {
          const next = { ...prev } as Record<string, any>;
          for (const [sym, { bid, ask }] of Object.entries(updates)) {
            next[sym] = { ...(next[sym] || {}), obBid: bid, obAsk: ask };
          }
          return next;
        });
      }
    if (i + chunkSize < syms.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

    await captureRealtimeSnapshot(
      Array.from(new Set([
        ...chainRef.current.map((i) => i.symbol),
        ...draftRef.current.map((d) => d.leg.symbol),
        'ETHUSDT',
      ]))
    );
  }, [captureRealtimeSnapshot]);

  React.useEffect(() => {
    (async () => {
      try {
        await performSlowRefresh();
      } catch {}
    })();
  }, [performSlowRefresh]);

  // REST L1 fallback for visible chain symbols
  React.useEffect(() => {
    if (slowMode) return;
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
  }, [chain, draft, slowMode]);

  React.useEffect(() => {
    return register(() => performSlowRefresh());
  }, [performSlowRefresh, register]);

  React.useEffect(() => {
    if (!slowMode) return;
    performSlowRefresh().catch(() => {});
  }, [performSlowRefresh, slowMode]);

  // Load draft from localStorage
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('options-draft-v1');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.optType === 'P' || d?.optType === 'C') setOptType(d.optType);
      if (typeof d?.expiry === 'number' || d?.expiry === '') setExpiry(d.expiry);
      if (typeof d?.selectedSymbol === 'string') {
        setSelectedSymbol(d.selectedSymbol);
      } else if (typeof d?.strike === 'string') {
        setSelectedSymbol(d.strike);
      }
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
        optType, expiry, selectedSymbol, qty,
        deltaMin, deltaMax, minOI, maxSpread, showAllStrikes,
        draft,
      };
      try {
        localStorage.setItem('options-draft-v1', JSON.stringify({ ...payload, strike: selectedSymbol }));
      } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [optType, expiry, selectedSymbol, qty, deltaMin, deltaMax, minOI, maxSpread, draft, showAllStrikes]);

  // Live pricing in dropdown and draft
  React.useEffect(() => {
    if (slowMode) return;
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
  }, [chain, draft, slowMode]);

  const parseExpiryCode = React.useCallback((raw: string): number | undefined => {
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

  const expiries = React.useMemo(() => {
    const set = new Set<number>();
    draft
      .filter((d) => d.leg.optionType === optType && Number.isFinite(d.leg.expiryMs))
      .forEach((d) => set.add(Number(d.leg.expiryMs)));
    instruments
      .filter((i) => i.optionType === optType && Number.isFinite(i.deliveryTime))
      .forEach((i) => set.add(Number(i.deliveryTime)));
    Object.keys(tickers || {}).forEach((sym) => {
      if (!sym.includes('-')) return;
      const parts = sym.split('-');
      if (parts.length < 3) return;
      const code = parts[1];
      const typeChar = inferTypeChar(parts.slice(2));
      if (typeChar && typeChar !== optType) return;
      const ticker = tickers[sym];
      const expMs = Number((ticker as any)?.expiryDate ?? (ticker as any)?.deliveryTime);
      if (Number.isFinite(expMs) && expMs > 0) {
        set.add(expMs);
        return;
      }
      const ms = parseExpiryCode(code);
      if (ms) set.add(ms);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [draft, inferTypeChar, instruments, tickers, optType, parseExpiryCode]);
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

  const formatChainRow = React.useCallback((inst: InstrumentInfo): ChainRow => {
    const ticker = tickers[inst.symbol] || {};
    const { bid, ask } = bestBidAsk(ticker);
    const mid = midPrice(ticker);
    const delta = ticker?.delta != null ? Number(ticker.delta) : undefined;
    const openInterest = ticker?.openInterest != null ? Number(ticker.openInterest) : undefined;
    const spread = bid != null && ask != null ? Math.max(0, Number(ask) - Number(bid)) : undefined;
    const mark = ticker?.markPrice != null ? Number(ticker.markPrice) : undefined;
    return {
      symbol: inst.symbol,
      strike: inst.strike,
      expiryMs: inst.deliveryTime,
      optionType: inst.optionType,
      bid: bid != null ? Number(bid) : undefined,
      ask: ask != null ? Number(ask) : undefined,
      mid: mid != null ? Number(mid) : undefined,
      delta,
      openInterest,
      spread,
      mark,
    };
  }, [tickers]);

  const chainRows = React.useMemo(() => filteredChain.map(formatChainRow), [filteredChain, formatChainRow]);

  const selectedRow = React.useMemo(() => {
    if (!selectedSymbol) return undefined;
    const inFiltered = chainRows.find((row) => row.symbol === selectedSymbol);
    if (inFiltered) return inFiltered;
    const inst = chain.find((c) => c.symbol === selectedSymbol);
    return inst ? formatChainRow(inst) : undefined;
  }, [chainRows, chain, formatChainRow, selectedSymbol]);

  const spotTicker = tickers['ETHUSDT'] || {};
  const spotPrice = React.useMemo(() => {
    const mark = spotTicker?.markPrice;
    if (mark != null && !Number.isNaN(Number(mark))) return Number(mark);
    const index = spotTicker?.indexPrice;
    if (index != null && !Number.isNaN(Number(index))) return Number(index);
    return undefined;
  }, [spotTicker]);

  const handleTypeChange = React.useCallback((type: OptionType) => {
    setOptType(type);
    setExpiry('');
    setSelectedSymbol('');
  }, []);

  const handleExpiryChange = React.useCallback((value: number | '') => {
    setExpiry(value);
    setSelectedSymbol('');
  }, []);

  const handleSelectSymbol = React.useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, []);

  const handleQtyChange = React.useCallback((value: number) => {
    const clamped = Math.max(0.1, Math.round(Number(value) * 10) / 10 || 0.1);
    setQty(clamped);
  }, []);

  const handleDeltaMinChange = React.useCallback((value: number) => {
    setDeltaMin(Number.isFinite(value) ? value : 0);
  }, []);

  const handleDeltaMaxChange = React.useCallback((value: number) => {
    setDeltaMax(Number.isFinite(value) ? value : 0);
  }, []);

  const handleMinOiChange = React.useCallback((value: number) => {
    setMinOI(Math.max(0, Number.isFinite(value) ? Math.round(value) : 0));
  }, []);

  const handleMaxSpreadChange = React.useCallback((value: number) => {
    setMaxSpread(Math.max(0, Number.isFinite(value) ? value : 0));
  }, []);

  const handleShowAllToggle = React.useCallback((value: boolean) => {
    setShowAllStrikes(value);
  }, []);

  const handlePerpContractsChange = React.useCallback((value: number) => {
    const numeric = Number.isFinite(value) ? value : perpQty;
    const sanitized = Math.max(0.001, Math.round(numeric * 1000) / 1000);
    setPerpQty(sanitized);
    setPerpQtySource('contracts');
    if (spotPrice && spotPrice > 0) {
      const notional = Math.round(sanitized * spotPrice * 100) / 100;
      setPerpNotional(notional);
    }
  }, [perpQty, spotPrice]);

  const handlePerpNotionalChange = React.useCallback((value: number) => {
    const numeric = Number.isFinite(value) ? value : perpNotional;
    const sanitized = Math.max(1, Math.round(numeric * 100) / 100);
    setPerpNotional(sanitized);
    setPerpQtySource('usd');
    if (spotPrice && spotPrice > 0) {
      const contracts = Math.max(0.001, Math.round((sanitized / spotPrice) * 1000) / 1000);
      setPerpQty(contracts);
    }
  }, [perpNotional, spotPrice]);

  React.useEffect(() => {
    if (!spotPrice || spotPrice <= 0) return;
    if (perpQtySource === 'contracts') {
      const nextNotional = Math.round(perpQty * spotPrice * 100) / 100;
      setPerpNotional((prev) => (Math.abs(prev - nextNotional) > 0.01 ? nextNotional : prev));
    } else if (perpQtySource === 'usd') {
      const nextContracts = Math.max(0.001, Math.round((perpNotional / spotPrice) * 1000) / 1000);
      setPerpQty((prev) => (Math.abs(prev - nextContracts) > 0.0005 ? nextContracts : prev));
    }
  }, [spotPrice, perpQty, perpNotional, perpQtySource]);

  const updateDraftQty = React.useCallback((index: number, nextQty: number) => {
    setDraft((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      const numeric = Number.isFinite(nextQty) ? nextQty : item.qty;
      const sanitized = Math.max(0.1, Math.round(numeric * 10) / 10);
      return { ...item, qty: sanitized };
    }));
  }, []);

  const clearDraft = React.useCallback(() => {
    setDraft([]);
    try { localStorage.removeItem('options-draft-v1'); } catch {}
  }, []);

  const emptyChainMessage = expiry ? undefined : 'Select expiry to view options.';

  const addLeg = (side: 'short' | 'long') => {
    const inst = chain.find(c => c.symbol === selectedSymbol);
    if (!inst) return;
    const leg: Leg = { symbol: inst.symbol, strike: inst.strike, optionType: inst.optionType, expiryMs: inst.deliveryTime };
    const q = Math.max(0.1, Math.round(Number(qty) * 10) / 10);
    setDraft((d) => [...d, { leg, side, qty: q }]);
  };

  const addPerpLeg = (side: 'short' | 'long') => {
    const q = Math.max(0.001, Math.round(Number(perpQty) * 1000) / 1000);
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

  const strategyLabel = React.useMemo(() => {
    if (!draft.length) return '';
    const legs: StrategyLeg[] = draft.map((d) => ({
      side: d.side,
      type: d.leg.optionType,
      expiryMs: Number(d.leg.expiryMs) || 0,
      strike: Number(d.leg.strike) || 0,
      qty: Number(d.qty) || 0,
      symbol: String(d.leg.symbol || ''),
      isUnderlying: !String(d.leg.symbol || '').includes('-') || Number(d.leg.expiryMs) <= 0,
    }));
    const label = describeStrategy(legs, totalCreditPer);
    return label === '—' ? '' : label;
  }, [draft, totalCreditPer]);

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
        portfolioId,
      };
      addSpread(payload);
      setDraft([]);
      setSelectedSymbol('');
    } else {
      // Save generic multi-leg position with per-leg entry prices
      const now = Date.now();
      let legOffset = 0;
      const legs = draft.map(d => ({
        leg: d.leg,
        side: d.side,
        qty: d.qty,
        entryPrice: midPrice(tickers[d.leg.symbol]) ?? 0,
        createdAt: now + legOffset++,
      }));
      addPosition({ legs, portfolioId });
      setDraft([]);
      setSelectedSymbol('');
    }
  };

  return (
    <div className="add-position">
      <div className="add-position__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Add Position</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted">Portfolio</span>
            <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <button
            className="ghost"
            onClick={() => {
              setNewPortfolioName('');
              setNewPortfolioError(null);
              setShowCreatePortfolio(true);
            }}
          >
            Create Portfolio
          </button>
        </div>
        {loading && <div className="muted">Loading instruments…</div>}
      </div>
      <div className="add-position__grid">
        <div className="add-position__column add-position__column--filters">
          <FiltersPanel
            optType={optType}
            expiry={expiry}
            expiries={expiries}
            deltaMin={deltaMin}
            deltaMax={deltaMax}
            minOI={minOI}
            maxSpread={maxSpread}
            showAllStrikes={showAllStrikes}
            loading={loading}
            slowMode={slowMode}
            spotPrice={spotPrice}
            onTypeChange={handleTypeChange}
            onExpiryChange={handleExpiryChange}
            onDeltaMinChange={handleDeltaMinChange}
            onDeltaMaxChange={handleDeltaMaxChange}
            onMinOiChange={handleMinOiChange}
            onMaxSpreadChange={handleMaxSpreadChange}
            onToggleShowAll={handleShowAllToggle}
          />
          <SelectionPanel
            selectedRow={selectedRow}
            qty={qty}
            onQtyChange={handleQtyChange}
            onAddLeg={addLeg}
            onAddPerp={addPerpLeg}
            spotPrice={spotPrice}
            perpQty={perpQty}
            perpNotional={perpNotional}
            onPerpContractsChange={handlePerpContractsChange}
            onPerpNotionalChange={handlePerpNotionalChange}
            onClearSelection={() => setSelectedSymbol('')}
          />
        </div>
        <div className="add-position__column add-position__column--chain">
          <OptionChainTable
            rows={chainRows}
            loading={loading}
            selectedSymbol={selectedSymbol}
            onSelect={handleSelectSymbol}
            emptyMessage={emptyChainMessage}
          />
          <DraftTable
            draft={draft}
            tickers={tickers}
            canSaveAsVertical={canSaveAsVertical}
            totalCreditPer={totalCreditPer}
            strategyLabel={strategyLabel}
            onRemoveLeg={removeLeg}
            onUpdateQty={updateDraftQty}
            onClearDraft={clearDraft}
            onSave={onSave}
          />
        </div>
      </div>
      {showCreatePortfolio && (
        <div
          onClick={() => setShowCreatePortfolio(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              width: 'min(400px, 90%)',
              boxShadow: '0 10px 24px rgba(0,0,0,.35)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <strong>Create portfolio</strong>
              <button className="ghost" onClick={() => setShowCreatePortfolio(false)}>Close</button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted">Name</span>
                <input
                  type="text"
                  value={newPortfolioName}
                  onChange={(e) => {
                    setNewPortfolioName(e.target.value);
                    if (newPortfolioError) setNewPortfolioError(null);
                  }}
                  maxLength={64}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreatePortfolio();
                    }
                  }}
                  autoFocus
                />
              </label>
              {newPortfolioError && (
                <div style={{ color: 'var(--loss)' }}>{newPortfolioError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="ghost" onClick={() => setShowCreatePortfolio(false)}>Cancel</button>
                <button className="primary" onClick={handleCreatePortfolio}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
