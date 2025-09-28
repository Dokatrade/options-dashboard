import type { OptionType } from './types';

export type StrategyLeg = {
  side: 'long' | 'short';
  type: OptionType;
  expiryMs: number;
  strike: number;
  qty: number;
  symbol: string;
  isUnderlying?: boolean;
};

const tol = 1e-6;
const same = (a: number, b: number) => Math.abs(a - b) <= tol;
const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, 0.02 * Math.max(Math.abs(a), Math.abs(b)));

const absQty = (leg: StrategyLeg) => Math.abs(Number(leg.qty) || 0);
const sumAbs = (arr: StrategyLeg[]) => arr.reduce((acc, x) => acc + absQty(x), 0);
const sumQty = (arr: StrategyLeg[]) => arr.reduce((acc, x) => acc + (Number(x.qty) || 0), 0);

const coverageOK = (coverQty: number, optionQty: number) => {
  if (!(optionQty > 0)) return true;
  const slack = Math.max(0.01, 0.05 * optionQty);
  return coverQty + slack >= optionQty;
};

const sortedByStrike = (arr: StrategyLeg[]) => [...arr].sort((a, b) => a.strike - b.strike);

export function describeStrategy(legs: StrategyLeg[], net = 0): string {
  const active = legs.filter((leg) => absQty(leg) > 0);
  if (!active.length) return '—';

  const normalized = active.map((leg) => {
    const symbol = String(leg.symbol || '');
    const expiryMs = Number(leg.expiryMs) || 0;
    const isUnderlying = leg.isUnderlying ?? (!symbol.includes('-') || expiryMs <= 0);
    return {
      ...leg,
      symbol,
      expiryMs,
      strike: Number(leg.strike) || 0,
      qty: Number(leg.qty) || 0,
      isUnderlying,
    };
  });

  const optionLegs = normalized.filter((leg) => !leg.isUnderlying);
  const underlyingLegs = normalized.filter((leg) => leg.isUnderlying);

  if (!optionLegs.length && underlyingLegs.length) {
    if (underlyingLegs.length === 1) return underlyingLegs[0].side === 'long' ? 'Long Underlying' : 'Short Underlying';
    const longQty = sumAbs(underlyingLegs.filter((leg) => leg.side === 'long'));
    const shortQty = sumAbs(underlyingLegs.filter((leg) => leg.side === 'short'));
    if (approx(longQty, shortQty) && longQty > 0) return 'Hedged Underlying Pair';
    return 'Underlying Combo';
  }

  if (underlyingLegs.length) {
    const longUnderQty = sumAbs(underlyingLegs.filter((leg) => leg.side === 'long'));
    const shortUnderQty = sumAbs(underlyingLegs.filter((leg) => leg.side === 'short'));

    const qtyMatches = (legsToCheck: StrategyLeg[], target: number) => legsToCheck.every((leg) => coverageOK(target, absQty(leg)));

    if (longUnderQty > 0 && !shortUnderQty) {
      const shortCalls = optionLegs.filter((leg) => leg.type === 'C' && leg.side === 'short');
      const otherOpts = optionLegs.filter((leg) => !(leg.type === 'C' && leg.side === 'short'));
      if (shortCalls.length && !otherOpts.length) {
        const totalShortCalls = sumAbs(shortCalls);
        if (coverageOK(longUnderQty, totalShortCalls)) return shortCalls.length === 1 ? 'Covered Call' : 'Covered Calls';
      }
      if (optionLegs.length === 1) {
        const opt = optionLegs[0];
        if (coverageOK(longUnderQty, absQty(opt))) {
          if (opt.type === 'C' && opt.side === 'short') return 'Covered Call';
          if (opt.type === 'P' && opt.side === 'long') return 'Protective Put';
        }
      }
      if (optionLegs.length === 2) {
        const shortCallsSingle = optionLegs.filter((leg) => leg.type === 'C' && leg.side === 'short');
        const longPuts = optionLegs.filter((leg) => leg.type === 'P' && leg.side === 'long');
        const shortPuts = optionLegs.filter((leg) => leg.type === 'P' && leg.side === 'short');
        const longCalls = optionLegs.filter((leg) => leg.type === 'C' && leg.side === 'long');
        if (shortCallsSingle.length === 1 && longPuts.length === 1 && qtyMatches([shortCallsSingle[0], longPuts[0]], longUnderQty)) {
          const sameExpiry = same(shortCallsSingle[0].expiryMs, longPuts[0].expiryMs);
          return sameExpiry ? 'Collar' : 'Diagonal Collar';
        }
        if (shortCallsSingle.length === 1 && shortPuts.length === 1 && qtyMatches([shortCallsSingle[0], shortPuts[0]], longUnderQty)) {
          return 'Covered Strangle';
        }
        if (longCalls.length === 1 && longPuts.length === 1 && qtyMatches([longCalls[0], longPuts[0]], longUnderQty)) {
          return 'Protective Strangle';
        }
      }
    }

    if (shortUnderQty > 0 && !longUnderQty) {
      const shortPuts = optionLegs.filter((leg) => leg.type === 'P' && leg.side === 'short');
      const otherOpts = optionLegs.filter((leg) => !(leg.type === 'P' && leg.side === 'short'));
      if (shortPuts.length && !otherOpts.length) {
        const totalShortPuts = sumAbs(shortPuts);
        if (coverageOK(shortUnderQty, totalShortPuts)) return shortPuts.length === 1 ? 'Covered Put' : 'Covered Puts';
      }
      if (optionLegs.length === 1) {
        const opt = optionLegs[0];
        if (coverageOK(shortUnderQty, absQty(opt))) {
          if (opt.type === 'P' && opt.side === 'short') return 'Covered Put';
          if (opt.type === 'C' && opt.side === 'long') return 'Protective Call';
        }
      }
      if (optionLegs.length === 2) {
        const longCalls = optionLegs.filter((leg) => leg.type === 'C' && leg.side === 'long');
        const shortPutsSingle = optionLegs.filter((leg) => leg.type === 'P' && leg.side === 'short');
        const longPuts = optionLegs.filter((leg) => leg.type === 'P' && leg.side === 'long');
        const shortCalls = optionLegs.filter((leg) => leg.type === 'C' && leg.side === 'short');
        if (longCalls.length === 1 && shortPutsSingle.length === 1 && qtyMatches([longCalls[0], shortPutsSingle[0]], shortUnderQty)) {
          const sameExpiry = same(longCalls[0].expiryMs, shortPutsSingle[0].expiryMs);
          return sameExpiry ? 'Reverse Collar' : 'Reverse Diagonal Collar';
        }
        if (shortCalls.length === 1 && shortPutsSingle.length === 1 && qtyMatches([shortCalls[0], shortPutsSingle[0]], shortUnderQty)) {
          return 'Covered Short Strangle';
        }
        if (longCalls.length === 1 && longPuts.length === 1 && qtyMatches([longCalls[0], longPuts[0]], shortUnderQty)) {
          return 'Protective Short Strangle';
        }
      }
    }

    if (approx(longUnderQty, shortUnderQty) && longUnderQty > 0) return 'Delta-Neutral Stock Hedge';
    return 'Stock & Options Combo';
  }

  const optionCount = optionLegs.length;
  if (!optionCount) return 'Custom Strategy';

  const allSameExp = optionLegs.every((leg) => same(leg.expiryMs, optionLegs[0].expiryMs));
  const allSameType = optionLegs.every((leg) => leg.type === optionLegs[0].type);
  const byType = (type: OptionType) => optionLegs.filter((leg) => leg.type === type);
  const bySide = (side: 'long' | 'short') => optionLegs.filter((leg) => leg.side === side);

  // Single-leg
  if (optionCount === 1) {
    const a = optionLegs[0];
    const sideLabel = a.side === 'long' ? 'Long' : 'Short';
    const typeLabel = a.type === 'C' ? 'Call' : 'Put';
    return `${sideLabel} ${typeLabel}`;
  }

  // Two legs
  if (optionCount === 2) {
    const [a, b] = optionLegs;
    const sameType = a.type === b.type;
    const sameExp = same(a.expiryMs, b.expiryMs);
    const sameStrike = same(a.strike, b.strike);
    const bothLong = a.side === 'long' && b.side === 'long';
    const bothShort = a.side === 'short' && b.side === 'short';
    const opposite = a.side !== b.side;

    if (!sameType && sameExp) {
      if (bothLong) return sameStrike ? 'Long Straddle' : 'Long Strangle';
      if (bothShort) return sameStrike ? 'Short Straddle' : 'Short Strangle';
    }

    if (sameType && opposite) {
      const typ = a.type === 'C' ? 'Call' : 'Put';
      if (!sameExp && sameStrike) {
        const longIsLater = (a.side === 'long' ? a : b).expiryMs > (a.side === 'short' ? a : b).expiryMs;
        return `${longIsLater ? 'Long' : 'Short'} ${typ} Calendar`;
      }
      if (!sameExp && !sameStrike) {
        const longIsLater = (a.side === 'long' ? a : b).expiryMs > (a.side === 'short' ? a : b).expiryMs;
        return `${longIsLater ? 'Long' : 'Short'} ${typ} Diagonal`;
      }
      if (sameExp && !sameStrike) {
        const longK = (a.side === 'long' ? a : b).strike;
        const shortK = (a.side === 'short' ? a : b).strike;
        const isCredit = net > 0;
        if (typ === 'Call') {
          const bull = longK < shortK;
          return `${bull ? 'Bull' : 'Bear'} Call ${isCredit ? 'Credit' : 'Debit'} Spread`;
        } else {
          const bull = shortK > longK;
          return `${bull ? 'Bull' : 'Bear'} Put ${isCredit ? 'Credit' : 'Debit'} Spread`;
        }
      }
    }
  }

  // Three legs
  if (optionCount === 3) {
    if (allSameExp && allSameType) {
      const sorted = sortedByStrike(optionLegs);
      const signedQty = sorted.map((leg) => (leg.side === 'long' ? 1 : -1) * (Number(leg.qty) || 0));
      const isButterflyLike = same(Math.abs(signedQty[0]), Math.abs(signedQty[2])) && same(Math.abs(signedQty[1]), Math.abs(signedQty[0] + signedQty[2]));
      if (isButterflyLike) {
        const longWings = signedQty[0] > 0 && signedQty[2] > 0 && signedQty[1] < 0;
        const shortWings = signedQty[0] < 0 && signedQty[2] < 0 && signedQty[1] > 0;
        const wingLeft = sorted[1].strike - sorted[0].strike;
        const wingRight = sorted[2].strike - sorted[1].strike;
        const broken = !same(wingLeft, wingRight);
        const typ = optionLegs[0].type === 'C' ? 'Call' : 'Put';
        if (longWings) return `${broken ? 'Broken Wing ' : ''}Long ${typ} Butterfly`;
        if (shortWings) return `${broken ? 'Broken Wing ' : ''}Short ${typ} Butterfly`;
      }
      const longs = bySide('long');
      const shorts = bySide('short');
      if ((longs.length === 1 && shorts.length === 2) || (longs.length === 2 && shorts.length === 1)) {
        const typ = optionLegs[0].type === 'C' ? 'Call' : 'Put';
        const lq = sumQty(longs);
        const sq = sumQty(shorts);
        const ratio = `${Math.round(Math.abs(lq))}x${Math.round(Math.abs(sq))}`;
        return `Ratio ${typ} Spread (${ratio})`;
      }
    }
    return 'Three-leg Combo';
  }

  // Four legs
  if (optionCount === 4) {
    const calls = byType('C');
    const puts = byType('P');
    if (allSameExp) {
      if (calls.length === 2 && puts.length === 2) {
        const cKs = sortedByStrike(calls).map((leg) => leg.strike);
        const pKs = sortedByStrike(puts).map((leg) => leg.strike);
        const midK = cKs.find((k) => pKs.includes(k));
        if (midK != null) {
          const cMid = calls.find((leg) => same(leg.strike, midK));
          const pMid = puts.find((leg) => same(leg.strike, midK));
          const wings = optionLegs.filter((leg) => !same(leg.strike, midK));
          if (cMid && pMid && wings.length === 2) {
            const midsShort = cMid.side === 'short' && pMid.side === 'short';
            const midsLong = cMid.side === 'long' && pMid.side === 'long';
            if (midsShort) return 'Short Iron Butterfly';
            if (midsLong) return 'Long Iron Butterfly';
          }
        }
        const c = sortedByStrike(calls);
        const p = sortedByStrike(puts);
        const strictlyLess = (a: number, b: number) => a + tol < b;
        const strikesOrdered =
          strictlyLess(p[0].strike, p[1].strike) &&
          strictlyLess(c[0].strike, c[1].strike) &&
          strictlyLess(p[1].strike, c[0].strike);
        const condorShort = strikesOrdered && c[0].side === 'short' && c[1].side === 'long' && p[0].side === 'long' && p[1].side === 'short';
        const condorLong = strikesOrdered && c[0].side === 'long' && c[1].side === 'short' && p[0].side === 'short' && p[1].side === 'long';
        if (condorShort) return 'Short Iron Condor';
        if (condorLong) return 'Long Iron Condor';
      }
      if (allSameType) {
        const sorted = sortedByStrike(optionLegs);
        const wingsLong = sorted[0].side === 'long' && sorted[3].side === 'long' && sorted[1].side === 'short' && sorted[2].side === 'short';
        const wingsShort = sorted[0].side === 'short' && sorted[3].side === 'short' && sorted[1].side === 'long' && sorted[2].side === 'long';
        const typ = optionLegs[0].type === 'C' ? 'Call' : 'Put';
        if (wingsLong) return `Long ${typ} Condor`;
        if (wingsShort) return `Short ${typ} Condor`;
      }
      if (calls.length === 2 && puts.length === 2) {
        const strikes = Array.from(new Set(optionLegs.map((leg) => leg.strike))).sort((a, b) => a - b);
        if (strikes.length === 2) {
          const [k1, k2] = strikes;
          const hasLongCallK1 = calls.some((leg) => same(leg.strike, k1) && leg.side === 'long');
          const hasShortCallK2 = calls.some((leg) => same(leg.strike, k2) && leg.side === 'short');
          const hasLongPutK2 = puts.some((leg) => same(leg.strike, k2) && leg.side === 'long');
          const hasShortPutK1 = puts.some((leg) => same(leg.strike, k1) && leg.side === 'short');
          const longBox = hasLongCallK1 && hasShortCallK2 && hasLongPutK2 && hasShortPutK1;
          const shortBox = calls.some((leg) => same(leg.strike, k1) && leg.side === 'short') &&
            calls.some((leg) => same(leg.strike, k2) && leg.side === 'long') &&
            puts.some((leg) => same(leg.strike, k2) && leg.side === 'short') &&
            puts.some((leg) => same(leg.strike, k1) && leg.side === 'long');
          if (longBox) return 'Long Box Spread';
          if (shortBox) return 'Short Box Spread';
        }
      }
    } else {
      const expSet = Array.from(new Set(optionLegs.map((leg) => leg.expiryMs))).sort();
      if (expSet.length === 2 && calls.length === 2 && puts.length === 2) {
        const cStrikeSame = same(calls[0].strike, calls[1].strike);
        const pStrikeSame = same(puts[0].strike, puts[1].strike);
        const cOppSides = calls[0].side !== calls[1].side;
        const pOppSides = puts[0].side !== puts[1].side;
        if (cStrikeSame && pStrikeSame && cOppSides && pOppSides) return 'Double Calendar (Straddle)';
        if (!cStrikeSame && !pStrikeSame && cOppSides && pOppSides) return 'Double Diagonal';
      }
    }
    return 'Four-leg Combo';
  }

  if (optionCount >= 5) return `Complex (${optionCount} legs)`;
  return 'Options Combo';
}
