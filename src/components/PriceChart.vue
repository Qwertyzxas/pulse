<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { ChartEngine, type ChartColors } from '../chart/ChartEngine';
import { INTERVALS } from '../core/candles';
import { formatCompact, formatPercent, formatPrice } from '../core/format';
import type { Candle } from '../core/types';
import { useMarket } from '../state/market';

const props = defineProps<{ indicators: { sma: boolean; ema: boolean } }>();
const market = useMarket();

const host = ref<HTMLElement | null>(null);
const engine = shallowRef<ChartEngine | null>(null);
const legend = shallowRef<{ candle: Candle; previous: Candle | null } | null>(null);

function readColors(el: HTMLElement): ChartColors {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    up: v('--up'),
    down: v('--down'),
    grid: v('--chart-grid'),
    text: v('--muted'),
    crosshair: v('--chart-crosshair'),
    axisBg: v('--chart-axis-bg'),
    sma: v('--sma'),
    ema: v('--ema'),
  };
}

onMounted(() => {
  const el = host.value!;
  const chart = new ChartEngine(el, readColors(el), (candle, previous) => {
    legend.value = candle ? { candle, previous } : null;
  });
  chart.element.setAttribute('role', 'img');
  chart.setIndicators(props.indicators);
  engine.value = chart;
});
onBeforeUnmount(() => engine.value?.destroy());

let renderedVersion = -1;
watch(
  [engine, market.candles, market.historyVersion],
  ([chart, candles, version]) => {
    if (!chart) return;
    chart.setData(candles, market.interval.value, version !== renderedVersion);
    renderedVersion = version;
  },
  { immediate: true },
);
watch(
  () => props.indicators,
  (value) => engine.value?.setIndicators(value),
  { deep: true },
);

const intervalLabel = computed(() => INTERVALS.find((i) => i.id === market.interval.value)?.label);
const label = computed(() => {
  const base = market.symbol.value.replace(/USDT$/, '');
  return `Свечной график ${base}/USDT, интервал ${intervalLabel.value}. Колесо — масштаб, перетаскивание — прокрутка, стрелки — сдвиг, двойной клик — сброс.`;
});
watch([engine, label], ([chart, text]) => chart?.element.setAttribute('aria-label', text), { immediate: true });

const change = computed(() => {
  const l = legend.value;
  if (!l) return null;
  const ref = l.previous?.close ?? l.candle.open;
  return ((l.candle.close - ref) / ref) * 100;
});

defineExpose({ reset: () => engine.value?.resetView() });
</script>

<template>
  <div class="chart">
    <div ref="host" class="chart__host" />
    <div v-if="legend" class="chart__legend num" data-testid="chart-legend">
      <span>О <b :class="legend.candle.close >= legend.candle.open ? 'up' : 'down'">{{ formatPrice(legend.candle.open) }}</b></span>
      <span>М <b :class="legend.candle.close >= legend.candle.open ? 'up' : 'down'">{{ formatPrice(legend.candle.high) }}</b></span>
      <span>Н <b :class="legend.candle.close >= legend.candle.open ? 'up' : 'down'">{{ formatPrice(legend.candle.low) }}</b></span>
      <span>З <b :class="legend.candle.close >= legend.candle.open ? 'up' : 'down'">{{ formatPrice(legend.candle.close) }}</b></span>
      <span v-if="change !== null" :class="change >= 0 ? 'up' : 'down'">{{ formatPercent(change) }}</span>
      <span>Об. <b>{{ formatCompact(legend.candle.volume) }}</b></span>
    </div>
    <div v-if="!market.historyLoaded.value" class="chart__overlay" role="status">
      <span class="spinner" aria-hidden="true" />Загрузка свечей…
    </div>
    <div v-else-if="!market.candles.value.length" class="chart__overlay" role="status">
      Нет данных по этой паре. Выберите другую в списке рынков.
    </div>
  </div>
</template>
