<script setup lang="ts">
import { computed } from 'vue';
import { INTERVALS } from '../core/candles';
import { formatCompact, formatPercent, formatPrice } from '../core/format';
import { useMarket } from '../state/market';

defineProps<{ indicators: { sma: boolean; ema: boolean } }>();
const emit = defineEmits<{ toggle: [key: 'sma' | 'ema']; reset: [] }>();

const market = useMarket();
const t = computed(() => market.selected.value);
const base = computed(() => market.symbol.value.replace(/USDT$/, ''));
</script>

<template>
  <div class="pair">
    <div class="pair__title">
      <button
        type="button"
        class="star star--lg"
        :aria-pressed="market.favorites.value.has(market.symbol.value)"
        :aria-label="`${base} в избранном`"
        @click="market.toggleFavorite(market.symbol.value)"
      >
        ★
      </button>
      <h1>{{ base }}<span class="muted">/USDT</span></h1>
      <template v-if="t">
        <span :key="t.updatedAt" class="num pair__price" :class="t.tick > 0 ? 'up flash-up' : t.tick < 0 ? 'down flash-down' : ''">
          {{ formatPrice(t.price) }}
        </span>
        <span class="num" :class="t.changePercent >= 0 ? 'up' : 'down'">
          {{ formatPrice(t.price - t.open) }} ({{ formatPercent(t.changePercent) }})
        </span>
      </template>
    </div>

    <dl v-if="t" class="pair__stats">
      <div><dt>Макс. 24ч</dt><dd class="num">{{ formatPrice(t.high) }}</dd></div>
      <div><dt>Мин. 24ч</dt><dd class="num">{{ formatPrice(t.low) }}</dd></div>
      <div><dt>Объём ({{ t.base }})</dt><dd class="num">{{ formatCompact(t.volume) }}</dd></div>
      <div><dt>Объём (USDT)</dt><dd class="num">{{ formatCompact(t.quoteVolume) }}</dd></div>
    </dl>

    <div class="pair__tools">
      <div class="segmented" role="group" aria-label="Интервал свечей">
        <button
          v-for="i in INTERVALS"
          :key="i.id"
          type="button"
          :aria-pressed="market.interval.value === i.id"
          @click="market.select(market.symbol.value, i.id)"
        >
          {{ i.label }}
        </button>
      </div>
      <label class="toggle"><input type="checkbox" :checked="indicators.sma" @change="emit('toggle', 'sma')" /><i class="swatch swatch--sma" />MA 20</label>
      <label class="toggle"><input type="checkbox" :checked="indicators.ema" @change="emit('toggle', 'ema')" /><i class="swatch swatch--ema" />EMA 50</label>
      <button type="button" class="ghost-button" title="Двойной клик по графику делает то же самое" @click="emit('reset')">Сбросить вид</button>
    </div>
  </div>
</template>
