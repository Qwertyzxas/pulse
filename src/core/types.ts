export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Ticker {
  symbol: string; // BTCUSDT
  base: string; // BTC
  quote: string; // USDT
  price: number;
  open: number; // 24h open
  high: number;
  low: number;
  volume: number; // base asset, 24h
  quoteVolume: number; // quote asset, 24h
  changePercent: number;
  /** Direction of the last price move: drives the green/red flash */
  tick: 1 | -1 | 0;
  updatedAt: number;
}

export interface Candle {
  time: number; // open time, ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** [price, quantity] */
export type BookLevel = [number, number];

export interface OrderBook {
  symbol: string;
  bids: BookLevel[]; // best (highest) first
  asks: BookLevel[]; // best (lowest) first
}

export interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  /** true when the buyer was the maker — i.e. an aggressive sell */
  sell: boolean;
}

export type FeedMode = 'live' | 'demo';

export interface FeedStatus {
  mode: FeedMode;
  state: 'connecting' | 'open' | 'reconnecting' | 'error';
  /** Human-readable reason for falling back to demo data */
  reason?: string;
  messagesPerSecond: number;
}
