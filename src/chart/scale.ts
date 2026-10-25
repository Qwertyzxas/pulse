import type { Candle, Interval } from '../core/types';

export interface Viewport {
  endIndex: number;
  barSpacing: number;
}

export const MIN_SPACING = 2;
export const MAX_SPACING = 40;
export const DEFAULT_SPACING = 8;
export const RIGHT_MARGIN_BARS = 4;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const defaultViewport = (count: number): Viewport => ({
  endIndex: count - 1 + RIGHT_MARGIN_BARS,
  barSpacing: DEFAULT_SPACING,
});

export const indexToX = (index: number, vp: Viewport, plotRight: number) => plotRight - (vp.endIndex - index) * vp.barSpacing;
export const xToIndex = (x: number, vp: Viewport, plotRight: number) => vp.endIndex - (plotRight - x) / vp.barSpacing;

export function visibleRange(count: number, vp: Viewport, plotWidth: number) {
  const from = Math.max(0, Math.floor(vp.endIndex - plotWidth / vp.barSpacing));
  const to = Math.min(count - 1, Math.ceil(vp.endIndex));
  return { from, to };
}

export function clampViewport(vp: Viewport, count: number, plotWidth: number): Viewport {
  const barSpacing = clamp(vp.barSpacing, MIN_SPACING, MAX_SPACING);
  const min = Math.min(count - 1, 5);
  const max = Math.max(min, count - 1 + (plotWidth / barSpacing) * 0.5);
  return { barSpacing, endIndex: clamp(vp.endIndex, min, max) };
}

export function zoomAt(vp: Viewport, factor: number, x: number, plotRight: number): Viewport {
  const anchor = xToIndex(x, vp, plotRight);
  const barSpacing = clamp(vp.barSpacing * factor, MIN_SPACING, MAX_SPACING);
  return { barSpacing, endIndex: anchor + (plotRight - x) / barSpacing };
}

export const isFollowing = (vp: Viewport, count: number) => vp.endIndex >= count - 1;

export function priceExtent(candles: Candle[], from: number, to: number) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

export function niceTicks(min: number, max: number, maxTicks: number): number[] {
  if (!(max > min) || maxTicks < 1) return [];
  const rough = (max - min) / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(decimals)));
  }
  return ticks;
}

export function timeTickIndices(from: number, to: number, barSpacing: number, minGapPx = 90): number[] {
  const steps = [1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 240, 480];
  const step = steps.find((s) => s * barSpacing >= minGapPx) ?? Math.ceil(minGapPx / barSpacing);
  const ticks: number[] = [];
  for (let i = Math.ceil(from / step) * step; i <= to; i += step) ticks.push(i);
  return ticks;
}

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const hourFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });

export function timeLabel(time: number, interval: Interval, previous?: number): string {
  if (interval === '1d') return dayFormat.format(time).replace('.', '');
  if (previous === undefined || new Date(previous).toDateString() !== new Date(time).toDateString()) {
    return dayFormat.format(time).replace('.', '');
  }
  return hourFormat.format(time);
}
