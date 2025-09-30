export function inferUnderlyingSpotSymbol(raw: string | undefined): string | null {
  const sym = String(raw || '').trim();
  if (!sym) return null;
  const upper = sym.toUpperCase();

  if (upper.includes('-')) {
    const base = upper.split('-')[0]?.replace(/[^A-Z0-9]/g, '');
    if (base) return `${base}USDT`;
  }

  if (upper.endsWith('USDT')) return upper;
  if (upper.endsWith('USDC')) return `${upper.slice(0, -4)}USDT`;
  if (upper.endsWith('USD')) return `${upper.slice(0, -3)}USDT`;

  const cleaned = upper.replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  return `${cleaned}USDT`;
}
