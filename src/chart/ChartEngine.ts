import { formatPrice, priceDecimals } from '../core/format';
import { ema, sma } from '../core/indicators';
import type { Candle, Interval } from '../core/types';
import {
  clampViewport,
  defaultViewport,
  indexToX,
  isFollowing,
  niceTicks,
  priceExtent,
  timeLabel,
  timeTickIndices,
  visibleRange,
  xToIndex,
  zoomAt,
  type Viewport,
} from './scale';

export interface ChartColors {
  up: string;
  down: string;
  grid: string;
  text: string;
  crosshair: string;
  axisBg: string;
  sma: string;
  ema: string;
}

export interface Indicators {
  sma: boolean;
  ema: boolean;
}

const AXIS_WIDTH = 78;
const AXIS_HEIGHT = 26;
const TOP_PAD = 12;
const VOLUME_SHARE = 0.18;
const FONT = '11px "JetBrains Mono Variable", ui-monospace, monospace';

/**
 * Canvas candlestick chart. Imperative on purpose: a few thousand shapes per
 * frame are far cheaper as canvas calls than as DOM/SVG nodes, and drawing only
 * happens on demand (dirty flag + requestAnimationFrame).
 */
export class ChartEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private width = 0;
  private height = 0;
  private dpr = 1;

  private candles: Candle[] = [];
  private interval: Interval = '1h';
  private vp: Viewport = defaultViewport(0);
  private follow = true;
  private indicators: Indicators = { sma: true, ema: false };
  private smaLine: number[] = [];
  private emaLine: number[] = [];

  private hover: { x: number; y: number } | null = null;
  private drag: { x: number; endIndex: number } | null = null;
  private frame = 0;

  constructor(
    private readonly container: HTMLElement,
    private colors: ChartColors,
    private readonly onHover: (candle: Candle | null, previous: Candle | null) => void = () => {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.bind();
    this.resize();
  }

  get element() {
    return this.canvas;
  }

  /** `reset` — a new symbol/interval: fit the latest candles again. */
  setData(candles: Candle[], interval: Interval, reset: boolean) {
    const appended = candles.length - this.candles.length;
    this.candles = candles;
    this.interval = interval;
    const closes = candles.map((c) => c.close);
    this.smaLine = sma(closes, 20);
    this.emaLine = ema(closes, 50);

    if (reset) {
      this.vp = defaultViewport(candles.length);
      this.follow = true;
    } else if (this.follow && appended > 0) {
      this.vp = { ...this.vp, endIndex: this.vp.endIndex + appended };
    }
    this.emitHover();
    this.invalidate();
  }

  setIndicators(indicators: Indicators) {
    this.indicators = indicators;
    this.invalidate();
  }

  setColors(colors: ChartColors) {
    this.colors = colors;
    this.invalidate();
  }

  resetView() {
    this.vp = defaultViewport(this.candles.length);
    this.follow = true;
    this.invalidate();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.remove();
  }

  // ── geometry ─────────────────────────────────────────────
  private get plotRight() {
    return this.width - AXIS_WIDTH;
  }

  private get plotBottom() {
    return this.height - AXIS_HEIGHT;
  }

  private setViewport(vp: Viewport) {
    this.vp = clampViewport(vp, this.candles.length, this.plotRight);
    this.follow = isFollowing(this.vp, this.candles.length);
    this.emitHover();
    this.invalidate();
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.invalidate();
  }

  private invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private hoveredIndex(): number | null {
    if (!this.hover || !this.candles.length) return null;
    const index = Math.round(xToIndex(this.hover.x, this.vp, this.plotRight));
    return Math.min(Math.max(index, 0), this.candles.length - 1);
  }

  private emitHover() {
    const index = this.hoveredIndex() ?? this.candles.length - 1;
    this.onHover(this.candles[index] ?? null, this.candles[index - 1] ?? null);
  }

  // ── interaction ──────────────────────────────────────────
  private bind() {
    const c = this.canvas;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = c.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { x: local(e).x, endIndex: this.vp.endIndex };
      c.classList.add('is-dragging');
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.hover = p.x < this.plotRight && p.y < this.plotBottom ? p : null;
      if (this.drag) {
        this.setViewport({ ...this.vp, endIndex: this.drag.endIndex - (p.x - this.drag.x) / this.vp.barSpacing });
      } else {
        this.emitHover();
        this.invalidate();
      }
    });
    const endDrag = () => {
      this.drag = null;
      c.classList.remove('is-dragging');
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.emitHover();
      this.invalidate();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        // while following the latest candle, zoom keeps the right edge pinned
        const x = this.follow ? this.plotRight : local(e).x;
        this.setViewport(zoomAt(this.vp, factor, x, this.plotRight));
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => this.resetView());
    c.addEventListener('keydown', (e) => {
      const pan = (bars: number) => this.setViewport({ ...this.vp, endIndex: this.vp.endIndex + bars });
      const zoom = (factor: number) => this.setViewport(zoomAt(this.vp, factor, this.plotRight, this.plotRight));
      const actions: Record<string, () => void> = {
        ArrowLeft: () => pan(-5),
        ArrowRight: () => pan(5),
        '+': () => zoom(1.2),
        '=': () => zoom(1.2),
        '-': () => zoom(1 / 1.2),
        Home: () => this.resetView(),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    });
  }

  // ── drawing ──────────────────────────────────────────────
  private draw() {
    const { ctx, colors, candles, vp } = this;
    const plotRight = this.plotRight;
    const plotBottom = this.plotBottom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    if (!candles.length || plotRight <= 0 || plotBottom <= TOP_PAD) return;

    const { from, to } = visibleRange(candles.length, vp, plotRight);
    const { min, max } = priceExtent(candles, from, to);
    const plotHeight = plotBottom - TOP_PAD;
    const y = (price: number) => TOP_PAD + ((max - price) / (max - min)) * plotHeight;
    const x = (index: number) => indexToX(index, vp, plotRight);
    const decimals = priceDecimals(candles.at(-1)!.close);

    // grid + price axis values
    const priceTicks = niceTicks(min, max, Math.max(2, Math.floor(plotHeight / 56)));
    const timeTicks = timeTickIndices(from, to, vp.barSpacing);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of priceTicks) {
      const py = Math.round(y(p)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(plotRight, py);
    }
    for (const i of timeTicks) {
      const px = Math.round(x(i)) + 0.5;
      ctx.moveTo(px, TOP_PAD);
      ctx.lineTo(px, plotBottom);
    }
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotRight, plotBottom);
    ctx.clip();

    // volume, overlaid at the bottom of the plot
    let maxVolume = 0;
    for (let i = from; i <= to; i++) maxVolume = Math.max(maxVolume, candles[i]!.volume);
    const volumeHeight = plotHeight * VOLUME_SHARE;
    const body = Math.max(1, Math.floor(vp.barSpacing * 0.7));
    ctx.globalAlpha = 0.28;
    for (let i = from; i <= to; i++) {
      const c = candles[i]!;
      const h = maxVolume ? (c.volume / maxVolume) * volumeHeight : 0;
      ctx.fillStyle = c.close >= c.open ? colors.up : colors.down;
      ctx.fillRect(Math.round(x(i) - body / 2), plotBottom - h, body, h);
    }
    ctx.globalAlpha = 1;

    // candles: wicks then bodies, batched per colour
    for (const up of [true, false]) {
      ctx.strokeStyle = ctx.fillStyle = up ? colors.up : colors.down;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const c = candles[i]!;
        if (c.close >= c.open !== up) continue;
        const px = Math.round(x(i)) + 0.5;
        ctx.moveTo(px, Math.round(y(c.high)));
        ctx.lineTo(px, Math.round(y(c.low)));
      }
      ctx.stroke();
      for (let i = from; i <= to; i++) {
        const c = candles[i]!;
        if (c.close >= c.open !== up) continue;
        const top = Math.round(y(Math.max(c.open, c.close)));
        const bottom = Math.round(y(Math.min(c.open, c.close)));
        ctx.fillRect(Math.round(x(i) - body / 2), top, body, Math.max(1, bottom - top));
      }
    }

    // moving averages
    const line = (values: number[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i++) {
        const v = values[i]!;
        if (Number.isNaN(v)) continue;
        if (started) ctx.lineTo(x(i), y(v));
        else ctx.moveTo(x(i), y(v));
        started = true;
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    if (this.indicators.sma) line(this.smaLine, colors.sma);
    if (this.indicators.ema) line(this.emaLine, colors.ema);

    // last price line
    const last = candles.at(-1)!;
    const lastColor = last.close >= last.open ? colors.up : colors.down;
    const lastY = Math.round(y(last.close)) + 0.5;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = lastColor;
    ctx.beginPath();
    ctx.moveTo(0, lastY);
    ctx.lineTo(plotRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // crosshair
    const hovered = this.hoveredIndex();
    if (this.hover && hovered !== null) {
      const hx = Math.round(x(hovered)) + 0.5;
      const hy = Math.round(this.hover.y) + 0.5;
      ctx.strokeStyle = colors.crosshair;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, TOP_PAD);
      ctx.lineTo(hx, plotBottom);
      ctx.moveTo(0, hy);
      ctx.lineTo(plotRight, hy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // axes
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    for (const p of priceTicks) ctx.fillText(formatPrice(p, decimals), plotRight + 8, y(p));
    ctx.textAlign = 'center';
    for (const i of timeTicks) {
      const c = candles[i];
      if (c) ctx.fillText(timeLabel(c.time, this.interval, candles[i - 1]?.time), x(i), plotBottom + AXIS_HEIGHT / 2);
    }

    const axisLabel = (text: string, cx: number, cy: number, bg: string, align: 'left' | 'center') => {
      const w = ctx.measureText(text).width + 12;
      const left = align === 'left' ? cx : cx - w / 2;
      ctx.fillStyle = bg;
      ctx.fillRect(left, cy - 10, w, 20);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(text, left + 6, cy);
    };
    axisLabel(formatPrice(last.close, decimals), plotRight + 2, lastY, lastColor, 'left');

    if (this.hover && hovered !== null) {
      const price = max - ((this.hover.y - TOP_PAD) / plotHeight) * (max - min);
      axisLabel(formatPrice(price, decimals), plotRight + 2, this.hover.y, this.colors.axisBg, 'left');
      const c = candles[hovered]!;
      const label = this.interval === '1d' ? timeLabel(c.time, '1d') : `${timeLabel(c.time, '1d')} ${timeLabel(c.time, '1h', c.time)}`;
      axisLabel(label, x(hovered), plotBottom + AXIS_HEIGHT / 2, this.colors.axisBg, 'center');
    }
  }
}
