<script setup lang="ts">
import { formatPrice, formatQty, formatTime } from '../core/format';
import { useMarket } from '../state/market';

const market = useMarket();
</script>

<template>
  <section class="panel trades" aria-labelledby="trades-title">
    <header class="panel__header">
      <h2 id="trades-title">Сделки</h2>
    </header>
    <div class="book__head" aria-hidden="true"><span>Цена</span><span>Кол-во</span><span>Время</span></div>
    <p v-if="!market.trades.value.length" class="empty">Ожидание сделок…</p>
    <ol class="trades__list" aria-label="Последние сделки" tabindex="0">
      <li v-for="trade in market.trades.value" :key="trade.id" class="trades__row">
        <span class="num" :class="trade.sell ? 'down' : 'up'">{{ formatPrice(trade.price) }}</span>
        <span class="num">{{ formatQty(trade.qty) }}</span>
        <span class="num muted">{{ formatTime(trade.time) }}</span>
      </li>
    </ol>
  </section>
</template>
