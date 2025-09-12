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

// Implied volatility via bisection. Returns sigma or undefined if out of bounds.
export function bsImpliedVol(optionType: 'C' | 'P', S: number, K: number, T: number, price: number, r = 0): number | undefined {
  const eps = 1e-9;
  if (!(S > 0) || !(K > 0) || !(T > eps) || !(price >= 0)) return undefined;
  // No-arbitrage rough bounds: price must be within [intrinsic, S] range
  const intrinsic = optionType === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (price < intrinsic - 1e-8) return undefined;
  let lo = 1e-4, hi = 5.0; // 0.01% .. 500% vol
  // Ensure price(lo) <= price <= price(hi)
  const f = (sig: number) => bsPrice(optionType, S, K, T, Math.max(sig, 1e-8), r);
  let flo = f(lo) - price;
  let fhi = f(hi) - price;
  // Expand hi if needed (rare)
  let iterGuard = 0;
  while (fhi < 0 && hi < 50 && iterGuard++ < 20) { hi *= 1.8; fhi = f(hi) - price; }
  if (flo * fhi > 0) {
    // Try a crude Newton step from mid as last resort
    const mid = Math.max(1e-4, Math.min(hi, 0.5));
    let sigma = mid;
    for (let i = 0; i < 8; i++) {
      const v = f(sigma) - price;
      // Finite difference derivative dPrice/dSigma
      const step = Math.max(1e-5, sigma * 1e-3);
      const dv = (f(sigma + step) - f(sigma - step)) / (2 * step);
      if (!isFinite(dv) || Math.abs(dv) < 1e-9) break;
      sigma = Math.max(1e-6, sigma - v / dv);
      if (Math.abs(v) < 1e-6) return sigma;
    }
    return undefined;
  }
  // Bisection
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const fmid = f(mid) - price;
    if (Math.abs(fmid) < 1e-6 || (hi - lo) < 1e-6) return mid;
    if (flo * fmid <= 0) { hi = mid; fhi = fmid; } else { lo = mid; flo = fmid; }
  }
  return 0.5 * (lo + hi);
}
