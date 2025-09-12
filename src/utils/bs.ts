// Minimal Black–Scholes pricing utilities

function normPdf(x: number): number {
  const invSqrt2Pi = 1 / Math.sqrt(2 * Math.PI);
  return invSqrt2Pi * Math.exp(-0.5 * x * x);
}

// Abramowitz and Stegun approximation for CDF of standard normal
export function normCdf(x: number): number {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const poly = (((a5 * k + a4) * k + a3) * k + a2) * k + a1;
  const approx = 1 - normPdf(x) * poly * k;
  return x >= 0 ? approx : 1 - approx;
}

export function bsPriceCall(S: number, K: number, T: number, sigma: number, r = 0): number {
  const eps = 1e-12;
  if (T <= eps) return Math.max(0, S - K);
  if (sigma <= eps) return Math.max(0, S - K);
  const vol = sigma * Math.sqrt(T);
  const d1 = (Math.log(Math.max(S, eps) / Math.max(K, eps)) + (r + 0.5 * sigma * sigma) * T) / vol;
  const d2 = d1 - vol;
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  return S * Nd1 - K * Math.exp(-r * T) * Nd2;
}

export function bsPricePut(S: number, K: number, T: number, sigma: number, r = 0): number {
  const eps = 1e-12;
  if (T <= eps) return Math.max(0, K - S);
  if (sigma <= eps) return Math.max(0, K - S);
  const vol = sigma * Math.sqrt(T);
  const d1 = (Math.log(Math.max(S, eps) / Math.max(K, eps)) + (r + 0.5 * sigma * sigma) * T) / vol;
  const d2 = d1 - vol;
  const Nmd1 = normCdf(-d1);
  const Nmd2 = normCdf(-d2);
  return K * Math.exp(-r * T) * Nmd2 - S * Nmd1;
}

export function bsPrice(optionType: 'C' | 'P', S: number, K: number, T: number, sigma: number, r = 0): number {
  return optionType === 'C' ? bsPriceCall(S, K, T, sigma, r) : bsPricePut(S, K, T, sigma, r);
}

