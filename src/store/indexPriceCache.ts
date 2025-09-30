type Listener = (value?: number) => void;

const state = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

export function getIndexPrice(symbol: string): number | undefined {
  return state.get(symbol);
}

export function setIndexPrice(symbol: string, value: number): void {
  if (!symbol) return;
  if (!Number.isFinite(value)) return;
  const rounded = Number(value);
  const prev = state.get(symbol);
  if (prev === rounded) return;
  state.set(symbol, rounded);
  const subs = listeners.get(symbol);
  if (!subs || !subs.size) return;
  subs.forEach((cb) => {
    try { cb(rounded); } catch {}
  });
}

export function subscribeIndexPrice(symbol: string, listener: Listener): () => void {
  if (!symbol) return () => {};
  if (!listeners.has(symbol)) listeners.set(symbol, new Set());
  const set = listeners.get(symbol)!;
  set.add(listener);
  const current = state.get(symbol);
  if (current != null) {
    try { listener(current); } catch {}
  }
  return () => {
    const bucket = listeners.get(symbol);
    if (!bucket) return;
    bucket.delete(listener);
    if (!bucket.size) listeners.delete(symbol);
  };
}
