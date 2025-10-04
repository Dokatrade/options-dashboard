import { InstrumentInfo, Ticker, SpotKline } from '../utils/types';

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
    .map((t: any) => {
      const rawMarkIv = t?.markIv != null ? Number(t.markIv) : (t?.iv != null ? Number(t.iv) : undefined);
      const markIv = rawMarkIv != null && isFinite(rawMarkIv)
        ? (Math.abs(rawMarkIv) <= 3 ? rawMarkIv * 100 : rawMarkIv)
        : undefined;
      return {
        symbol: t.symbol,
        bid1Price: Number(t?.bid1Price ?? t?.bestBidPrice ?? NaN),
        ask1Price: Number(t?.ask1Price ?? t?.bestAskPrice ?? NaN),
        markPrice: Number(t?.markPrice ?? NaN),
        markIv,
        indexPrice: t?.underlyingPrice != null ? Number(t.underlyingPrice) : (t?.indexPrice != null ? Number(t.indexPrice) : undefined),
        delta: t?.delta != null ? Number(t.delta) : undefined,
        gamma: t?.gamma != null ? Number(t.gamma) : undefined,
        vega: t?.vega != null ? Number(t.vega) : undefined,
        theta: t?.theta != null ? Number(t.theta) : undefined,
        openInterest: t?.openInterest != null ? Number(t.openInterest) : undefined,
      };
    });
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

type DeliveryCacheEntry = { price?: number; ts: number; ttl: number };
const deliveryCache = new Map<string, DeliveryCacheEntry>();
const deliveryHistoryCache = new Map<string, { list: Array<Record<string, any>>; ts: number }>();
const spotKlineCache = new Map<string, { data: SpotKline[]; ts: number; ttl: number }>();

async function getDeliveryPriceDirect(symbol: string, settleCoin?: string): Promise<number | undefined> {
  type R = { retCode: number; retMsg?: string; result?: { list?: Array<Record<string, any>> } };
  const endpoint = API.startsWith('http') ? `${API}/v5/market/delivery-price` : `${window.location.origin}${API}/v5/market/delivery-price`;
  const url = new URL(endpoint);
  url.searchParams.set('category', 'option');
  url.searchParams.set('symbol', symbol);
  if (settleCoin) url.searchParams.set('settleCoin', settleCoin);
  const data = await getJson<R>(url.toString());
  const list = data?.result?.list ?? [];
  for (const raw of list) {
    const priceCandidate = raw?.deliveryPrice ?? raw?.markPrice ?? raw?.price ?? raw?.settlePrice;
    const n = Number(priceCandidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

async function getDeliveryHistory(baseCoin: string, settleCoin?: string): Promise<Array<Record<string, any>>> {
  const cacheKey = `${baseCoin}:${settleCoin ?? ''}`;
  const cache = deliveryHistoryCache.get(cacheKey);
  if (cache && Date.now() - cache.ts < 60 * 60 * 1000) return cache.list;
  type R = { retCode: number; retMsg?: string; result?: { list?: Array<Record<string, any>> } };
  const endpoint = API.startsWith('http') ? `${API}/v5/market/delivery-history` : `${window.location.origin}${API}/v5/market/delivery-history`;
  const url = new URL(endpoint);
  url.searchParams.set('category', 'option');
  url.searchParams.set('baseCoin', baseCoin);
  if (settleCoin) url.searchParams.set('settleCoin', settleCoin);
  url.searchParams.set('limit', '200');
  try {
    const data = await getJson<R>(url.toString());
    const list = data?.result?.list ?? [];
    deliveryHistoryCache.set(cacheKey, { list, ts: Date.now() });
    return list;
  } catch {
    return [];
  }
}

export async function fetchOptionDeliveryPrice(symbol: string): Promise<number | undefined> {
  const cache = deliveryCache.get(symbol);
  if (cache && Date.now() - cache.ts < cache.ttl) return cache.price;
  const parts = symbol.split('-');
  const baseCoin = (parts[0] ?? '').toUpperCase();
  const settleCoin = (parts[parts.length - 1] ?? '').toUpperCase();
  try {
    const direct = await getDeliveryPriceDirect(symbol, settleCoin);
    if (Number.isFinite(direct) && (direct as number) > 0) {
      deliveryCache.set(symbol, { price: direct, ts: Date.now(), ttl: 12 * 60 * 60 * 1000 });
      return direct;
    }
  } catch (err) {
    console.warn('[delivery-price] symbol request failed', symbol, err);
  }

  if (baseCoin) {
    try {
      const hist = await getDeliveryHistory(baseCoin, settleCoin);
      for (const raw of hist) {
        const sym = (raw?.symbol ?? raw?.optionSymbol ?? '').toString();
        if (sym && sym !== symbol) continue;
        const priceCandidate = raw?.deliveryPrice ?? raw?.markPrice ?? raw?.price ?? raw?.settlePrice;
        const n = Number(priceCandidate);
        if (Number.isFinite(n) && n > 0) {
          deliveryCache.set(symbol, { price: n, ts: Date.now(), ttl: 12 * 60 * 60 * 1000 });
          return n;
        }
      }
    } catch (err) {
      console.warn('[delivery-history] lookup failed', symbol, err);
    }
  }

  deliveryCache.set(symbol, { price: undefined, ts: Date.now(), ttl: 5 * 60 * 1000 });
  return undefined;
}

export async function fetchSpotKlines(params: { symbol?: string; interval?: string; limit?: number; cacheMs?: number; start?: number; end?: number } = {}): Promise<SpotKline[]> {
  const { symbol = 'ETHUSDT', interval = '60', limit = 200, cacheMs = 60_000, start, end } = params;
  const cacheKey = `${symbol}:${interval}:${limit}:${start ?? ''}:${end ?? ''}`;
  const cached = spotKlineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cached.ttl) return cached.data;

  type R = { retCode: number; result?: { list?: Array<Array<string | number>> } };
  const basePath = '/v5/market/kline';
  let url: URL;
  if (API.startsWith('http')) {
    url = new URL(`${API}${basePath}`);
  } else {
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    url = new URL(`${API}${basePath}`, origin);
  }
  url.searchParams.set('category', 'spot');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));
  if (start != null) url.searchParams.set('start', String(Math.max(0, Math.floor(start))));
  if (end != null) url.searchParams.set('end', String(Math.max(0, Math.floor(end))));
  const data = await getJson<R>(url.toString());
  const list = data?.result?.list ?? [];
  const parsed = list
    .map((row: any): SpotKline | undefined => {
      if (!Array.isArray(row) || row.length < 5) return undefined;
      const openTime = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volumeRaw = row[5] != null ? Number(row[5]) : undefined;
      if (![openTime, open, high, low, close].every((v) => Number.isFinite(v))) return undefined;
      return {
        openTime,
        open,
        high,
        low,
        close,
        volume: volumeRaw != null && Number.isFinite(volumeRaw) ? volumeRaw : undefined,
      };
    })
    .filter(Boolean) as SpotKline[];

  spotKlineCache.set(cacheKey, { data: parsed, ts: Date.now(), ttl: cacheMs });
  return parsed;
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
