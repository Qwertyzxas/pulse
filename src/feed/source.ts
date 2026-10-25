import type { Candle, FeedStatus, Interval, OrderBook, Ticker, Trade } from '../core/types';

export interface FeedHandlers {
  status(status: Partial<FeedStatus>): void;
  tickers(tickers: Ticker[]): void;
  candles(symbol: string, interval: Interval, candles: Candle[], replace: boolean, refresh?: boolean): void;
  book(book: OrderBook): void;
  trades(symbol: string, trades: Trade[]): void;
  fail(reason: string): void;
}

export interface FeedSource {
  start(): void;
  select(symbol: string, interval: Interval): void;
  stop(): void;
}
