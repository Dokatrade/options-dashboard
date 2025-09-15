export function ensureUsdtSymbol(raw: string): string {
  const sym = String(raw || '').trim();
  if (!sym) return sym;

  const parts = sym.split('-');
  if (parts.length >= 5) {
    const settle = (parts[4] || '').toUpperCase();
    if (settle === 'USDT') return parts.join('-');
    if (settle === 'USDC') {
      parts[4] = 'USDT';
      return parts.join('-');
    }
    return sym;
  }

  if (parts.length >= 4) {
    const opt = (parts[3] || '').toUpperCase();
    if (opt.startsWith('P') || opt.startsWith('C')) {
      return `${parts.slice(0, 4).join('-')}-USDT`;
    }
  }

  if (sym.toUpperCase().endsWith('-USDT')) return sym;
  if (sym.toUpperCase().endsWith('-USDC')) return `${sym.slice(0, -5)}-USDT`;

  return sym;
}
