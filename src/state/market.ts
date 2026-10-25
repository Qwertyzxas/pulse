import { computed, inject, ref, shallowRef, type InjectionKey } from 'vue';
import { mergeCandle } from '../core/candles';
import type { Candle, FeedMode, FeedStatus, Interval, OrderBook, Ticker, Trade } from '../core/types';
import type { WorkerCommand, WorkerEvent } from '../feed/protocol';

export interface Transport {
  send(command: WorkerCommand): void;
  listen(handler: (event: WorkerEvent) => void): void;
}

export function workerTransport(): Transport {
  const worker = new Worker(new URL('../feed/worker.ts', import.meta.url), { type: 'module' });
  return {
    send: (command) => worker.postMessage(command),
    listen: (handler) => worker.addEventListener('message', (e: MessageEvent<WorkerEvent>) => handler(e.data)),
  };
}

export const MAX_TRADES = 60;
const FAVORITES_KEY = 'pulse:favorites';

function loadFavorites(storage?: Storage): Set<string> {
  try {
    const list: unknown = JSON.parse(storage?.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}

export interface MarketOptions {
  mode: FeedMode;
  symbol: string;
  interval: Interval;
  seed?: number;
  storage?: Storage;
}

export function createMarket(transport: Transport, options: MarketOptions) {
  // shallowRefs: hundreds of tickers and candles are replaced wholesale per batch,
  // deep reactivity would only add proxy overhead
  const tickers = shallowRef(new Map<string, Ticker>());
  const candles = shallowRef<Candle[]>([]);
  const book = shallowRef<OrderBook | null>(null);
  const trades = shallowRef<Trade[]>([]);
  const symbol = ref(options.symbol);
  const interval = ref<Interval>(options.interval);
  const historyLoaded = ref(false);
  /** Bumped on every fresh history load: the chart resets its viewport then */
  const historyVersion = ref(0);
  const status = ref<FeedStatus>({ mode: options.mode, state: 'connecting', messagesPerSecond: 0 });
  const favorites = ref(loadFavorites(options.storage));

  const selected = computed(() => tickers.value.get(symbol.value));

  transport.listen((event) => {
    switch (event.type) {
      case 'status':
        status.value = { ...status.value, ...event.status };
        break;
      case 'history':
        if (event.symbol !== symbol.value || event.interval !== interval.value) return;
        // a gap-filling refresh after a reconnect must not reset the chart viewport
        if (!event.refresh || !historyLoaded.value) historyVersion.value++;
        candles.value = event.candles;
        historyLoaded.value = true;
        break;
      case 'batch': {
        if (event.tickers.length) {
          const next = new Map(tickers.value);
          for (const t of event.tickers) next.set(t.symbol, t);
          tickers.value = next;
        }
        const c = event.candle;
        if (c && historyLoaded.value && c.symbol === symbol.value && c.interval === interval.value) {
          candles.value = mergeCandle(candles.value, c.candle);
        }
        if (event.book?.symbol === symbol.value) book.value = event.book;
        if (event.trades?.symbol === symbol.value) {
          trades.value = [...event.trades.trades.slice().reverse(), ...trades.value].slice(0, MAX_TRADES);
        }
        break;
      }
    }
  });

  function select(nextSymbol: string, nextInterval: Interval = interval.value) {
    if (nextSymbol === symbol.value && nextInterval === interval.value) return;
    if (nextSymbol !== symbol.value) {
      book.value = null;
      trades.value = [];
    }
    symbol.value = nextSymbol;
    interval.value = nextInterval;
    candles.value = [];
    historyLoaded.value = false;
    transport.send({ type: 'select', symbol: nextSymbol, interval: nextInterval });
  }

  function toggleFavorite(s: string) {
    const next = new Set(favorites.value);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    favorites.value = next;
    try {
      options.storage?.setItem(FAVORITES_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable: favorites live for this session only */
    }
  }

  const retryLive = () => transport.send({ type: 'retry-live' });

  transport.send({ type: 'start', mode: options.mode, symbol: options.symbol, interval: options.interval, seed: options.seed });

  return {
    tickers,
    candles,
    book,
    trades,
    symbol,
    interval,
    historyLoaded,
    historyVersion,
    status,
    favorites,
    selected,
    select,
    toggleFavorite,
    retryLive,
  };
}

export type Market = ReturnType<typeof createMarket>;

export const MarketKey: InjectionKey<Market> = Symbol('market');

export function useMarket(): Market {
  const market = inject(MarketKey);
  if (!market) throw new Error('useMarket() called without a provided market');
  return market;
}
