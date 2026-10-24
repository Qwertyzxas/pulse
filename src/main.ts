import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { createApp } from 'vue';
import App from './App.vue';
import { INTERVALS } from './core/candles';
import type { Interval } from './core/types';
import { createMarket, MarketKey, workerTransport } from './state/market';

const params = new URLSearchParams(location.search);
const symbol = /^[A-Z0-9]{2,20}USDT$/.test(params.get('s') ?? '') ? params.get('s')! : 'BTCUSDT';
const interval = INTERVALS.some((i) => i.id === params.get('i')) ? (params.get('i') as Interval) : '1h';

let storage: Storage | undefined;
try {
  storage = localStorage;
} catch {
  /* blocked storage: favorites are kept in memory */
}

const market = createMarket(workerTransport(), {
  // ?demo — synthetic market (offline showcase and end-to-end tests)
  mode: params.has('demo') ? 'demo' : 'live',
  seed: Number(params.get('seed')) || 42,
  symbol,
  interval,
  storage,
});

createApp(App).provide(MarketKey, market).mount('#app');
