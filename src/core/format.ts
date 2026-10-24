/**
 * Decimals for a price so that it keeps ~5–6 significant digits:
 * 79 656.34 → 2, 3.1416 → 4, 0.000012345 → 9.
 */
export function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  const leadingZeros = Math.floor(-Math.log10(abs));
  return Math.min(leadingZeros + 5, 10);
}

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, options: Intl.NumberFormatOptions) {
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat('ru-RU', options);
    cache.set(key, format);
  }
  return format;
}

export function formatPrice(price: number, decimals = priceDecimals(price)): string {
  return nf(`p${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(price);
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${nf('pct', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value))}%`;
}

/** 1 234 567 890 → «1,23 млрд» */
export function formatCompact(value: number): string {
  return nf('compact', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatQty(qty: number): string {
  const decimals = qty >= 1000 ? 0 : qty >= 1 ? 3 : 5;
  return nf(`q${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(qty);
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const formatTime = (time: number) => timeFormat.format(time);
