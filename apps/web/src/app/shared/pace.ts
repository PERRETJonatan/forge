/** Formats a pace in seconds (per km or per 100m) as "mm:ss" for display/editing. */
export function formatPace(totalSec: number | null): string {
  if (totalSec == null) return '';
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.round(totalSec % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Parses an "mm:ss" (or plain seconds) input back into seconds. Returns null if unparseable. */
export function parsePace(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (match) {
    return Number(match[1]) * 60 + Number(match[2]);
  }
  const seconds = Number(trimmed);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}
