import type { Ticker } from '../utils/types';

type Cb = (t: Ticker) => void;

type Conn = {
  url: string;
  ws: WebSocket | null;
  open: boolean;
  reconnectDelay: number;
  subs: Map<string, Set<Cb>>; // key: symbol
};

const MAX_DELAY = 15000;
const conns = new Map<string, Conn>();

function getConn(url: string): Conn {
  let c = conns.get(url);
  if (c) return c;
  c = { url, ws: null, open: false, reconnectDelay: 1000, subs: new Map() };
  conns.set(url, c);
  return c;
}

function connect(conn: Conn) {
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;
  conn.ws = new WebSocket(conn.url);
  conn.open = false;

  conn.ws.addEventListener('open', () => {
    conn.open = true;
    conn.reconnectDelay = 1000;
    const args = Array.from(conn.subs.keys()).map((s) => `tickers.${s}`);
    if (args.length) conn.ws?.send(JSON.stringify({ op: 'subscribe', args }));
  });

  conn.ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const topic: string | undefined = msg?.topic;
      const data = msg?.data ?? msg?.result?.list ?? msg?.result?.data;
      if (!topic || !data) return;
      if (!topic.startsWith('tickers')) return;
      const arr = Array.isArray(data) ? data : [data];
      for (const t of arr) {
        const ticker: Ticker = {
          symbol: t.symbol,
          bid1Price: t.bid1Price != null ? Number(t.bid1Price) : (t.bestBidPrice != null ? Number(t.bestBidPrice) : (t.bidPrice != null ? Number(t.bidPrice) : undefined)),
          ask1Price: t.ask1Price != null ? Number(t.ask1Price) : (t.bestAskPrice != null ? Number(t.bestAskPrice) : (t.askPrice != null ? Number(t.askPrice) : undefined)),
          markPrice: t.markPrice != null ? Number(t.markPrice) : (t.lastPrice != null ? Number(t.lastPrice) : undefined),
          lastPrice: t.lastPrice != null ? Number(t.lastPrice) : undefined,
          price24hPcnt: t.price24hPcnt != null ? Number(t.price24hPcnt) : undefined,
          markIv: t.markIv != null ? Number(t.markIv) : undefined,
          indexPrice: t.underlyingPrice != null ? Number(t.underlyingPrice) : (t.indexPrice != null ? Number(t.indexPrice) : undefined),
          delta: t.delta != null ? Number(t.delta) : undefined,
          gamma: t.gamma != null ? Number(t.gamma) : undefined,
          vega: t.vega != null ? Number(t.vega) : undefined,
          theta: t.theta != null ? Number(t.theta) : undefined,
          openInterest: t.openInterest != null ? Number(t.openInterest) : undefined,
        };
        const cbs = conn.subs.get(ticker.symbol);
        if (cbs && cbs.size) cbs.forEach((cb) => cb(ticker));
      }
    } catch {
      // ignore
    }
  });

  conn.ws.addEventListener('close', () => {
    conn.open = false;
    setTimeout(() => connect(conn), conn.reconnectDelay);
    conn.reconnectDelay = Math.min(MAX_DELAY, conn.reconnectDelay * 1.7);
  });

  conn.ws.addEventListener('error', () => {
    try { conn.ws?.close(); } catch {}
  });

  const ping = setInterval(() => {
    if (conn.open) {
      try { conn.ws?.send(JSON.stringify({ op: 'ping' })); } catch {}
    }
  }, 15000);
  conn.ws.addEventListener('close', () => clearInterval(ping));
}

function subscribe(url: string, symbol: string, cb: Cb): () => void {
  const conn = getConn(url);
  if (!conn.subs.has(symbol)) conn.subs.set(symbol, new Set());
  conn.subs.get(symbol)!.add(cb);
  connect(conn);
  if (conn.open) {
    try { conn.ws?.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${symbol}`] })); } catch {}
  }
  return () => {
    const set = conn.subs.get(symbol);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      conn.subs.delete(symbol);
      if (conn.open) {
        try { conn.ws?.send(JSON.stringify({ op: 'unsubscribe', args: [`tickers.${symbol}`] })); } catch {}
      }
    }
  };
}

const WS_OPTION = 'wss://stream.bybit.com/v5/public/option';
const WS_SPOT = 'wss://stream.bybit.com/v5/public/spot';

export function subscribeOptionTicker(symbol: string, cb: Cb) {
  return subscribe(WS_OPTION, symbol, cb);
}

export function subscribeSpotTicker(symbol: string, cb: Cb) {
  return subscribe(WS_SPOT, symbol, cb);
}

// Backward compatibility alias (options)
export const subscribeTicker = subscribeOptionTicker;
