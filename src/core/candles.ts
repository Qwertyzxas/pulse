import type { Candle, Interval } from './types';

const MINUTE = 60_000;

export const INTERVALS: { id: Interval; label: string; ms: number }[] = [
  { id: '1m', label: '1м', ms: MINUTE },
  { id: '5m', label: '5м', ms: 5 * MINUTE },
  { id: '15m', label: '15м', ms: 15 * MINUTE },
  { id: '1h', label: '1ч', ms: 60 * MINUTE },
  { id: '4h', label: '4ч', ms: 240 * MINUTE },
  { id: '1d', label: '1д', ms: 1440 * MINUTE },
];

export const intervalMs = (interval: Interval) => INTERVALS.find((i) => i.id === interval)!.ms;

export const MAX_CANDLES = 1000;

export function mergeCandle(series: Candle[], candle: Candle): Candle[] {
  const last = series.at(-1);
  if (!last || candle.time > last.time) {
    const next = [...series, candle];
    return next.length > MAX_CANDLES ? next.slice(-MAX_CANDLES) : next;
  }
  if (candle.time === last.time) {
    if (
      last.open === candle.open &&
      last.high === candle.high &&
      last.low === candle.low &&
      last.close === candle.close &&
      last.volume === candle.volume
    ) {
      return series;
    }
    const next = series.slice();
    next[next.length - 1] = candle;
    return next;
  }
  return series;
}
