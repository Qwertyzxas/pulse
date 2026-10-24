import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, OrderBook, Ticker, Trade } from '../core/types';
import { Batcher } from './batcher';
import {
  BinanceFeed,
  isListed,
  MAX_FAILED_ATTEMPTS,
  parseAggTrade,
  parseDepth,
  parseKlineEvent,
  parseMiniTicker,
  parseRestKline,
  parseRestTicker,
  STALE_AFTER,
} from './binance';
import { FeedController, FIRST_DATA_TIMEOUT } from './controller';
import type { WorkerEvent } from './protocol';
import { SimulatedFeed } from './simulator';
import type { FeedHandlers, FeedSource } from './source';

// Real payloads captured from data-api.binance.vision / data-stream.binance.vision
const REST_TICKER = {"symbol":"BTCUSDT","priceChange":"-1960.26000000","priceChangePercent":"-2.400","weightedAvgPrice":"80589.31979209","prevClosePrice":"81668.01000000","lastPrice":"79707.74000000","lastQty":"0.00539000","bidPrice":"79707.74000000","bidQty":"4.75326000","askPrice":"79707.75000000","askQty":"1.76826000","openPrice":"81668.00000000","highPrice":"81846.26000000","lowPrice":"79220.74000000","volume":"12615.93228000","quoteVolume":"1016709400.98831450","openTime":1792773564012,"closeTime":1792859964012,"firstId":6787290713,"lastId":6788926070,"count":1635358};
const REST_KLINE = [1792857600000,"79803.74000000","79911.11000000","79580.00000000","79707.74000000","388.51586000",1792861199999,"30983804.35850270",95464,"177.84555000","14183107.83309160","0"];
const WS_MINI = {"e":"24hrMiniTicker","E":1792859985015,"s":"BTCUSDT","c":"79707.75000000","o":"81668.00000000","h":"81846.26000000","l":"79220.74000000","v":"12616.1","q":"1016725000.1"};
const WS_KLINE = {"e":"kline","E":1792859986016,"s":"BTCUSDT","k":{"t":1792859940000,"T":1792859999999,"s":"BTCUSDT","i":"1m","f":6788925882,"L":6788926305,"o":"79692.80000000","c":"79707.75000000","h":"79707.75000000","l":"79692.79000000","v":"2.81168000","n":424,"x":false,"q":"224097.46727260","V":"0.79777000","Q":"63582.87274080","B":"0"}};
const WS_DEPTH = {"lastUpdateId":101863046399,"bids":[["79707.74000000","3.47705000"],["79707.73000000","0.00049000"]],"asks":[["79707.75000000","1.28358000"],["79707.76000000","0.00000000"]]};
const WS_TRADE = {"e":"aggTrade","E":1792859986234,"s":"BTCUSDT","a":4097095982,"p":"79707.75000000","q":"0.02454000","f":6788926306,"l":6788926327,"T":1792859986234,"m":false,"M":true};

describe('Binance parsers', () => {
  it('lists only real USDT spot pairs', () => {
    expect(isListed('BTCUSDT')).toBe(true);
    expect(isListed('LTCBTC')).toBe(false);
    expect(isListed('BTCUPUSDT')).toBe(false);
    expect(isListed('USDCUSDT')).toBe(false);
  });

  it('parses REST and stream tickers into the same shape', () => {
    expect(parseRestTicker(REST_TICKER)).toEqual({
      symbol: 'BTCUSDT', price: 79707.74, open: 81668, high: 81846.26, low: 79220.74, volume: 12615.93228, quoteVolume: 1016709400.9883145,
    });
    expect(parseRestTicker({ ...REST_TICKER, count: 0 })).toBeNull(); // delisted
    expect(parseMiniTicker(WS_MINI)).toMatchObject({ symbol: 'BTCUSDT', price: 79707.75, open: 81668 });
  });

  it('parses candles, depth and trades', () => {
    expect(parseRestKline(REST_KLINE)).toEqual({ time: 1792857600000, open: 79803.74, high: 79911.11, low: 79580, close: 79707.74, volume: 388.51586 });
    expect(parseKlineEvent(WS_KLINE)).toMatchObject({ symbol: 'BTCUSDT', interval: '1m', candle: { time: 1792859940000, close: 79707.75 } });
    const book = parseDepth('BTCUSDT', WS_DEPTH);
    expect(book.bids).toHaveLength(2);
    expect(book.asks).toEqual([[79707.75, 1.28358]]); // zero-quantity level dropped
    expect(parseAggTrade(WS_TRADE)).toEqual({ id: 4097095982, price: 79707.75, qty: 0.02454, time: 1792859986234, sell: false });
  });
});

// ── fakes ────────────────────────────────────────────────────
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(stream: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ stream, data }) });
  }
}

function recorder() {
  const calls = {
    status: [] as unknown[],
    tickers: [] as Ticker[][],
    candles: [] as { symbol: string; candles: Candle[]; replace: boolean }[],
    book: [] as OrderBook[],
    trades: [] as Trade[][],
    fail: [] as string[],
  };
  const handlers: FeedHandlers = {
    status: (s) => calls.status.push(s),
    tickers: (t) => calls.tickers.push(t),
    candles: (symbol, _i, candles, replace) => calls.candles.push({ symbol, candles, replace }),
    book: (b) => calls.book.push(b),
    trades: (_s, t) => calls.trades.push(t),
    fail: (r) => calls.fail.push(r),
  };
  return { calls, handlers };
}

const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe('BinanceFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  function setup(fetchImpl: (url: string) => Promise<Response> = (url) => json(url.includes('klines') ? [REST_KLINE] : [REST_TICKER])) {
    const { calls, handlers } = recorder();
    const feed = new BinanceFeed(handlers, {
      fetch: vi.fn(fetchImpl) as unknown as typeof fetch,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      now: () => Date.now(),
      random: () => 1,
    });
    return { feed, calls, socket: () => FakeSocket.instances.at(-1)! };
  }

  it('loads tickers and history over REST', async () => {
    const { feed, calls } = setup();
    feed.start();
    feed.select('BTCUSDT', '1h');
    await vi.runAllTicks();
    await Promise.resolve();
    expect(calls.tickers[0]![0]).toMatchObject({ symbol: 'BTCUSDT', price: 79707.74 });
    expect(calls.candles[0]).toMatchObject({ symbol: 'BTCUSDT', replace: true });
    expect(calls.candles[0]!.candles).toHaveLength(1);
    feed.stop();
  });

  it('subscribes to the selected symbol and swaps streams without reconnecting', () => {
    const { feed, socket } = setup();
    feed.start();
    feed.select('BTCUSDT', '1m');
    socket().open();
    expect(socket().sent).toEqual([
      { method: 'SUBSCRIBE', params: ['btcusdt@kline_1m', 'btcusdt@depth20@100ms', 'btcusdt@aggTrade'], id: 1 },
    ]);
    feed.select('ETHUSDT', '1m');
    expect(socket().sent.slice(1)).toEqual([
      { method: 'UNSUBSCRIBE', params: ['btcusdt@kline_1m', 'btcusdt@depth20@100ms', 'btcusdt@aggTrade'], id: 2 },
      { method: 'SUBSCRIBE', params: ['ethusdt@kline_1m', 'ethusdt@depth20@100ms', 'ethusdt@aggTrade'], id: 3 },
    ]);
    expect(FakeSocket.instances).toHaveLength(1);
    feed.stop();
  });

  it('routes stream messages and drops ones for a previous symbol', () => {
    const { feed, calls, socket } = setup();
    feed.start();
    feed.select('BTCUSDT', '1m');
    socket().open();
    socket().receive('!miniTicker@arr', [WS_MINI, { ...WS_MINI, s: 'LTCBTC' }]);
    socket().receive('btcusdt@kline_1m', WS_KLINE);
    socket().receive('btcusdt@depth20@100ms', WS_DEPTH);
    socket().receive('btcusdt@aggTrade', WS_TRADE);
    socket().receive('ethusdt@aggTrade', { ...WS_TRADE, s: 'ETHUSDT' });

    expect(calls.tickers.at(-1)!.map((t) => t.symbol)).toEqual(['BTCUSDT']);
    expect(calls.candles.find((c) => !c.replace)?.candles[0]!.close).toBe(79707.75);
    expect(calls.book).toHaveLength(1);
    expect(calls.trades).toHaveLength(1);
    feed.stop();
  });

  it('reconnects with backoff and resubscribes', () => {
    const { feed, socket } = setup();
    feed.start();
    feed.select('BTCUSDT', '1m');
    socket().open();
    socket().receive('!miniTicker@arr', [WS_MINI]);
    socket().close();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000); // backoffDelay(0) with random = 1
    expect(FakeSocket.instances).toHaveLength(2);
    socket().open();
    expect(socket().sent).toHaveLength(1);
    feed.stop();
  });

  it('closes a silent socket so it can reconnect', () => {
    const { feed, socket } = setup();
    feed.start();
    socket().open();
    vi.advanceTimersByTime(STALE_AFTER + 1500);
    expect(socket().readyState).toBe(3);
    feed.stop();
  });

  it('gives up after repeated failures without any data', () => {
    const { feed, calls, socket } = setup(() => Promise.reject(new Error('blocked')));
    feed.start();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      socket().close();
      vi.advanceTimersByTime(60_000);
    }
    expect(calls.fail).toEqual(['Не удалось подключиться к Binance']);
  });
});

describe('SimulatedFeed', () => {
  function run(seed: number) {
    const { calls, handlers } = recorder();
    const timers: (() => void)[] = [];
    const sim = new SimulatedFeed(handlers, seed, {
      now: () => 1_792_860_000_000,
      setInterval: ((fn: () => void) => timers.push(fn)) as unknown as typeof setInterval,
      clearInterval: () => {},
    });
    sim.start();
    sim.select('BTCUSDT', '1h');
    for (const tick of timers) tick();
    return calls;
  }

  it('is deterministic for a given seed', () => {
    expect(run(7).tickers).toEqual(run(7).tickers);
    // a different seed gives a different market
    expect(run(7).tickers[0]![0]!.changePercent).not.toBe(run(8).tickers[0]![0]!.changePercent);
  });

  it('produces a consistent market for the selected symbol', () => {
    const calls = run(1);
    const history = calls.candles.find((c) => c.replace)!.candles;
    expect(history).toHaveLength(500);
    expect(history.every((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))).toBe(true);
    // candles are contiguous and end at the current hour
    expect(history[1]!.time - history[0]!.time).toBe(3_600_000);
    const book = calls.book.at(-1)!;
    expect(book.asks[0]![0]).toBeGreaterThan(book.bids[0]![0]);
  });
});

describe('Batcher', () => {
  it('coalesces updates into one message per flush', () => {
    const events: WorkerEvent[] = [];
    const b = new Batcher((e) => events.push(e));
    const t = (symbol: string, price: number) => ({ symbol, price }) as Ticker;
    b.pushTickers([t('A', 1), t('B', 1)]);
    b.pushTickers([t('A', 2)]);
    b.pushTrades('A', Array.from({ length: 80 }, (_, i) => ({ id: i }) as Trade));
    b.flush();
    b.flush(); // nothing pending → no message

    expect(events).toHaveLength(1);
    const batch = events[0] as Extract<WorkerEvent, { type: 'batch' }>;
    expect(batch.tickers.map((x) => [x.symbol, x.price])).toEqual([['A', 2], ['B', 1]]);
    expect(batch.trades!.trades).toHaveLength(50);
    expect(batch.trades!.trades[0]!.id).toBe(30); // newest kept
  });
});

describe('FeedController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(liveWorks: boolean) {
    const events: WorkerEvent[] = [];
    const created: { mode: string; handlers: FeedHandlers }[] = [];
    const controller = new FeedController((e) => events.push(e), {
      createSource: (mode, handlers) => {
        created.push({ mode, handlers });
        const source: FeedSource = {
          start: () => {
            if (mode === 'demo' || liveWorks) handlers.tickers([{ symbol: 'BTCUSDT' } as Ticker]);
          },
          select: () => {},
          stop: () => {},
        };
        return source;
      },
    });
    return { controller, events, created };
  }

  it('falls back to demo data when the exchange stays silent', () => {
    const { controller, events, created } = setup(false);
    controller.handle({ type: 'start', mode: 'live', symbol: 'BTCUSDT', interval: '1h' });
    vi.advanceTimersByTime(FIRST_DATA_TIMEOUT);
    expect(created.map((c) => c.mode)).toEqual(['live', 'demo']);
    expect(events).toContainEqual({ type: 'status', status: expect.objectContaining({ mode: 'demo', reason: 'Биржа не отвечает' }) });
  });

  it('stays live when data arrives and ignores callbacks from replaced sources', () => {
    const { controller, events, created } = setup(true);
    controller.handle({ type: 'start', mode: 'live', symbol: 'BTCUSDT', interval: '1h' });
    vi.advanceTimersByTime(FIRST_DATA_TIMEOUT);
    expect(created.map((c) => c.mode)).toEqual(['live']);

    controller.handle({ type: 'retry-live' });
    const stale = created[0]!.handlers;
    events.length = 0;
    stale.status({ state: 'error' });
    expect(events).toEqual([]);
  });
});
