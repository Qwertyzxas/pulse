import type { Candle, Interval, OrderBook, Ticker, Trade } from '../core/types';
import type { WorkerEvent } from './protocol';

export const MAX_TRADES_PER_BATCH = 50;

export class Batcher {
  private tickers = new Map<string, Ticker>();
  private candle: { symbol: string; interval: Interval; candle: Candle } | null = null;
  private book: OrderBook | null = null;
  private trades: { symbol: string; trades: Trade[] } | null = null;

  constructor(private readonly post: (event: WorkerEvent) => void) {}

  pushTickers(list: Ticker[]) {
    for (const t of list) this.tickers.set(t.symbol, t);
  }

  pushCandle(symbol: string, interval: Interval, candle: Candle) {
    this.candle = { symbol, interval, candle };
  }

  pushBook(book: OrderBook) {
    this.book = book;
  }

  pushTrades(symbol: string, trades: Trade[]) {
    if (!this.trades || this.trades.symbol !== symbol) this.trades = { symbol, trades: [] };
    this.trades.trades.push(...trades);
    if (this.trades.trades.length > MAX_TRADES_PER_BATCH) this.trades.trades = this.trades.trades.slice(-MAX_TRADES_PER_BATCH);
  }

  clearSelection() {
    this.candle = null;
    this.book = null;
    this.trades = null;
  }

  flush() {
    if (!this.tickers.size && !this.candle && !this.book && !this.trades) return;
    this.post({ type: 'batch', tickers: [...this.tickers.values()], candle: this.candle, book: this.book, trades: this.trades });
    this.tickers.clear();
    this.clearSelection();
  }
}
