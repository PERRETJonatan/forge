/** Formats a pace in seconds (per km or per 100m) as "mm:ss" for display/editing. */
export function formatPace(totalSec: number | null): string {
  if (totalSec == null) return '';
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.round(totalSec % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Parses an "mm:ss" (or whole plain seconds) input back into seconds. Returns null if unparseable.
 * Decimals are rejected rather than read as seconds: "5.45" is a mistyped 5:45, not 5 s. */
export function parsePace(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (match) {
    return Number(match[1]) * 60 + Number(match[2]);
  }
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return seconds > 0 ? seconds : null;
}
