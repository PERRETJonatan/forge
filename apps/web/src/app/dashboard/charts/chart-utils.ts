/** Round "nice" tick values (1/2/5 x 10^n steps) covering [min, max], always including 0. */
export function niceTicks(min: number, max: number, targetCount = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi - lo === 0) return [0, 1];
  const rawStep = (hi - lo) / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-21" -> "Sep 21" (date-only keys, no timezone involved). */
export function shortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** A column with a 4px rounded data-end and a square baseline (see the dataviz mark specs). */
export function roundedTopBar(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}

/** Every k-th index, so at most `max` x-axis labels are drawn and they don't collide. */
export function labelStride(count: number, max: number): number {
  return Math.max(1, Math.ceil(count / max));
}
