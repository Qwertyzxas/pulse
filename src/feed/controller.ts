import type { FeedMode, Interval } from '../core/types';
import { Batcher } from './batcher';
import { BinanceFeed } from './binance';
import type { WorkerCommand, WorkerEvent } from './protocol';
import { SimulatedFeed } from './simulator';
import type { FeedHandlers, FeedSource } from './source';

export const FLUSH_INTERVAL = 200;
export const FIRST_DATA_TIMEOUT = 10_000;

export interface ControllerDeps {
  createSource(mode: FeedMode, handlers: FeedHandlers, seed: number): FeedSource;
  setInterval: typeof setInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

const defaultDeps = (): ControllerDeps => ({
  createSource: (mode, handlers, seed) => (mode === 'live' ? new BinanceFeed(handlers) : new SimulatedFeed(handlers, seed)),
  setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
  setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  clearTimeout: (id) => clearTimeout(id),
});

export class FeedController {
  private readonly deps: ControllerDeps;
  private readonly batcher: Batcher;
  private source: FeedSource | null = null;
  private generation = 0;
  private selection: { symbol: string; interval: Interval } | null = null;
  private seed = 42;
  private firstDataTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly post: (event: WorkerEvent) => void,
    deps: Partial<ControllerDeps> = {},
  ) {
    this.deps = { ...defaultDeps(), ...deps };
    this.batcher = new Batcher(post);
    this.deps.setInterval(() => this.batcher.flush(), FLUSH_INTERVAL);
  }

  handle(command: WorkerCommand) {
    switch (command.type) {
      case 'start':
        this.seed = command.seed ?? 42;
        this.selection = { symbol: command.symbol, interval: command.interval };
        this.run(command.mode);
        break;
      case 'select':
        this.selection = { symbol: command.symbol, interval: command.interval };
        this.batcher.clearSelection();
        this.source?.select(command.symbol, command.interval);
        break;
      case 'retry-live':
        this.run('live');
        break;
    }
  }

  private run(mode: FeedMode, reason?: string) {
    this.source?.stop();
    this.deps.clearTimeout(this.firstDataTimer);
    this.batcher.clearSelection();
    const generation = ++this.generation;
    const live = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
      if (generation === this.generation) fn(...args);
    };
    let gotTickers = false;

    const handlers: FeedHandlers = {
      status: live((status) => this.post({ type: 'status', status })),
      tickers: live((list) => {
        gotTickers = true;
        this.batcher.pushTickers(list);
      }),
      candles: live((symbol, interval, candles, replace, refresh) => {
        if (replace) this.post({ type: 'history', symbol, interval, candles, ...(refresh && { refresh }) });
        else if (candles[0]) this.batcher.pushCandle(symbol, interval, candles[0]);
      }),
      book: live((book) => this.batcher.pushBook(book)),
      trades: live((symbol, trades) => this.batcher.pushTrades(symbol, trades)),
      fail: live((why) => this.run('demo', why)),
    };

    this.post({ type: 'status', status: { mode, state: 'connecting', reason, messagesPerSecond: 0 } });
    this.source = this.deps.createSource(mode, handlers, this.seed);
    this.source.start();
    if (this.selection) this.source.select(this.selection.symbol, this.selection.interval);

    if (mode === 'live') {
      this.firstDataTimer = this.deps.setTimeout(() => {
        if (!gotTickers && generation === this.generation) this.run('demo', 'Биржа не отвечает');
      }, FIRST_DATA_TIMEOUT);
    }
  }
}
