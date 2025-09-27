import type { Leg, OptionType } from '../../utils/types';

export type DraftLeg = {
  leg: Leg;
  side: 'short' | 'long';
  qty: number;
};

export type ChainRow = {
  symbol: string;
  strike: number;
  expiryMs: number;
  optionType: OptionType;
  bid?: number;
  ask?: number;
  mid?: number;
  delta?: number;
  openInterest?: number;
  spread?: number;
  mark?: number;
};

export type FiltersState = {
  optType: OptionType;
  expiry: number | '';
  deltaMin: number;
  deltaMax: number;
  minOI: number;
  maxSpread: number;
  showAllStrikes: boolean;
};
