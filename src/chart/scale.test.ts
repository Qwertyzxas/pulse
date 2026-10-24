import { describe, expect, it } from 'vitest';
import type { Candle } from '../core/types';
import {
  clampViewport,
  defaultViewport,
  indexToX,
  isFollowing,
  MAX_SPACING,
  niceTicks,
  priceExtent,
  RIGHT_MARGIN_BARS,
  timeLabel,
  timeTickIndices,
  visibleRange,
  xToIndex,
  zoomAt,
} from './scale';

describe('viewport math', () => {
  const vp = { endIndex: 99, barSpacing: 10 };

  it('maps indexes to x and back', () => {
    expect(indexToX(99, vp, 500)).toBe(500);
    expect(indexToX(89, vp, 500)).toBe(400);
    expect(xToIndex(400, vp, 500)).toBe(89);
  });

  it('finds the visible slice', () => {
    expect(visibleRange(100, vp, 500)).toEqual({ from: 49, to: 99 });
    expect(visibleRange(200, { endIndex: 20, barSpacing: 10 }, 500)).toEqual({ from: 0, to: 20 });
  });

  it('keeps the candle under the cursor in place while zooming', () => {
    const zoomed = zoomAt(vp, 2, 300, 500);
    expect(zoomed.barSpacing).toBe(20);
    expect(xToIndex(300, zoomed, 500)).toBeCloseTo(xToIndex(300, vp, 500));
  });

  it('clamps spacing and panning', () => {
    expect(clampViewport({ endIndex: 99, barSpacing: 500 }, 100, 500).barSpacing).toBe(MAX_SPACING);
    expect(clampViewport({ endIndex: -50, barSpacing: 10 }, 100, 500).endIndex).toBe(5);
    expect(clampViewport({ endIndex: 1000, barSpacing: 10 }, 100, 500).endIndex).toBe(99 + 25);
  });

  it('follows new candles only while the latest one is visible', () => {
    expect(defaultViewport(100).endIndex).toBe(99 + RIGHT_MARGIN_BARS);
    expect(isFollowing(defaultViewport(100), 100)).toBe(true);
    expect(isFollowing({ endIndex: 60, barSpacing: 8 }, 100)).toBe(false);
  });
});

describe('priceExtent', () => {
  const c = (low: number, high: number): Candle => ({ time: 0, open: low, close: high, low, high, volume: 0 });

  it('pads the visible high/low range', () => {
    const { min, max } = priceExtent([c(100, 110), c(90, 105), c(1, 1000)], 0, 1);
    expect(min).toBeCloseTo(90 - 1.6);
    expect(max).toBeCloseTo(110 + 1.6);
  });

  it('never returns an empty range', () => {
    const { min, max } = priceExtent([c(50, 50)], 0, 0);
    expect(max).toBeGreaterThan(min);
  });
});

describe('niceTicks', () => {
  it('uses 1/2/5 steps', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    // maxTicks is an upper bound: 680 / 6 ≈ 113 rounds up to a step of 200
    expect(niceTicks(79210, 79890, 6)).toEqual([79400, 79600, 79800]);
    expect(niceTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });

  it('handles degenerate input', () => {
    expect(niceTicks(5, 5, 4)).toEqual([]);
  });
});

describe('time axis', () => {
  it('places labels on absolute multiples so they do not shimmer while panning', () => {
    expect(timeTickIndices(0, 100, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(timeTickIndices(7, 40, 5)).toEqual([20, 40]);
  });

  it('shows dates at day boundaries and clock time inside a day', () => {
    const day1 = new Date(2026, 9, 24, 23, 0).getTime();
    const day2 = new Date(2026, 9, 25, 0, 0).getTime();
    expect(timeLabel(day1 + 0, '1h', day1 - 3_600_000)).toBe('23:00');
    expect(timeLabel(day2, '1h', day1)).toBe('25 окт');
    expect(timeLabel(day2, '1d', day1)).toBe('25 окт');
  });
});
