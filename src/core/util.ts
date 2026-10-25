export function backoffDelay(attempt: number, random: () => number = Math.random, base = 1000, max = 30_000): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function virtualRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start: first, end: Math.max(first, last), offset: first * rowHeight, total: count * rowHeight };
}
