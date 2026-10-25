import type { BookLevel, OrderBook } from './types';

export interface DepthRow {
  price: number;
  qty: number;
  total: number;
  depth: number;
}

function cumulate(levels: BookLevel[], count: number): { rows: DepthRow[]; max: number } {
  let total = 0;
  const rows = levels.slice(0, count).map(([price, qty]) => {
    total += qty;
    return { price, qty, total, depth: 0 };
  });
  return { rows, max: total };
}

export function depthView(book: OrderBook | null, count: number) {
  if (!book) return { asks: [], bids: [], spread: null, spreadPercent: null, mid: null };
  const asks = cumulate(book.asks, count);
  const bids = cumulate(book.bids, count);
  const max = Math.max(asks.max, bids.max) || 1;
  for (const row of [...asks.rows, ...bids.rows]) row.depth = row.total / max;

  const bestAsk = book.asks[0]?.[0];
  const bestBid = book.bids[0]?.[0];
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : null;
  const mid = spread !== null ? (bestAsk! + bestBid!) / 2 : null;
  return {
    asks: asks.rows.reverse(),
    bids: bids.rows,
    spread,
    spreadPercent: spread !== null && mid ? (spread / mid) * 100 : null,
    mid,
  };
}
