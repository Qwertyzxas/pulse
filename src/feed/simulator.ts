import { intervalMs } from '../core/candles';
import { makeTicker } from '../core/markets';
import type { Candle, Interval, OrderBook, Ticker, Trade } from '../core/types';
import { seededRandom } from '../core/util';
import type { FeedHandlers, FeedSource } from './source';

export const DEMO_MARKETS: [string, number][] = [
  ['BTC', 79650], ['ETH', 3050], ['SOL', 182], ['BNB', 610], ['XRP', 2.41], ['DOGE', 0.182], ['ADA', 0.71],
  ['TRX', 0.27], ['AVAX', 24.6], ['LINK', 15.8], ['TON', 3.2], ['DOT', 4.3], ['LTC', 88], ['BCH', 420],
  ['NEAR', 2.7], ['UNI', 8.9], ['APT', 5.6], ['ATOM', 4.6], ['ARB', 0.42], ['OP', 0.71], ['SUI', 3.4],
  ['PEPE', 0.0000102], ['SHIB', 0.0000141], ['FIL', 2.6], ['ICP', 5.2], ['ETC', 19.4], ['XLM', 0.36],
  ['HBAR', 0.19], ['INJ', 13.2], ['AAVE', 260], ['RUNE', 1.4], ['SEI', 0.24], ['TIA', 2.1], ['WLD', 1.2],
  ['FET', 0.62], ['RENDER', 3.9], ['GRT', 0.11], ['ALGO', 0.23], ['VET', 0.025], ['ENA', 0.48],
];

interface Market {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  sigma: number;
  liquidity: number;
}

export interface SimulatorDeps {
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const defaultDeps = (): SimulatorDeps => ({
  now: Date.now,
  setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
  clearInterval: (id) => clearInterval(id),
});

export class SimulatedFeed implements FeedSource {
  private readonly random: () => number;
  private readonly deps: SimulatorDeps;
  private readonly markets = new Map<string, Market>();
  private tickers = new Map<string, Ticker>();
  private selected: { symbol: string; interval: Interval } | null = null;
  private candle: Candle | null = null;
  private tradeId = 1;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly handlers: FeedHandlers,
    seed = 42,
    deps: Partial<SimulatorDeps> = {},
  ) {
    this.random = seededRandom(seed);
    this.deps = { ...defaultDeps(), ...deps };
    for (const [rank, [base, price]] of DEMO_MARKETS.entries()) {
      const drift = 1 + (this.random() - 0.5) * 0.12;
      const open = price / drift;
      this.markets.set(`${base}USDT`, {
        symbol: `${base}USDT`,
        price,
        open,
        high: Math.max(price, open) * (1 + this.random() * 0.02),
        low: Math.min(price, open) * (1 - this.random() * 0.02),
        volume: 0,
        sigma: 0.00006 + this.random() * 0.00016,
        liquidity: (2.5e9 / (rank + 1) ** 1.3) * (0.7 + this.random() * 0.6),
      });
    }
  }

  private gaussian() {
    const u = 1 - this.random();
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  start() {
    this.handlers.status({ mode: 'demo', state: 'open' });
    this.emitTickers([...this.markets.values()]);
    const every = (ms: number, fn: () => void) => this.timers.push(this.deps.setInterval(fn, ms));
    every(1000, () => this.tickAll());
    every(250, () => this.emitBook());
    every(180, () => this.emitTrades());
    every(1000, () => this.handlers.status({ messagesPerSecond: Math.round(this.markets.size + 4 + 6) }));
  }

  stop() {
    for (const t of this.timers) this.deps.clearInterval(t);
    this.timers = [];
  }

  select(symbol: string, interval: Interval) {
    const market = this.markets.get(symbol);
    this.selected = { symbol, interval };
    if (!market) {
      this.handlers.candles(symbol, interval, [], true);
      return;
    }
    const history = this.history(market, interval, 500);
    this.candle = history.at(-1)!;
    this.handlers.candles(symbol, interval, history, true);
    this.emitBook();
  }

  private history(market: Market, interval: Interval, count: number): Candle[] {
    const step = intervalMs(interval);
    const lastOpen = Math.floor(this.deps.now() / step) * step;
    const sigma = market.sigma * Math.sqrt(step / 1000);
    const candles: Candle[] = [];
    let close = market.price;
    for (let i = 0; i < count; i++) {
      const open = close * Math.exp(-sigma * this.gaussian());
      const high = Math.max(open, close) * (1 + Math.abs(this.gaussian()) * sigma * 0.6);
      const low = Math.min(open, close) * (1 - Math.abs(this.gaussian()) * sigma * 0.6);
      const volume = ((market.liquidity / market.price) * (step / 86_400_000)) * (0.4 + this.random() * 1.2);
      candles.push({ time: lastOpen - i * step, open, high, low, close, volume });
      close = open;
    }
    return candles.reverse();
  }

  private tickAll() {
    const now = this.deps.now();
    const changed: Market[] = [];
    for (const m of this.markets.values()) {
      if (this.random() < 0.35) continue;
      m.price *= Math.exp(m.sigma * this.gaussian());
      m.high = Math.max(m.high, m.price);
      m.low = Math.min(m.low, m.price);
      m.volume += (m.liquidity / m.price / 86_400) * (0.5 + this.random());
      changed.push(m);
    }
    this.emitTickers(changed);

    const sel = this.selected && this.markets.get(this.selected.symbol);
    if (sel && this.candle) {
      const step = intervalMs(this.selected!.interval);
      const open = Math.floor(now / step) * step;
      const c: Candle =
        open > this.candle.time
          ? { time: open, open: this.candle.close, high: sel.price, low: sel.price, close: sel.price, volume: 0 }
          : { ...this.candle };
      c.close = sel.price;
      c.high = Math.max(c.high, sel.price, c.open);
      c.low = Math.min(c.low, sel.price, c.open);
      c.volume += (sel.liquidity / sel.price / 86_400) * (0.5 + this.random());
      this.candle = c;
      this.handlers.candles(sel.symbol, this.selected!.interval, [c], false);
    }
  }

  private emitTickers(markets: Market[]) {
    const now = this.deps.now();
    const list = markets.map((m) => {
      const ticker = makeTicker(
        m.symbol,
        'USDT',
        { price: m.price, open: m.open, high: m.high, low: m.low, volume: m.volume, quoteVolume: m.liquidity + m.volume * m.price },
        this.tickers.get(m.symbol),
        now,
      );
      this.tickers.set(m.symbol, ticker);
      return ticker;
    });
    if (list.length) this.handlers.tickers(list);
  }

  private emitBook() {
    const m = this.selected && this.markets.get(this.selected.symbol);
    if (!m) return;
    const tick = m.price * 0.00002;
    const level = (i: number, side: 1 | -1): [number, number] => [
      m.price + side * tick * (i + 1 + this.random() * 0.5),
      ((m.liquidity / m.price) * 2e-6) * (0.2 + this.random() ** 2 * 3) * (1 + i * 0.08),
    ];
    const book: OrderBook = {
      symbol: m.symbol,
      asks: Array.from({ length: 20 }, (_, i) => level(i, 1)),
      bids: Array.from({ length: 20 }, (_, i) => level(i, -1)),
    };
    this.handlers.book(book);
  }

  private emitTrades() {
    const m = this.selected && this.markets.get(this.selected.symbol);
    if (!m) return;
    const count = Math.floor(this.random() * 3);
    const now = this.deps.now();
    const trades: Trade[] = Array.from({ length: count }, () => ({
      id: this.tradeId++,
      price: m.price * (1 + (this.random() - 0.5) * 0.0002),
      qty: ((m.liquidity / m.price) * 1e-7) * (0.1 + this.random() ** 3 * 20),
      time: now,
      sell: this.random() < 0.5,
    }));
    if (trades.length) this.handlers.trades(m.symbol, trades);
  }
}
