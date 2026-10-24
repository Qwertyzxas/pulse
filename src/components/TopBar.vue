<script setup lang="ts">
import { computed } from 'vue';
import { formatPercent } from '../core/format';
import { marketStats } from '../core/markets';
import { useMarket } from '../state/market';

const market = useMarket();
const stats = computed(() => marketStats(market.tickers.value.values()));

const statusText = computed(() => {
  const s = market.status.value;
  if (s.mode === 'demo') return 'Демо-данные';
  if (s.state === 'open') return 'Live · Binance';
  if (s.state === 'reconnecting') return 'Переподключение…';
  return 'Подключение…';
});
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="brand__name">Pulse</span>
    </div>

    <div class="status" :class="[`status--${market.status.value.mode}`, `status--${market.status.value.state}`]" role="status">
      <i aria-hidden="true" />
      <span>{{ statusText }}</span>
      <span v-if="market.status.value.reason" class="status__reason">· {{ market.status.value.reason }}</span>
      <button v-if="market.status.value.mode === 'demo'" type="button" class="link-button" @click="market.retryLive">
        Подключиться к бирже
      </button>
    </div>
    <span class="rate" title="Сообщений от источника в секунду">{{ market.status.value.messagesPerSecond }} сообщ./с</span>

    <dl class="stats">
      <div>
        <dt>Пар</dt>
        <dd>{{ stats.total }}</dd>
      </div>
      <div>
        <dt>Растут</dt>
        <dd class="up">{{ stats.gainers }}</dd>
      </div>
      <div>
        <dt>Падают</dt>
        <dd class="down">{{ stats.losers }}</dd>
      </div>
      <div v-if="stats.best">
        <dt>Лидер</dt>
        <dd>
          <button type="button" class="mover" @click="market.select(stats.best.symbol)">
            {{ stats.best.base }} <span class="up">{{ formatPercent(stats.best.changePercent) }}</span>
          </button>
        </dd>
      </div>
      <div v-if="stats.worst">
        <dt>Аутсайдер</dt>
        <dd>
          <button type="button" class="mover" @click="market.select(stats.worst.symbol)">
            {{ stats.worst.base }} <span class="down">{{ formatPercent(stats.worst.changePercent) }}</span>
          </button>
        </dd>
      </div>
    </dl>
  </header>
</template>
