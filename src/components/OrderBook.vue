<script setup lang="ts">
import { computed } from 'vue';
import { depthView } from '../core/book';
import { formatPercent, formatPrice, formatQty, priceDecimals } from '../core/format';
import { useMarket } from '../state/market';

const LEVELS = 15;
const market = useMarket();
const view = computed(() => depthView(market.book.value, LEVELS));
const decimals = computed(() => priceDecimals(market.book.value?.bids[0]?.[0] ?? market.selected.value?.price ?? 1));
// the last trade is fresher than the 1-second ticker, so it anchors the spread row
const last = computed(() => {
  const trade = market.trades.value[0];
  const ticker = market.selected.value;
  if (!trade) return ticker ? { price: ticker.price, up: ticker.tick >= 0, key: ticker.updatedAt } : null;
  return { price: trade.price, up: !trade.sell, key: trade.id };
});
</script>

<template>
  <section class="panel book" aria-labelledby="book-title">
    <header class="panel__header">
      <h2 id="book-title">Стакан</h2>
      <span v-if="view.spread !== null" class="muted num" title="Разница между лучшей ценой продажи и покупки">
        спред {{ formatPrice(view.spread, decimals) }} ({{ formatPercent(view.spreadPercent ?? 0).replace('+', '') }})
      </span>
    </header>
    <div class="book__head" aria-hidden="true">
      <span>Цена</span><span>Кол-во</span><span>Всего</span>
    </div>

    <p v-if="!market.book.value" class="empty">Ожидание стакана…</p>
    <template v-else>
      <ol class="book__side book__side--asks" aria-label="Заявки на продажу">
        <li v-for="row in view.asks" :key="row.price" class="book__row">
          <i class="book__bar" :style="{ width: `${row.depth * 100}%` }" />
          <span class="num down">{{ formatPrice(row.price, decimals) }}</span>
          <span class="num">{{ formatQty(row.qty) }}</span>
          <span class="num muted">{{ formatQty(row.total) }}</span>
        </li>
      </ol>
      <div class="book__mid">
        <span v-if="last" :key="last.key" class="num" :class="last.up ? 'up' : 'down'" title="Цена последней сделки">
          {{ formatPrice(last.price) }} {{ last.up ? '↑' : '↓' }}
        </span>
      </div>
      <ol class="book__side book__side--bids" aria-label="Заявки на покупку">
        <li v-for="row in view.bids" :key="row.price" class="book__row">
          <i class="book__bar" :style="{ width: `${row.depth * 100}%` }" />
          <span class="num up">{{ formatPrice(row.price, decimals) }}</span>
          <span class="num">{{ formatQty(row.qty) }}</span>
          <span class="num muted">{{ formatQty(row.total) }}</span>
        </li>
      </ol>
    </template>
  </section>
</template>
