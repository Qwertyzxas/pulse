import { makeTicker } from '../core/markets';
import type { Candle, Interval, OrderBook, Ticker, Trade } from '../core/types';
import { backoffDelay } from '../core/util';
import type { FeedHandlers, FeedSource } from './source';

// Binance's public market-data-only endpoints: no API key, read-only
export const REST_URL = 'https://data-api.binance.vision/api/v3';
export const WS_URL = 'wss://data-stream.binance.vision/stream';
export const QUOTE = 'USDT';

const LEVERAGED = /(UP|DOWN|BULL|BEAR)USDT$/;
const STABLES = new Set(['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'USDPUSDT', 'DAIUSDT', 'EURUSDT', 'AEURUSDT', 'EURIUSDT', 'USD1USDT', 'BUSDUSDT', 'XUSDUSDT', 'USDEUSDT']);

/** USDT spot pairs worth showing: no leveraged tokens and no stablecoin-to-stablecoin pairs. */
export const isListed = (symbol: string) => symbol.endsWith(QUOTE) && !LEVERAGED.test(symbol) && !STABLES.has(symbol);

const num = (v: unknown) => Number(v);

// ── parsers (pure) ───────────────────────────────────────────
export interface TickerFields {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}

/** GET /ticker/24hr item. Pairs without trades in 24h (delisted) are skipped. */
export function parseRestTicker(raw: Record<string, unknown>): TickerFields | null {
  const symbol = String(raw.symbol);
  if (!isListed(symbol) || !(num(raw.count) > 0)) return null;
  return {
    symbol,
    price: num(raw.lastPrice),
    open: num(raw.openPrice),
    high: num(raw.highPrice),
    low: num(raw.lowPrice),
    volume: num(raw.volume),
    quoteVolume: num(raw.quoteVolume),
  };
}

/** One element of the `!miniTicker@arr` stream. */
export function parseMiniTicker(raw: Record<string, unknown>): TickerFields | null {
  const symbol = String(raw.s);
  if (!isListed(symbol)) return null;
  return {
    symbol,
    price: num(raw.c),
    open: num(raw.o),
    high: num(raw.h),
    low: num(raw.l),
    volume: num(raw.v),
    quoteVolume: num(raw.q),
  };
}

/** GET /klines row: [openTime, open, high, low, close, volume, …] */
export const parseRestKline = (row: unknown[]): Candle => ({
  time: num(row[0]),
  open: num(row[1]),
  high: num(row[2]),
  low: num(row[3]),
  close: num(row[4]),
  volume: num(row[5]),
});

export function parseKlineEvent(data: { s: string; k: Record<string, unknown> }) {
  const k = data.k;
  return {
    symbol: data.s,
    interval: k.i as Interval,
    candle: { time: num(k.t), open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), volume: num(k.v) },
  };
}

export function parseDepth(symbol: string, data: { bids: string[][]; asks: string[][] }): OrderBook {
  const levels = (rows: string[][]) => rows.map(([p, q]) => [num(p), num(q)] as [number, number]).filter(([, q]) => q > 0);
  return { symbol, bids: levels(data.bids), asks: levels(data.asks) };
}

export const parseAggTrade = (data: Record<string, unknown>): Trade => ({
  id: num(data.a),
  price: num(data.p),
  qty: num(data.q),
  time: num(data.T),
  sell: data.m === true,
});

export const symbolStreams = (symbol: string, interval: Interval) => {
  const s = symbol.toLowerCase();
  return [`${s}@kline_${interval}`, `${s}@depth20@100ms`, `${s}@aggTrade`];
};

// ── live source ──────────────────────────────────────────────
export interface BinanceDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  random: () => number;
}

const defaultDeps = (): BinanceDeps => ({
  fetch: (...args) => fetch(...args),
  WebSocket,
  now: Date.now,
  setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
  clearInterval: (id) => clearInterval(id),
  random: Math.random,
});

/** No message for this long means the socket is silently dead. */
export const STALE_AFTER = 15_000;
/** A socket stuck in CONNECTING (e.g. filtered by a firewall) is abandoned after this. */
export const CONNECT_TIMEOUT = 8_000;
/** Without any data after this many attempts we give up and let the app fall back. */
export const MAX_FAILED_ATTEMPTS = 4;

export class BinanceFeed implements FeedSource {
  private readonly deps: BinanceDeps;
  private ws: WebSocket | null = null;
  private tickers = new Map<string, Ticker>();
  private selected: { symbol: string; interval: Interval } | null = null;
  private subscribed: string[] = [];
  private requestId = 0;
  private historyToken = 0;
  private attempts = 0;
  private everReceived = false;
  private lastMessageAt = 0;
  private connectStartedAt = 0;
  private messages = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly handlers: FeedHandlers,
    deps: Partial<BinanceDeps> = {},
  ) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  start() {
    this.stopped = false;
    this.handlers.status({ mode: 'live', state: 'connecting' });
    void this.loadTickers();
    this.connect();
    // watchdog + message-rate meter share one 1s timer
    this.watchdog = this.deps.setInterval(() => {
      this.handlers.status({ messagesPerSecond: this.messages });
      this.messages = 0;
      const ws = this.ws;
      if (!ws) return;
      const now = this.deps.now();
      if (ws.readyState === 1 && now - this.lastMessageAt > STALE_AFTER) ws.close();
      if (ws.readyState === 0 && now - this.connectStartedAt > CONNECT_TIMEOUT) ws.close();
    }, 1000);
  }

  stop() {
    this.stopped = true;
    this.deps.clearTimeout(this.reconnectTimer);
    this.deps.clearInterval(this.watchdog);
    this.ws?.close();
    this.ws = null;
  }

  select(symbol: string, interval: Interval) {
    this.selected = { symbol, interval };
    void this.loadHistory(symbol, interval);
    this.syncSubscriptions();
  }

  private async loadTickers() {
    try {
      const response = await this.deps.fetch(`${REST_URL}/ticker/24hr`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = (await response.json()) as Record<string, unknown>[];
      this.applyTickers(rows.map(parseRestTicker));
    } catch {
      // the WebSocket fills tickers in anyway; only total failure triggers a fallback
    }
  }

  private async loadHistory(symbol: string, interval: Interval) {
    const token = ++this.historyToken;
    try {
      const response = await this.deps.fetch(`${REST_URL}/klines?symbol=${symbol}&interval=${interval}&limit=500`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = (await response.json()) as unknown[][];
      // a newer selection may have happened while the request was in flight
      if (token !== this.historyToken) return;
      this.handlers.candles(symbol, interval, rows.map(parseRestKline), true);
    } catch {
      if (token === this.historyToken) this.handlers.candles(symbol, interval, [], true);
    }
  }

  private connect() {
    const ws = new this.deps.WebSocket(`${WS_URL}?streams=!miniTicker@arr`);
    this.ws = ws;
    this.subscribed = [];
    this.connectStartedAt = this.deps.now();

    ws.onopen = () => {
      this.lastMessageAt = this.deps.now();
      this.handlers.status({ state: 'open' });
      this.syncSubscriptions();
    };
    ws.onmessage = (event) => {
      this.lastMessageAt = this.deps.now();
      this.messages++;
      this.everReceived = true;
      this.attempts = 0;
      this.route(JSON.parse(String(event.data)));
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.attempts++;
      if (!this.everReceived && this.attempts >= MAX_FAILED_ATTEMPTS) {
        this.stop();
        this.handlers.fail('Не удалось подключиться к Binance');
        return;
      }
      this.handlers.status({ state: 'reconnecting' });
      this.reconnectTimer = this.deps.setTimeout(() => this.connect(), backoffDelay(this.attempts - 1, this.deps.random));
    };
  }

  /** Swaps per-symbol streams on the open socket instead of reconnecting. */
  private syncSubscriptions() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const wanted = this.selected ? symbolStreams(this.selected.symbol, this.selected.interval) : [];
    const remove = this.subscribed.filter((s) => !wanted.includes(s));
    const add = wanted.filter((s) => !this.subscribed.includes(s));
    if (remove.length) ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: remove, id: ++this.requestId }));
    if (add.length) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: add, id: ++this.requestId }));
    this.subscribed = wanted;
  }

  private applyTickers(fields: (TickerFields | null)[]) {
    const now = this.deps.now();
    const changed: Ticker[] = [];
    for (const f of fields) {
      if (!f) continue;
      const ticker = makeTicker(f.symbol, QUOTE, f, this.tickers.get(f.symbol), now);
      this.tickers.set(f.symbol, ticker);
      changed.push(ticker);
    }
    if (changed.length) this.handlers.tickers(changed);
  }

  private route(message: { stream?: string; data?: unknown }) {
    const { stream, data } = message;
    if (!stream || !data) return; // subscription acks
    if (stream === '!miniTicker@arr') {
      this.applyTickers((data as Record<string, unknown>[]).map(parseMiniTicker));
      return;
    }
    const symbol = stream.split('@')[0]!.toUpperCase();
    if (symbol !== this.selected?.symbol) return; // late message for a previous selection
    if (stream.includes('@kline_')) {
      const { interval, candle } = parseKlineEvent(data as never);
      if (interval === this.selected.interval) this.handlers.candles(symbol, interval, [candle], false);
    } else if (stream.includes('@depth')) {
      this.handlers.book(parseDepth(symbol, data as never));
    } else if (stream.endsWith('@aggTrade')) {
      this.handlers.trades(symbol, [parseAggTrade(data as Record<string, unknown>)]);
    }
  }
}
