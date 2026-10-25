import type { Ticker } from './types';

export type SortKey = 'symbol' | 'price' | 'change' | 'volume';
export type SortDir = 'asc' | 'desc';

export interface MarketQuery {
  search: string;
  favoritesOnly: boolean;
  favorites: ReadonlySet<string>;
  sort: SortKey;
  dir: SortDir;
}

const compare: Record<SortKey, (a: Ticker, b: Ticker) => number> = {
  symbol: (a, b) => a.base.localeCompare(b.base),
  price: (a, b) => a.price - b.price,
  change: (a, b) => a.changePercent - b.changePercent,
  volume: (a, b) => a.quoteVolume - b.quoteVolume,
};

export function queryMarkets(tickers: Iterable<Ticker>, q: MarketQuery): Ticker[] {
  const search = q.search.trim().toUpperCase().replace(/[\s/-]/g, '');
  const result: Ticker[] = [];
  for (const t of tickers) {
    if (q.favoritesOnly && !q.favorites.has(t.symbol)) continue;
    if (search && !t.symbol.includes(search)) continue;
    result.push(t);
  }
  const sign = q.dir === 'asc' ? 1 : -1;
  const by = compare[q.sort];
  return result.sort((a, b) => by(a, b) * sign || a.symbol.localeCompare(b.symbol));
}

export const LIQUID_VOLUME = 1_000_000;

export function marketStats(tickers: Iterable<Ticker>) {
  let gainers = 0;
  let losers = 0;
  let best: Ticker | undefined;
  let worst: Ticker | undefined;
  let total = 0;
  for (const t of tickers) {
    total++;
    if (t.changePercent > 0) gainers++;
    else if (t.changePercent < 0) losers++;
    if (t.quoteVolume < LIQUID_VOLUME) continue;
    if (!best || t.changePercent > best.changePercent) best = t;
    if (!worst || t.changePercent < worst.changePercent) worst = t;
  }
  return { total, gainers, losers, best, worst };
}

export function makeTicker(
  symbol: string,
  quote: string,
  fields: { price: number; open: number; high: number; low: number; volume: number; quoteVolume: number },
  previous: Ticker | undefined,
  now: number,
): Ticker {
  const { price, open } = fields;
  return {
    symbol,
    base: symbol.slice(0, -quote.length),
    quote,
    ...fields,
    changePercent: open ? ((price - open) / open) * 100 : 0,
    tick: !previous || previous.price === price ? (previous?.tick ?? 0) : price > previous.price ? 1 : -1,
    updatedAt: previous && previous.price === price ? previous.updatedAt : now,
  };
}
