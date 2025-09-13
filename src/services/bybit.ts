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
      const single = await getJson<R>(`${API}/v5/market/instruments-info?category=option&baseCoin=ETH`);
      collected.push(...(single?.result?.list ?? []));
    }
  } catch {
    // Hard fallback: non-paginated call
    try {
      const single = await getJson<R>(`${API}/v5/market/instruments-info?category=option&baseCoin=ETH`);
      collected.push(...(single?.result?.list ?? []));
    } catch {}
  }

  return collected.map((it: any) => {
    const symbol: string = it.symbol;
    const parts = String(symbol || '').split('-');
    const strikeParsed = Number(parts?.[2]);
    const optRaw = (parts?.[3] || it?.optionsType || it?.optionType || '').toString().toUpperCase();
    const optionType = optRaw.startsWith('P') ? 'P' : 'C';
    return {
      symbol,
      strike: Number.isFinite(strikeParsed) ? strikeParsed : NaN,
      optionType,
      deliveryTime: Number(it?.deliveryTime ?? it?.deliveryDate ?? 0),
      status: it?.status
    } as InstrumentInfo;
  });
}

// All ETH option tickers (includes greeks for options)
export async function fetchOptionTickers(): Promise<Ticker[]> {
  type R = { retCode: number; result?: { list: any[] } };
  const data = await getJson<R>(`${API}/v5/market/tickers?category=option&baseCoin=ETH`);
  const list = data?.result?.list ?? [];
  return list.map((t: any) => ({
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

export async function fetchSpotEth(): Promise<{ price: number; change24h?: number }> {
  type R = { retCode: number; result?: { list: any[] } };
  const data = await getJson<R>(`${API}/v5/market/tickers?category=spot&symbol=ETHUSDT`);
  const t = data?.result?.list?.[0];
  const last = Number(t?.lastPrice ?? t?.lastPrice ?? NaN);
  const prev = Number(t?.prevPrice24h ?? NaN);
  const change = isFinite(last) && isFinite(prev) ? ((last - prev) / prev) * 100 : undefined;
  return { price: last, change24h: change };
}

export async function fetchHV30(): Promise<number | undefined> {
  type Item = { value?: string | number; hv?: string | number; time?: string | number } | [number, number] | [string, string] | any;
  type R = { retCode: number; result?: { list: Item[] } };
  const data = await getJson<R>(`${API}/v5/market/historical-volatility?category=option&baseCoin=ETH&period=30`);
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
  if (!nums.length) return undefined;
  return nums[nums.length - 1];
}

export function midPrice(t?: Ticker): number | undefined {
  if (!t) return undefined;
  const b = t.bid1Price;
  const a = t.ask1Price;
  if (isFinite(b as number) && isFinite(a as number)) return ((b as number) + (a as number)) / 2;
  if (isFinite(t.markPrice as number)) return t.markPrice;
  return undefined;
}
