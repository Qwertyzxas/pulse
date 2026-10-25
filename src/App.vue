<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import OrderBook from './components/OrderBook.vue';
import PairHeader from './components/PairHeader.vue';
import PriceChart from './components/PriceChart.vue';
import TopBar from './components/TopBar.vue';
import TradesFeed from './components/TradesFeed.vue';
import Watchlist from './components/Watchlist.vue';
import { formatPercent, formatPrice } from './core/format';
import { useMarket } from './state/market';

const market = useMarket();
const chart = ref<InstanceType<typeof PriceChart> | null>(null);
const indicators = reactive({ sma: true, ema: false });

watch([market.symbol, market.interval], ([s, i]) => {
  const params = new URLSearchParams(location.search);
  params.set('s', s);
  params.set('i', i);
  history.replaceState(null, '', `${location.pathname}?${params}`);
});

watch(
  () => market.selected.value,
  (t) => {
    document.title = t ? `${formatPrice(t.price)} ${t.base} ${formatPercent(t.changePercent)} · Pulse` : 'Pulse';
  },
);
</script>

<template>
  <div class="app">
    <TopBar />
    <main class="layout">
      <Watchlist class="area-markets" />
      <section class="panel area-chart" aria-label="График">
        <PairHeader :indicators="indicators" @toggle="(k) => (indicators[k] = !indicators[k])" @reset="chart?.reset()" />
        <PriceChart ref="chart" :indicators="indicators" />
      </section>
      <OrderBook class="area-book" />
      <TradesFeed class="area-trades" />
    </main>
  </div>
</template>
