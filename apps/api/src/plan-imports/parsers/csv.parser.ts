import { parse } from "csv-parse/sync";
import type { Discipline } from "@forge/shared";
import { inferDiscipline, type ParsedWorkout } from "../parsed-workout.js";

export class CsvParseError extends Error {}

// TrainingPeaks doesn't publish one fixed CSV export schema, so this accepts
// a documented set of reasonable header spellings instead of guessing exact
// column names — see README's plan import section for the accepted headers.
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date", "workoutday", "workout day"],
  discipline: ["discipline", "sport", "workouttype", "workout type", "type"],
  title: ["title", "name", "workout title"],
  notes: ["notes", "description", "workoutdescription", "workout description", "comments", "coachcomments"],
  durationMin: ["durationmin", "duration (min)", "duration_min", "plannedduration"],
  durationHours: ["duration (h)", "durationhours", "duration_hours", "duration"],
  distanceKm: ["distancekm", "distance (km)", "distance_km"],
  distanceM: ["distancem", "distance (m)", "distanceinmeters", "distance_m"],
  intensity: ["intensity", "targetintensity", "target intensity", "zone"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function buildColumnMap(headers: string[]): Map<string, string> {
  const normalized = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const map = new Map<string, string>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const match = normalized.get(alias);
      if (match) {
        map.set(field, match);
        break;
      }
    }
  }
  return map;
}

function parseDiscipline(raw: string | undefined): Discipline {
  if (!raw) return "OTHER";
  return inferDiscipline(raw);
}

/** Parses "HH:MM:SS" or "H:MM" durations into seconds. */
function parseHmsDuration(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseDurationSec(row: Record<string, string>, columns: Map<string, string>): number | undefined {
  const hoursCol = columns.get("durationHours");
  if (hoursCol && row[hoursCol]) {
    const raw = row[hoursCol].trim();
    const hms = parseHmsDuration(raw);
    if (hms !== undefined) return hms;
    const hours = Number(raw);
    if (!Number.isNaN(hours)) return Math.round(hours * 3600);
  }
  const minCol = columns.get("durationMin");
  if (minCol && row[minCol]) {
    const minutes = Number(row[minCol]);
    if (!Number.isNaN(minutes)) return Math.round(minutes * 60);
  }
  return undefined;
}

function parseDistanceM(row: Record<string, string>, columns: Map<string, string>): number | undefined {
  const kmCol = columns.get("distanceKm");
  if (kmCol && row[kmCol]) {
    const km = Number(row[kmCol]);
    if (!Number.isNaN(km)) return km * 1000;
  }
  const mCol = columns.get("distanceM");
  if (mCol && row[mCol]) {
    const meters = Number(row[mCol]);
    if (!Number.isNaN(meters)) return meters;
  }
  return undefined;
}

function parseDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseCsv(buffer: Buffer): ParsedWorkout[] {
  const records: Record<string, string>[] = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  if (records.length === 0) return [];

  const columns = buildColumnMap(Object.keys(records[0]));
  if (!columns.has("date")) {
    throw new CsvParseError(
      "Could not find a date column. Expected a header like 'Date' or 'WorkoutDay'.",
    );
  }

  const workouts: ParsedWorkout[] = [];
  for (const row of records) {
    const dateCol = columns.get("date")!;
    const date = row[dateCol] ? parseDate(row[dateCol]) : undefined;
    if (!date) continue;

    workouts.push({
      date,
      discipline: parseDiscipline(columns.get("discipline") ? row[columns.get("discipline")!] : undefined),
      title: columns.get("title") ? row[columns.get("title")!] || undefined : undefined,
      notes: columns.get("notes") ? row[columns.get("notes")!] || undefined : undefined,
      targetDurationSec: parseDurationSec(row, columns),
      targetDistanceM: parseDistanceM(row, columns),
      targetIntensity: columns.get("intensity") ? row[columns.get("intensity")!] || undefined : undefined,
    });
  }
  return workouts;
}
