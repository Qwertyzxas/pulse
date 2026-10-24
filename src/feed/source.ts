import type { Candle, FeedStatus, Interval, OrderBook, Ticker, Trade } from '../core/types';

/** Callbacks every market data source reports through. */
export interface FeedHandlers {
  status(status: Partial<FeedStatus>): void;
  /** Tickers that changed since the previous call */
  tickers(tickers: Ticker[]): void;
  /** `replace` — full history for a newly selected symbol/interval; otherwise a live update of one candle */
  candles(symbol: string, interval: Interval, candles: Candle[], replace: boolean): void;
  book(book: OrderBook): void;
  trades(symbol: string, trades: Trade[]): void;
  /** The source can't work at all — the caller falls back to demo data */
  fail(reason: string): void;
}

export interface FeedSource {
  start(): void;
  select(symbol: string, interval: Interval): void;
  stop(): void;
}
