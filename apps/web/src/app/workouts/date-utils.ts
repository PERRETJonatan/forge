export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

/** 6 full weeks (Mon-Sun) covering the given month, including lead/trail days. */
export function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const startWeekday = (first.getDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(first, -startWeekday);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}
