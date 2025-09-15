export type OptionType = 'P' | 'C';

export interface InstrumentInfo {
  symbol: string;
  strike: number;
  optionType: OptionType;
  deliveryTime: number; // ms epoch
  status?: string;
  settleCoin?: string;
}

export interface Ticker {
  symbol: string;
  bid1Price?: number;
  ask1Price?: number;
  obBid?: number; // L1 orderbook best bid
  obAsk?: number; // L1 orderbook best ask
  markPrice?: number;
  lastPrice?: number;
  price24hPcnt?: number; // proportion (e.g., 0.0123 => 1.23%)
  markIv?: number; // as percent, e.g., 65
  indexPrice?: number; // underlying
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  openInterest?: number;
}

export interface Leg {
  symbol: string;
  strike: number;
  optionType: OptionType;
  expiryMs: number;
}

export interface SpreadPosition {
  id: string;
  short: Leg;
  long: Leg;
  cEnter: number; // entry credit
  entryShort?: number; // per-contract price received for short leg at entry
  entryLong?: number;  // per-contract price paid for long leg at entry
  qty: number; // contracts count
  note?: string;
  createdAt: number;
  closedAt?: number;
  favorite?: boolean;
}

export interface PortfolioSettings {
  depositUsd: number;
}

export type PositionSide = 'short' | 'long';

export interface PositionLeg {
  leg: Leg;
  side: PositionSide;
  qty: number; // contracts
  entryPrice: number; // price per contract at save time
  hidden?: boolean; // when true, excluded from all calcs/visuals until unhidden
}

export interface Position {
  id: string;
  createdAt: number;
  closedAt?: number;
  note?: string;
  legs: PositionLeg[];
  favorite?: boolean;
}
