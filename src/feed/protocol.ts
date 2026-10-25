import type { Candle, FeedMode, FeedStatus, Interval, OrderBook, Ticker, Trade } from '../core/types';

export type WorkerCommand =
  | { type: 'start'; mode: FeedMode; symbol: string; interval: Interval; seed?: number }
  | { type: 'select'; symbol: string; interval: Interval }
  | { type: 'retry-live' };

export type WorkerEvent =
  | { type: 'status'; status: Partial<FeedStatus> }
  | { type: 'history'; symbol: string; interval: Interval; candles: Candle[]; refresh?: boolean }
  | {
      type: 'batch';
      tickers: Ticker[];
      candle: { symbol: string; interval: Interval; candle: Candle } | null;
      book: OrderBook | null;
      trades: { symbol: string; trades: Trade[] } | null;
    };
