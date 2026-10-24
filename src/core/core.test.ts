import { describe, expect, it } from 'vitest';
import { depthView } from './book';
import { mergeCandle, MAX_CANDLES } from './candles';
import { formatCompact, formatPercent, formatPrice, priceDecimals } from './format';
import { ema, sma } from './indicators';
import { makeTicker, marketStats, queryMarkets, type MarketQuery } from './markets';
import type { Candle, Ticker } from './types';
import { backoffDelay, seededRandom, virtualRange } from './util';

// Intl uses narrow no-break spaces as group separators in ru-RU
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('format', () => {
  it('keeps ~5–6 significant digits for any price magnitude', () => {
    expect(priceDecimals(79656.34)).toBe(2);
    expect(priceDecimals(3.1416)).toBe(4);
    expect(priceDecimals(0.182)).toBe(5);
    expect(priceDecimals(0.0000102)).toBe(9);
    expect(plain(formatPrice(79656.344))).toBe('79 656,34');
    expect(plain(formatPrice(0.0000102))).toBe('0,000010200');
  });

  it('formats signed percents and compact volumes', () => {
    expect(formatPercent(2.345)).toBe('+2,35%');
    expect(formatPercent(-0.5)).toBe('−0,50%');
    expect(formatPercent(0)).toBe('0,00%');
    expect(plain(formatCompact(1_016_709_400))).toBe('1,02 млрд');
  });
});

const candle = (time: number, close: number, extra: Partial<Candle> = {}): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  ...extra,
});

describe('mergeCandle', () => {
  const series = [candle(1, 10), candle(2, 11)];

  it('updates the forming candle in place', () => {
    const next = mergeCandle(series, candle(2, 12));
    expect(next).toHaveLength(2);
    expect(next[1]!.close).toBe(12);
    expect(series[1]!.close).toBe(11); // immutable
  });

  it('appends a new candle and ignores stale or identical updates', () => {
    expect(mergeCandle(series, candle(3, 9))).toHaveLength(3);
    expect(mergeCandle(series, candle(1, 99))).toBe(series);
    expect(mergeCandle(series, candle(2, 11))).toBe(series);
  });

  it('caps the history length', () => {
    const long = Array.from({ length: MAX_CANDLES }, (_, i) => candle(i, i));
    const next = mergeCandle(long, candle(MAX_CANDLES, 1));
    expect(next).toHaveLength(MAX_CANDLES);
    expect(next[0]!.time).toBe(1);
  });
});

describe('indicators', () => {
  it('computes SMA with NaN warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it('computes EMA seeded with the SMA', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([NaN, NaN]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
    expect(ema([1, 2], 3).every(Number.isNaN)).toBe(true);
  });
});

const fields = (price: number, open = price, quoteVolume = 5e6) => ({ price, open, high: price, low: price, volume: 1, quoteVolume });

describe('markets', () => {
  const tickers: Ticker[] = [
    makeTicker('BTCUSDT', 'USDT', fields(80000, 78000, 1e9), undefined, 0),
    makeTicker('ETHUSDT', 'USDT', fields(3000, 3100, 5e8), undefined, 0),
    makeTicker('DOGEUSDT', 'USDT', fields(0.2, 0.18, 2e8), undefined, 0),
    makeTicker('TINYUSDT', 'USDT', fields(1, 0.5, 10), undefined, 0),
  ];
  const q = (over: Partial<MarketQuery>): MarketQuery => ({
    search: '',
    favoritesOnly: false,
    favorites: new Set(),
    sort: 'volume',
    dir: 'desc',
    ...over,
  });

  it('derives base asset, change and tick direction', () => {
    const btc = tickers[0]!;
    expect(btc.base).toBe('BTC');
    expect(btc.changePercent).toBeCloseTo(2.564, 2);
    const up = makeTicker('BTCUSDT', 'USDT', fields(80100, 78000), btc, 5);
    expect(up).toMatchObject({ tick: 1, updatedAt: 5 });
    const same = makeTicker('BTCUSDT', 'USDT', fields(80100, 78000), up, 9);
    expect(same).toMatchObject({ tick: 1, updatedAt: 5 });
  });

  it('sorts, searches and filters favorites', () => {
    expect(queryMarkets(tickers, q({})).map((t) => t.base)).toEqual(['BTC', 'ETH', 'DOGE', 'TINY']);
    expect(queryMarkets(tickers, q({ sort: 'change', dir: 'asc' }))[0]!.base).toBe('ETH');
    expect(queryMarkets(tickers, q({ search: 'eth/usdt' })).map((t) => t.base)).toEqual(['ETH']);
    expect(queryMarkets(tickers, q({ favoritesOnly: true, favorites: new Set(['DOGEUSDT']) })).map((t) => t.base)).toEqual(['DOGE']);
  });

  it('ignores illiquid pairs for top movers', () => {
    const stats = marketStats(tickers);
    expect(stats).toMatchObject({ total: 4, gainers: 3, losers: 1 });
    expect(stats.best?.base).toBe('DOGE'); // TINY rose 100% but has no volume
    expect(stats.worst?.base).toBe('ETH');
  });
});

describe('depthView', () => {
  it('accumulates both sides against a shared maximum', () => {
    const view = depthView({ symbol: 'X', asks: [[101, 1], [102, 3]], bids: [[100, 2], [99, 2]] }, 10);
    expect(view.asks.map((r) => r.price)).toEqual([102, 101]); // highest ask on top
    expect(view.asks.map((r) => r.total)).toEqual([4, 1]);
    expect(view.bids.map((r) => r.depth)).toEqual([0.5, 1]);
    expect(view.spread).toBe(1);
    expect(view.spreadPercent).toBeCloseTo(0.995, 2);
  });

  it('handles an empty book', () => {
    expect(depthView(null, 10)).toMatchObject({ asks: [], bids: [], spread: null });
  });
});

describe('util', () => {
  it('grows the backoff exponentially with jitter and a cap', () => {
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(0, () => 1)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
  });

  it('produces a reproducible random sequence', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('computes the rendered window of a virtual list', () => {
    expect(virtualRange(0, 320, 32, 500, 2)).toEqual({ start: 0, end: 12, offset: 0, total: 16000 });
    expect(virtualRange(3200, 320, 32, 500, 2)).toMatchObject({ start: 98, end: 112, offset: 3136 });
    expect(virtualRange(0, 320, 32, 3, 2)).toMatchObject({ start: 0, end: 3 });
  });
});
