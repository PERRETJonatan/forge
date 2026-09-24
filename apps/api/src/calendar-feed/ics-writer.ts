import type { Workout } from "@prisma/client";

/**
 * Minimal RFC 5545 ICS writer for the read-only calendar feed. Workouts are
 * date-only (no time-of-day), so every event is an all-day VEVENT.
 */

const CRLF = "\r\n";

/** Fold lines longer than 75 octets per RFC 5545 (continuation lines start with a space). */
function foldLine(line: string): string {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes <= 75) return line;

  const chunks: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const limit = first ? 75 : 74;
    // Chunk by UTF-16 code units is close enough for this app's plain-ASCII titles/notes;
    // multi-byte characters could split a line slightly early, which is still valid ICS.
    const chunk = rest.slice(0, limit);
    chunks.push((first ? "" : " ") + chunk);
    rest = rest.slice(limit);
    first = false;
  }
  return chunks.join(CRLF);
}

/** Escape text per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dateStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** VALUE=DATE format (YYYYMMDD) for the all-day workout date. */
function dayString(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

const DISCIPLINE_LABEL: Record<string, string> = {
  SWIM: "Swim",
  BIKE: "Bike",
  RUN: "Run",
  STRENGTH: "Strength",
  OTHER: "Workout",
};

function summaryFor(workout: Workout): string {
  const label = DISCIPLINE_LABEL[workout.discipline] ?? "Workout";
  const status = workout.completed ? "" : " (planned)";
  return workout.title ? `${label}: ${workout.title}${status}` : `${label}${status}`;
}

function descriptionFor(workout: Workout): string | null {
  const lines: string[] = [];
  if (workout.targetDurationSec) lines.push(`Target duration: ${Math.round(workout.targetDurationSec / 60)} min`);
  if (workout.targetDistanceM) lines.push(`Target distance: ${(workout.targetDistanceM / 1000).toFixed(1)} km`);
  if (workout.targetIntensity) lines.push(`Target intensity: ${workout.targetIntensity}`);
  if (workout.completed) {
    if (workout.actualDurationSec) lines.push(`Actual duration: ${Math.round(workout.actualDurationSec / 60)} min`);
    if (workout.actualDistanceM) lines.push(`Actual distance: ${(workout.actualDistanceM / 1000).toFixed(1)} km`);
    if (workout.actualIntensity) lines.push(`Actual intensity: ${workout.actualIntensity}`);
  }
  if (workout.notes) lines.push("", workout.notes);
  return lines.length > 0 ? lines.join("\n") : null;
}

function eventFor(workout: Workout, feedHost: string): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${workout.id}@${feedHost}`,
    `DTSTAMP:${dateStamp(workout.updatedAt)}`,
    `DTSTART;VALUE=DATE:${dayString(workout.date)}`,
    `DTEND;VALUE=DATE:${dayString(addDays(workout.date, 1))}`,
    `SUMMARY:${escapeText(summaryFor(workout))}`,
    `STATUS:${workout.completed ? "CONFIRMED" : "TENTATIVE"}`,
  ];
  const description = descriptionFor(workout);
  if (description) {
    lines.push(`DESCRIPTION:${escapeText(description)}`);
  }
  lines.push("END:VEVENT");
  return lines.map(foldLine).join(CRLF);
}

/** Build a full VCALENDAR document for one athlete's workouts. */
export function buildIcsFeed(workouts: Workout[], feedHost: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Forge//Training Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Forge training plan",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...workouts.map((w) => eventFor(w, feedHost)),
    "END:VCALENDAR",
  ];
  return lines.join(CRLF) + CRLF;
}
