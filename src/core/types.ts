export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Ticker {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  changePercent: number;
  tick: 1 | -1 | 0;
  updatedAt: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type BookLevel = [number, number];

export interface OrderBook {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  sell: boolean;
}

export type FeedMode = 'live' | 'demo';

export interface FeedStatus {
  mode: FeedMode;
  state: 'connecting' | 'open' | 'reconnecting' | 'error';
  reason?: string;
  messagesPerSecond: number;
}
