import type { Candle, FeedMode, FeedStatus, Interval, OrderBook, Ticker, Trade } from '../core/types';

/** Main thread → worker */
export type WorkerCommand =
  | { type: 'start'; mode: FeedMode; symbol: string; interval: Interval; seed?: number }
  | { type: 'select'; symbol: string; interval: Interval }
  | { type: 'retry-live' };

/** Worker → main thread. High-frequency updates are coalesced into batches. */
export type WorkerEvent =
  | { type: 'status'; status: Partial<FeedStatus> }
  | { type: 'history'; symbol: string; interval: Interval; candles: Candle[] }
  | {
      type: 'batch';
      tickers: Ticker[];
      candle: { symbol: string; interval: Interval; candle: Candle } | null;
      book: OrderBook | null;
      trades: { symbol: string; trades: Trade[] } | null;
    };
