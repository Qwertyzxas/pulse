<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatCompact, formatPercent, formatPrice } from '../core/format';
import { queryMarkets, type SortDir, type SortKey } from '../core/markets';
import { virtualRange } from '../core/util';
import { useMarket } from '../state/market';

const ROW_HEIGHT = 44;
const market = useMarket();

const search = ref('');
const favoritesOnly = ref(false);
const sort = ref<SortKey>('volume');
const dir = ref<SortDir>('desc');

const rows = computed(() =>
  queryMarkets(market.tickers.value.values(), {
    search: search.value,
    favoritesOnly: favoritesOnly.value,
    favorites: market.favorites.value,
    sort: sort.value,
    dir: dir.value,
  }),
);

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const height = ref(600);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) height.value = entry.contentRect.height;
  });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => observer?.disconnect());

const range = computed(() => virtualRange(scrollTop.value, height.value, ROW_HEIGHT, rows.value.length));
const visible = computed(() => rows.value.slice(range.value.start, range.value.end));

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'symbol', label: 'Пара' },
  { key: 'volume', label: 'Объём' },
  { key: 'price', label: 'Цена' },
  { key: 'change', label: '24ч' },
];

function setSort(key: SortKey) {
  if (sort.value === key) dir.value = dir.value === 'asc' ? 'desc' : 'asc';
  else {
    sort.value = key;
    dir.value = key === 'symbol' ? 'asc' : 'desc';
  }
}

const sortLabel = (key: SortKey, label: string) =>
  sort.value === key ? `${label}, ${dir.value === 'asc' ? 'по возрастанию' : 'по убыванию'}` : label;

async function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (!step || !rows.value.length) return;
  event.preventDefault();
  const index = rows.value.findIndex((t) => t.symbol === market.symbol.value);
  const next = rows.value[Math.min(Math.max(index + step, 0), rows.value.length - 1)]!;
  market.select(next.symbol);
  const el = viewport.value!;
  const position = rows.value.indexOf(next) * ROW_HEIGHT;
  if (position < el.scrollTop) el.scrollTop = position;
  else if (position + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = position + ROW_HEIGHT - el.clientHeight;
  await nextTick();
  viewport.value?.querySelector<HTMLElement>(`[data-symbol="${next.symbol}"]`)?.focus();
}
</script>

<template>
  <section class="panel markets" aria-labelledby="markets-title">
    <header class="panel__header">
      <h2 id="markets-title">Рынки</h2>
      <div class="tabs" role="group" aria-label="Список">
        <button type="button" :aria-pressed="!favoritesOnly" @click="favoritesOnly = false">Все</button>
        <button type="button" :aria-pressed="favoritesOnly" @click="favoritesOnly = true">★ Избранное</button>
      </div>
    </header>

    <label class="search">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      <input v-model="search" type="search" placeholder="Поиск пары" aria-label="Поиск пары" spellcheck="false" />
    </label>

    <div class="sortbar" role="group" aria-label="Сортировка">
      <button
        v-for="o in sortOptions"
        :key="o.key"
        type="button"
        :class="{ 'is-active': sort === o.key }"
        :aria-pressed="sort === o.key"
        :aria-label="sortLabel(o.key, o.label)"
        @click="setSort(o.key)"
      >
        {{ o.label }}<span v-if="sort === o.key" aria-hidden="true">{{ dir === 'asc' ? '↑' : '↓' }}</span>
      </button>
    </div>

    <div ref="viewport" class="markets__viewport" @scroll="scrollTop = ($event.target as HTMLElement).scrollTop" @keydown="onKeydown">
      <p v-if="!rows.length" class="empty">
        {{ market.tickers.value.size === 0 ? 'Загрузка рынков…' : favoritesOnly ? 'Отметьте пары звёздочкой' : 'Ничего не найдено' }}
      </p>
      <div :style="{ height: `${range.total}px` }" class="markets__spacer">
        <ul class="markets__list" :style="{ transform: `translateY(${range.offset}px)` }" role="list">
          <li v-for="t in visible" :key="t.symbol" class="market-row" :class="{ 'is-selected': t.symbol === market.symbol.value }">
            <button
              type="button"
              class="star"
              :aria-pressed="market.favorites.value.has(t.symbol)"
              :aria-label="`${t.base} в избранном`"
              @click="market.toggleFavorite(t.symbol)"
            >
              ★
            </button>
            <button
              type="button"
              class="market-row__main"
              :data-symbol="t.symbol"
              :aria-current="t.symbol === market.symbol.value ? 'true' : undefined"
              @click="market.select(t.symbol)"
            >
              <span class="market-row__pair">
                <strong>{{ t.base }}</strong><span class="muted">/{{ t.quote }}</span>
              </span>
              <span :key="t.updatedAt" class="num market-row__price" :class="t.tick > 0 ? 'flash-up' : t.tick < 0 ? 'flash-down' : ''">
                {{ formatPrice(t.price) }}
              </span>
              <span class="muted market-row__volume">{{ formatCompact(t.quoteVolume) }}</span>
              <span class="num market-row__change" :class="t.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(t.changePercent) }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
