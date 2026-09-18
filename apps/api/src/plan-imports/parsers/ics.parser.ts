import ical from "node-ical";
import type { VEvent } from "node-ical";
import { inferDiscipline, type ParsedWorkout } from "../parsed-workout.js";

function textValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "val" in (value as Record<string, unknown>)) {
    return String((value as { val: unknown }).val);
  }
  return String(value);
}

// node-ical constructs both timed and DATE-only (full-day) values as local
// Date objects (a DATE-only value becomes local midnight), so the calendar
// date is always read with local getters — never UTC ones.
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseIcs(buffer: Buffer): ParsedWorkout[] {
  const parsed = ical.sync.parseICS(buffer.toString("utf-8"));
  const workouts: ParsedWorkout[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const event = component as VEvent;
    if (!event.start) continue;

    const summary = textValue(event.summary);
    const description = textValue(event.description);
    const categories = event.categories?.join(" ");
    const discipline = inferDiscipline(summary, categories, description);

    let durationSec: number | undefined;
    if (event.end) {
      durationSec = Math.round((event.end.getTime() - event.start.getTime()) / 1000);
    }

    workouts.push({
      date: toDateKey(event.start),
      discipline,
      title: summary,
      notes: description,
      targetDurationSec: durationSec,
    });
  }

  return workouts;
}
