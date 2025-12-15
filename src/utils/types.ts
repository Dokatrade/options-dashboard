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

export interface SpotKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type LegSettlement = {
  settleUnderlying: number;
  settledAt: number;
};

export type SettlementMap = Record<string, LegSettlement>;

export interface Leg {
  symbol: string;
  strike: number;
  optionType: OptionType;
  expiryMs: number;
}

export type CloseSnapshot = {
  timestamp: number;
  indexPrice?: number;
  spotPrice?: number;
  pnlExec?: number;
};

export interface SpreadPosition {
  id: string;
  portfolioId?: string;
  short: Leg;
  long: Leg;
  cEnter: number; // entry credit
  entryShort?: number; // per-contract price received for short leg at entry
  entryLong?: number;  // per-contract price paid for long leg at entry
  qty: number; // contracts count
  note?: string;
  createdAt: number;
  closedAt?: number;
  closeSnapshot?: CloseSnapshot;
  favorite?: boolean;
  settlements?: SettlementMap;
}

export interface PortfolioSettings {
  depositUsd: number;
  riskLimitPct?: number;
}

export type PositionSide = 'short' | 'long';

export interface PositionLeg {
  leg: Leg;
  side: PositionSide;
  qty: number; // contracts
  entryPrice: number; // price per contract at save time
  createdAt?: number; // ms epoch when the leg was added to the position
  hidden?: boolean; // when true, excluded from all calcs/visuals until unhidden
  settleS?: number; // underlying price used to settle this leg
  settledAt?: number; // ms epoch when settlement was captured
  exitPrice?: number; // execution price when leg was manually exited
  exitedAt?: number; // ms epoch when exit was captured
}

export interface Position {
  id: string;
  portfolioId?: string;
  createdAt: number;
  closedAt?: number;
  closeSnapshot?: CloseSnapshot;
  note?: string;
  legs: PositionLeg[];
  favorite?: boolean;
  settlements?: SettlementMap;
}
