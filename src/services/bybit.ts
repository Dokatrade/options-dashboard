import { InstrumentInfo, Ticker } from '../utils/types';

const API = import.meta.env.DEV ? '/bybit' : 'https://api.bybit.com';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Instruments metadata for ETH options
export async function fetchInstruments(): Promise<InstrumentInfo[]> {
  type R = { retCode: number; retMsg: string; result?: { list: any[]; nextPageCursor?: string } };
  const collected: any[] = [];
  try {
    let cursor: string | undefined = undefined;
    let guard = 0;
    do {
      const url = new URL(`${API}/v5/market/instruments-info`);
      url.searchParams.set('category', 'option');
      url.searchParams.set('baseCoin', 'ETH');
      url.searchParams.set('settleCoin', 'USDT');
      url.searchParams.set('quoteCoin', 'USDT');
      url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const data = await getJson<R>(url.toString());
      const list = data?.result?.list ?? [];
      collected.push(...list);
      const next = data?.result?.nextPageCursor;
      if (!next || next === cursor) break;
      cursor = next;
    } while (++guard < 10);
    // Fallback to single call if pagination yielded nothing
    if (!collected.length) {
      const single = await getJson<R>(`${API}/v5/market/instruments-info?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`);
      collected.push(...(single?.result?.list ?? []));
    }
  } catch {
    // Hard fallback: non-paginated call
    try {
      const single = await getJson<R>(`${API}/v5/market/instruments-info?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`);
      collected.push(...(single?.result?.list ?? []));
    } catch {}
  }

  return collected
    .filter((it: any) => {
      const symbol: string = it?.symbol ?? '';
      const parts = String(symbol).split('-');
      const symSettle = (parts?.[4] ?? '').toString().toUpperCase();
      const settle = (it?.settleCoin ?? it?.quoteCoin ?? it?.currency ?? '').toString().toUpperCase();
      const normalized = settle || symSettle;
      return normalized === 'USDT';
    })
    .map((it: any) => {
      const symbol: string = it.symbol;
      const parts = String(symbol || '').split('-');
      const strikeParsed = Number(parts?.[2]);
      const optRaw = (parts?.[3] || it?.optionsType || it?.optionType || '').toString().toUpperCase();
      const optionType = optRaw.startsWith('P') ? 'P' : 'C';
      const symSettle = (parts?.[4] ?? '').toString().toUpperCase();
      const settle = (it?.settleCoin ?? it?.quoteCoin ?? it?.currency ?? symSettle ?? '')?.toString();
      return {
        symbol,
        strike: Number.isFinite(strikeParsed) ? strikeParsed : NaN,
        optionType,
        deliveryTime: Number(it?.deliveryTime ?? it?.deliveryDate ?? 0),
        status: it?.status,
        settleCoin: settle || undefined,
      } as InstrumentInfo;
    });
}

// All ETH option tickers (includes greeks for options)
export async function fetchOptionTickers(): Promise<Ticker[]> {
  type R = { retCode: number; result?: { list: any[] } };
  const data = await getJson<R>(`${API}/v5/market/tickers?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`);
  const list = data?.result?.list ?? [];
  return list
    .filter((t: any) => {
      const symbol: string = t?.symbol ?? '';
      const parts = String(symbol).split('-');
      const symSettle = (parts?.[4] ?? '').toString().toUpperCase();
      const settle = (t?.settleCoin ?? t?.quoteCoin ?? t?.currency ?? '').toString().toUpperCase();
      const normalized = settle || symSettle;
      return normalized === 'USDT';
    })
    .map((t: any) => ({
      symbol: t.symbol,
      bid1Price: Number(t?.bid1Price ?? t?.bestBidPrice ?? NaN),
      ask1Price: Number(t?.ask1Price ?? t?.bestAskPrice ?? NaN),
      markPrice: Number(t?.markPrice ?? NaN),
      markIv: t?.markIv != null ? Number(t.markIv) : (t?.iv != null ? Number(t.iv) : undefined),
      indexPrice: t?.underlyingPrice != null ? Number(t.underlyingPrice) : (t?.indexPrice != null ? Number(t.indexPrice) : undefined),
      delta: t?.delta != null ? Number(t.delta) : undefined,
      gamma: t?.gamma != null ? Number(t.gamma) : undefined,
      vega: t?.vega != null ? Number(t.vega) : undefined,
      theta: t?.theta != null ? Number(t.theta) : undefined,
      openInterest: t?.openInterest != null ? Number(t.openInterest) : undefined,
    }));
}

// Fetch L1 orderbook (best bid/ask) for a specific option symbol
export async function fetchOrderbookL1(symbol: string): Promise<{ bid?: number; ask?: number }> {
  type R = { retCode: number; result?: { a?: any[]; b?: any[]; list?: any[]; } } & any;
  try {
    const url = new URL(`${API}/v5/market/orderbook`);
    url.searchParams.set('category', 'option');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('settleCoin', 'USDT');
    url.searchParams.set('quoteCoin', 'USDT');
    url.searchParams.set('limit', '1');
    const data = await getJson<R>(url.toString());
    const d: any = (data as any)?.result ?? data;
    const a0 = Array.isArray(d?.a) && d.a.length ? d.a[0] : undefined;
    const b0 = Array.isArray(d?.b) && d.b.length ? d.b[0] : undefined;
    const ask = Array.isArray(a0) && a0.length ? Number(a0[0]) : (a0 && typeof a0 === 'object' && a0.price != null ? Number(a0.price) : undefined);
    const bid = Array.isArray(b0) && b0.length ? Number(b0[0]) : (b0 && typeof b0 === 'object' && b0.price != null ? Number(b0.price) : undefined);
    return { bid: isFinite(bid as number) ? bid : undefined, ask: isFinite(ask as number) ? ask : undefined };
  } catch {
    return {};
  }
}

export async function fetchSpotEth(): Promise<{ price: number; change24h?: number }> {
  type R = { retCode: number; result?: { list: any[] } };
  const data = await getJson<R>(`${API}/v5/market/tickers?category=spot&symbol=ETHUSDT`);
  const t = data?.result?.list?.[0];
  const last = Number(t?.lastPrice ?? t?.lastPrice ?? NaN);
  const prev = Number(t?.prevPrice24h ?? NaN);
  const change = isFinite(last) && isFinite(prev) ? ((last - prev) / prev) * 100 : undefined;
  return { price: last, change24h: change };
}

export type HV30Stats = {
  latest?: number;
  min?: number;
  max?: number;
  series: number[];
};

export async function fetchHV30(): Promise<HV30Stats> {
  type Item = { value?: string | number; hv?: string | number; time?: string | number } | [number, number] | [string, string] | any;
  type R = { retCode: number; result?: { list: Item[] } };
  const data = await getJson<R>(`${API}/v5/market/historical-volatility?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT&period=30`);
  const list: Item[] = (data as any)?.result?.list ?? [];
  const toNum = (x: any): number => {
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  };
  const nums: number[] = [];
  for (const it of list) {
    if (Array.isArray(it)) {
      // Try [time, value] or [value, time]
      const a = toNum(it[0]);
      const b = toNum(it[1]);
      const v = Number.isFinite(b) ? b : (Number.isFinite(a) ? a : NaN);
      if (Number.isFinite(v)) nums.push(v);
      continue;
    }
    const v = it?.value ?? it?.hv ?? undefined;
    const n = toNum(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  const series = nums.filter((n) => Number.isFinite(n));
  if (!series.length) return { latest: undefined, min: undefined, max: undefined, series: [] };
  const latest = series[series.length - 1];
  let min = series[0];
  let max = series[0];
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { latest, min, max, series };
}

export function midPrice(t?: Ticker): number | undefined {
  if (!t) return undefined;
  const { bid, ask } = bestBidAsk(t);
  if (isFinite(bid as number) && isFinite(ask as number)) return ((bid as number) + (ask as number)) / 2;
  if (isFinite(t.markPrice as number)) return t.markPrice;
  return undefined;
}

// Normalize bid/ask: ignore non-positive or NaN values
export function bestBidAsk(t?: Ticker): { bid?: number; ask?: number } {
  if (!t) return {};
  const toNum = (x: any) => (x != null && isFinite(Number(x)) && Number(x) > 0) ? Number(x) : undefined;
  const oBid = toNum(t.obBid);
  const oAsk = toNum(t.obAsk);
  const kBid = toNum(t.bid1Price);
  const kAsk = toNum(t.ask1Price);
  // Prefer orderbook sides when available; mix with ticker as fallback per side
  let bid = oBid ?? kBid;
  let ask = oAsk ?? kAsk;
  if (bid != null && ask != null) {
    if (ask >= bid) return { bid, ask };
    // If mixed pair crosses, try pure OB pair, then pure ticker pair
    if (oBid != null && oAsk != null && oAsk >= oBid) return { bid: oBid, ask: oAsk };
    if (kBid != null && kAsk != null && kAsk >= kBid) return { bid: kBid, ask: kAsk };
    // As a last resort, drop the worse side to avoid negative spread
    return { bid, ask: undefined };
  }
  if (bid != null || ask != null) return { bid, ask };
  return {};
}
