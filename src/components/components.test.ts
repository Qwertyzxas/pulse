import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { makeTicker } from '../core/markets';
import type { Candle } from '../core/types';
import type { WorkerCommand, WorkerEvent } from '../feed/protocol';
import { createMarket, MarketKey, type Market, type Transport } from '../state/market';
import OrderBook from './OrderBook.vue';
import PairHeader from './PairHeader.vue';
import TopBar from './TopBar.vue';
import Watchlist from './Watchlist.vue';

class FakeTransport implements Transport {
  sent: WorkerCommand[] = [];
  private handler: (e: WorkerEvent) => void = () => {};
  send(command: WorkerCommand) {
    this.sent.push(command);
  }
  listen(handler: (e: WorkerEvent) => void) {
    this.handler = handler;
  }
  emit(event: WorkerEvent) {
    this.handler(event);
  }
}

const ticker = (base: string, price: number, open: number, quoteVolume: number) =>
  makeTicker(`${base}USDT`, 'USDT', { price, open, high: price, low: price, volume: 1, quoteVolume }, undefined, 0);

const batch = (over: Partial<Extract<WorkerEvent, { type: 'batch' }>>): WorkerEvent => ({
  type: 'batch',
  tickers: [],
  candle: null,
  book: null,
  trades: null,
  ...over,
});

let transport: FakeTransport;
let market: Market;

beforeEach(() => {
  // jsdom has no layout: give the virtual list a size
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  transport = new FakeTransport();
  market = createMarket(transport, { mode: 'demo', symbol: 'BTCUSDT', interval: '1h', storage: localStorage });
  localStorage.clear();
  transport.emit(
    batch({
      tickers: [ticker('BTC', 80000, 78000, 1e9), ticker('ETH', 3000, 3100, 5e8), ticker('DOGE', 0.2, 0.18, 2e8)],
    }),
  );
});

const withMarket = (component: unknown, props: Record<string, unknown> = {}) =>
  mount(defineComponent({ render: () => h(component as never, props) }), {
    global: { provide: { [MarketKey as symbol]: market } },
  });

describe('market store', () => {
  it('starts the worker with the initial selection', () => {
    expect(transport.sent[0]).toEqual({ type: 'start', mode: 'demo', symbol: 'BTCUSDT', interval: '1h', seed: undefined });
  });

  it('applies history, then merges live candles for the current selection only', () => {
    const c = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });
    transport.emit({ type: 'history', symbol: 'BTCUSDT', interval: '1h', candles: [c(1, 10)] });
    transport.emit(batch({ candle: { symbol: 'BTCUSDT', interval: '1h', candle: c(2, 11) } }));
    transport.emit(batch({ candle: { symbol: 'ETHUSDT', interval: '1h', candle: c(3, 99) } }));
    expect(market.candles.value.map((x) => x.close)).toEqual([10, 11]);
    expect(market.historyVersion.value).toBe(1);
  });

  it('ignores history that arrives after the user switched pairs', () => {
    market.select('ETHUSDT');
    transport.emit({ type: 'history', symbol: 'BTCUSDT', interval: '1h', candles: [] });
    expect(market.historyLoaded.value).toBe(false);
    expect(transport.sent.at(-1)).toEqual({ type: 'select', symbol: 'ETHUSDT', interval: '1h' });
  });
});

describe('Watchlist', () => {
  it('lists pairs by volume and sorts by change', async () => {
    const wrapper = withMarket(Watchlist);
    const pairs = () => wrapper.findAll('.market-row__pair strong').map((n) => n.text());
    expect(pairs()).toEqual(['BTC', 'ETH', 'DOGE']);

    await wrapper.findAll('.sortbar button').find((b) => b.text().startsWith('24ч'))!.trigger('click');
    expect(pairs()).toEqual(['DOGE', 'BTC', 'ETH']);
  });

  it('searches and selects a pair', async () => {
    const wrapper = withMarket(Watchlist);
    await wrapper.find('input[type="search"]').setValue('eth');
    expect(wrapper.findAll('.market-row')).toHaveLength(1);
    await wrapper.find('.market-row__main').trigger('click');
    expect(market.symbol.value).toBe('ETHUSDT');
  });

  it('keeps favorites and persists them', async () => {
    const wrapper = withMarket(Watchlist);
    await wrapper.find('button[aria-label="DOGE в избранном"]').trigger('click');
    await wrapper.findAll('.tabs button')[1]!.trigger('click');
    expect(wrapper.findAll('.market-row__pair strong').map((n) => n.text())).toEqual(['DOGE']);
    expect(JSON.parse(localStorage.getItem('pulse:favorites')!)).toEqual(['DOGEUSDT']);
  });

  it('switches pairs with arrow keys', async () => {
    const wrapper = withMarket(Watchlist);
    await wrapper.find('.markets__viewport').trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(market.symbol.value).toBe('ETHUSDT');
  });
});

describe('PairHeader', () => {
  it('shows 24h stats and requests a new interval', async () => {
    const wrapper = withMarket(PairHeader, { indicators: { sma: true, ema: false } });
    expect(wrapper.find('h1').text()).toBe('BTC/USDT');
    expect(wrapper.text()).toContain('+2,56%');
    await wrapper.findAll('.segmented button').find((b) => b.text() === '4ч')!.trigger('click');
    expect(transport.sent.at(-1)).toEqual({ type: 'select', symbol: 'BTCUSDT', interval: '4h' });
  });
});

describe('TopBar', () => {
  it('explains demo mode and can retry the live feed', async () => {
    transport.emit({ type: 'status', status: { mode: 'demo', state: 'open', reason: 'Биржа не отвечает' } });
    const wrapper = withMarket(TopBar);
    await flushPromises();
    const status = wrapper.find('[role="status"]').text();
    expect(status).toContain('Демо-данные');
    expect(status).toContain('Биржа не отвечает');
    await wrapper.find('.link-button').trigger('click');
    expect(transport.sent.at(-1)).toEqual({ type: 'retry-live' });
  });
});

describe('OrderBook', () => {
  it('renders both sides with the spread', async () => {
    transport.emit(batch({ book: { symbol: 'BTCUSDT', asks: [[80001, 1], [80002, 2]], bids: [[80000, 3]] } }));
    const wrapper = withMarket(OrderBook);
    await flushPromises();
    expect(wrapper.findAll('.book__side--asks .book__row')).toHaveLength(2);
    expect(wrapper.findAll('.book__side--bids .book__row')).toHaveLength(1);
    expect(wrapper.text()).toContain('спред 1,00');
  });

  it('ignores a book for another symbol', () => {
    transport.emit(batch({ book: { symbol: 'ETHUSDT', asks: [], bids: [] } }));
    expect(withMarket(OrderBook).text()).toContain('Ожидание стакана');
  });
});
