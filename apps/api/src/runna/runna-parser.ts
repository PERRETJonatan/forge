import ical from "node-ical";
import type { VEvent } from "node-ical";
import type { Discipline, WorkoutStep } from "@forge/shared";
import { inferDiscipline } from "../plan-imports/parsed-workout.js";

/**
 * Parses a Runna calendar feed (the iCal link from Runna -> Connected Apps & Devices ->
 * Calendar Syncing) into Forge workouts.
 *
 * Only upcoming plan workouts are taken (UID `UPCOMING_PLAN_WORKOUT-<dayId>`): the feed also
 * lists completed runs, but those reach Forge through Strava, which Runna uploads to.
 *
 * Runna writes each workout's steps as prose in the description, e.g.
 *
 *   Intervals • 6.5km • 45m - 50m
 *
 *   2km warm up at a conversational pace (no faster than 6:55/km), 90s walking rest
 *
 *   3 reps of:
 *   • 1km at 5:55/km (5:45-6:05/km), 90s walking rest
 *
 *   1.5km cool down at a conversational pace (or slower!)
 *
 * and strength sessions as "3 sets of:" followed by bulleted exercises. Lines the parser
 * doesn't recognise are skipped -- the full description is kept as the workout's notes.
 */

export interface RunnaWorkout {
  /** Runna's plan-day id: stable while the workout stays in the plan, even if it's moved. */
  externalId: string;
  date: string;
  discipline: Discipline;
  title: string;
  notes: string | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  structuredIntervals: WorkoutStep[] | null;
}

const UPCOMING_PREFIX = "UPCOMING_PLAN_WORKOUT-";
const APP_LINK = "📲";
/** Walking is well below any running threshold; RPE keeps it from counting as easy running. */
const WALK_RPE = 2;

function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "val" in (value as Record<string, unknown>)) {
    return String((value as { val: unknown }).val);
  }
  return String(value);
}

// node-ical builds a DATE-only DTSTART as local midnight, so the day is read with local getters.
function dateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** "6:55" -> 415 seconds. */
function paceSec(mmss: string): number {
  const [m, s] = mmss.split(":").map(Number);
  return m * 60 + s;
}

/** "45m", "1h0m", "2h10m" -> seconds. */
function durationSec(value: string): number | null {
  const match = /^(?:(\d+)h)?(\d+)m$/.exec(value.trim());
  if (!match) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2])) * 60;
}

interface Pace {
  low: number;
  high?: number;
}

/** The pace a line asks for: a range like "(5:45-6:05/km)" wins over the single "5:55/km". */
function paceIn(line: string): Pace | null {
  const range = /(\d+:\d{2})\s*-\s*(\d+:\d{2})\s*\/km/.exec(line);
  if (range) return { low: paceSec(range[1]), high: paceSec(range[2]) };
  const single = /(\d+:\d{2})\s*\/km/.exec(line);
  return single ? { low: paceSec(single[1]) } : null;
}

function walk(seconds: number, label: string): WorkoutStep {
  return { label, durationSec: seconds, targetLow: WALK_RPE, targetUnit: "rpe" };
}

/** "90s", "2 mins", "5 min" -> seconds. */
function amountSec(value: string, unit: string): number {
  return /^m/i.test(unit) ? Number(value) * 60 : Number(value);
}

function stepLabel(line: string, conversational: boolean): string {
  if (/warm[ -]?up/i.test(line)) return "Warm-up";
  if (/cool[ -]?down/i.test(line)) return "Cool-down";
  if (/time trial/i.test(line)) return "Time trial";
  if (/\brace\b/i.test(line)) return "Race";
  return conversational ? "Easy" : "Run";
}

/**
 * Turns one line ("2km at 6:40/km", "1km at 5:55/km (5:45-6:05/km), 90s walking rest",
 * "5 mins walking warm up") into its step, plus a walking rest step if the line ends with one.
 * `easyPace` is the workout's conversational-pace limit, used for "at a conversational pace"
 * lines that don't repeat it.
 */
function parseRunLine(line: string, easyPace: Pace | null): WorkoutStep[] {
  let main = line.replace(/^•\s*/, "");
  const steps: WorkoutStep[] = [];

  let rest: WorkoutStep | null = null;
  const restMatch = /,\s*(\d+)\s*(s|secs?|mins?)\s+walking(?:\s+rest)?\s*$/i.exec(main);
  if (restMatch) {
    rest = walk(amountSec(restMatch[1], restMatch[2]), "Walk");
    main = main.slice(0, restMatch.index);
  }

  const distance = /^(\d+(?:\.\d+)?)\s*(km|m)\b/i.exec(main);
  const time = distance ? null : /^(\d+)\s*(s|secs?|mins?)\b/i.exec(main);
  if (!distance && !time) return [];

  if (time && /walking/i.test(main)) {
    const label = /warm[ -]?up/i.test(main) ? "Walk warm-up" : /cool[ -]?down/i.test(main) ? "Walk cool-down" : "Walk";
    steps.push(walk(amountSec(time[1], time[2]), label));
  } else {
    const conversational = /conversational|easy/i.test(main);
    const pace = paceIn(main) ?? (conversational ? easyPace : null);
    const step: WorkoutStep = { label: stepLabel(main, conversational) };
    if (distance) {
      step.distanceM = Math.round(Number(distance[1]) * (distance[2].toLowerCase() === "km" ? 1000 : 1));
      // Timed from the target pace, so the step counts towards the workout's estimated load.
      const secPerKm = pace ? (pace.high != null ? (pace.low + pace.high) / 2 : pace.low) : null;
      if (secPerKm) step.durationSec = Math.round((step.distanceM / 1000) * secPerKm);
    } else if (time) {
      step.durationSec = amountSec(time[1], time[2]);
    }
    if (pace) {
      step.targetLow = pace.low;
      if (pace.high != null) step.targetHigh = pace.high;
      step.targetUnit = "pace_sec_per_km";
      step.targetMode = "absolute";
    }
    steps.push(step);
  }

  if (rest) steps.push(rest);
  return steps;
}

/** The first "no faster than X/km" in the workout: what "a conversational pace" means for it. */
function conversationalPace(lines: string[]): Pace | null {
  for (const line of lines) {
    const match = /no faster than (\d+:\d{2})\s*\/km/i.exec(line);
    if (match) return { low: paceSec(match[1]) };
  }
  return null;
}

function parseRunSteps(lines: string[]): WorkoutStep[] {
  const easyPace = conversationalPace(lines);
  const steps: WorkoutStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const reps = /^(\d+) reps of:$/i.exec(lines[i]);
    const block = /^Repeat the following (\d+)x:$/i.exec(lines[i]);
    if (reps) {
      // "N reps of:" owns the bulleted lines right after it.
      const inner: WorkoutStep[] = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith("•")) {
        inner.push(...parseRunLine(lines[++i], easyPace));
      }
      if (inner.length > 0) steps.push({ repeat: Number(reps[1]), steps: inner });
    } else if (block) {
      // "Repeat the following Nx:" owns the lines between two "----------" rules.
      const inner: WorkoutStep[] = [];
      if (i + 1 < lines.length && /^-{3,}$/.test(lines[i + 1])) i++;
      while (i + 1 < lines.length && !/^-{3,}$/.test(lines[i + 1])) {
        inner.push(...parseRunLine(lines[++i], easyPace));
      }
      i++; // the closing rule
      if (inner.length > 0) steps.push({ repeat: Number(block[1]), steps: inner });
    } else {
      steps.push(...parseRunLine(lines[i], easyPace));
    }
  }
  return steps;
}

/** Anything outside this is a misparse, not a pace -- better left untimed. */
const PLAUSIBLE_PACE = { min: 4 * 60, max: 12 * 60 };

/**
 * Distance steps with no pace at all ("8km at a conversational pace" in a plan that never gives
 * the limit) are timed from Runna's own estimate for the workout: the time the paced steps
 * don't use, spread over the unpaced distance. Without it they'd count no load.
 */
function timeUnpacedSteps(steps: WorkoutStep[], totalSec: number | null): void {
  if (!totalSec) return;
  let timedSec = 0;
  let unpacedM = 0;
  const unpaced: WorkoutStep[] = [];
  const walkTree = (list: WorkoutStep[], factor: number) => {
    for (const step of list) {
      if (step.repeat != null && step.steps) {
        walkTree(step.steps, factor * step.repeat);
      } else if (step.durationSec != null) {
        timedSec += step.durationSec * factor;
      } else if (step.distanceM != null) {
        unpacedM += step.distanceM * factor;
        unpaced.push(step);
      }
    }
  };
  walkTree(steps, 1);
  if (unpacedM === 0) return;
  const secPerKm = (totalSec - timedSec) / (unpacedM / 1000);
  if (secPerKm < PLAUSIBLE_PACE.min || secPerKm > PLAUSIBLE_PACE.max) return;
  for (const step of unpaced) step.durationSec = Math.round((step.distanceM! / 1000) * secPerKm);
}

/** "3 sets of:" + bulleted exercises -> a circuit of those exercises, one round per set. */
function parseStrengthSteps(lines: string[]): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const sets = /^(\d+) sets of:$/i.exec(lines[i]);
    if (!sets) continue;
    const exercises: WorkoutStep[] = [];
    while (i + 1 < lines.length && lines[i + 1].startsWith("•")) {
      exercises.push({ label: lines[++i].replace(/^•\s*/, "") });
    }
    if (exercises.length > 0) steps.push({ repeat: Number(sets[1]), steps: exercises });
  }
  return steps;
}

function disciplineOf(summary: string, description: string): Discipline {
  if (summary.startsWith("🏋")) return "STRENGTH";
  if (summary.startsWith("🏃")) return "RUN";
  return inferDiscipline(summary, description);
}

/** "🏃 1km Repeats • 6.5km" -> "1km Repeats". */
function titleOf(summary: string): string {
  return summary.split(" • ")[0].replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function parseEvent(event: VEvent): RunnaWorkout | null {
  const uid = text(event.uid) ?? "";
  if (!uid.startsWith(UPCOMING_PREFIX) || !event.start) return null;

  const summary = text(event.summary) ?? "";
  const description = (text(event.description) ?? "").replace(/\r\n/g, "\n");
  const discipline = disciplineOf(summary, description);

  // "Intervals • 6.5km • 45m - 50m": type, distance (runs only), Runna's time range.
  const [header = "", ...rest] = description.split("\n");
  const headerParts = header.split(" • ").map((p) => p.trim());
  const km = headerParts.map((p) => /^(\d+(?:\.\d+)?)km$/.exec(p)).find(Boolean);
  const range = headerParts.map((p) => /^(\S+)\s*-\s*(\S+)$/.exec(p)).find(Boolean);

  const estimated = Number((event as unknown as Record<string, unknown>)["WORKOUT-ESTIMATED-DURATION"]);
  let targetDurationSec = Number.isFinite(estimated) && estimated > 0 ? Math.round(estimated) : null;
  if (targetDurationSec == null && range) {
    const low = durationSec(range[1]);
    const high = durationSec(range[2]);
    if (low != null && high != null) targetDurationSec = Math.round((low + high) / 2);
  }

  const bodyLines = rest
    .join("\n")
    .split(APP_LINK)[0]
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let steps = discipline === "STRENGTH" ? parseStrengthSteps(bodyLines) : parseRunSteps(bodyLines);
  // A single-line workout Runna doesn't break down ("Half Marathon race at 6:10-6:30/km").
  if (steps.length === 0 && discipline === "RUN" && km) {
    steps = parseRunSteps([`${km[1]}km ${bodyLines[0] ?? ""}`]);
  }
  if (discipline === "RUN") timeUnpacedSteps(steps, targetDurationSec);

  return {
    externalId: uid.slice(UPCOMING_PREFIX.length),
    date: dateKey(event.start),
    discipline,
    title: titleOf(summary) || header || "Runna workout",
    notes: description.trim() || null,
    targetDurationSec,
    targetDistanceM: km ? Math.round(Number(km[1]) * 1000) : null,
    structuredIntervals: steps.length > 0 ? steps : null,
  };
}

export function parseRunnaFeed(ics: string): RunnaWorkout[] {
  const parsed = ical.sync.parseICS(ics);
  const workouts = new Map<string, RunnaWorkout>();
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const workout = parseEvent(component as VEvent);
    if (workout) workouts.set(workout.externalId, workout);
  }
  return [...workouts.values()].sort((a, b) => a.date.localeCompare(b.date));
}
