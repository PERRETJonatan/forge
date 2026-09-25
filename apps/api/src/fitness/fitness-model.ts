import { DEFAULT_UNTARGETED_IF, summarizeSteps, type AthleteThresholds, type WorkoutStep } from "@forge/shared";
import type { Discipline, WorkoutSource } from "@prisma/client";

/**
 * Pure Performance Management model (see SPEC.md, Formulas): per-workout TSS, then the
 * CTL/ATL/TSB recurrence over the calendar. Kept free of Prisma/Express so the math is unit
 * testable on its own; fitness.service.ts feeds it the athlete's workouts.
 */

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

/** Guards the chart against a junk Strava average (e.g. a GPS glitch on a swim) -- well above
 * anything sustainable for more than a few minutes. */
const MAX_IF = 1.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Summary metrics from a matched Strava activity -- no streams in v1, so averages only. */
export interface ActivityMetrics {
  avgWatts: number | null;
  avgHr: number | null;
  avgSpeedMps: number | null;
}

export interface TssWorkout {
  discipline: Discipline;
  source: WorkoutSource;
  completed: boolean;
  targetDurationSec: number | null;
  actualDurationSec: number | null;
  structuredIntervals: WorkoutStep[] | null;
  activity: ActivityMetrics | null;
}

function clampIf(intensityFactor: number): number {
  return Math.min(MAX_IF, Math.max(0, intensityFactor));
}

function tssFor(durationSec: number, intensityFactor: number): number {
  return clampIf(intensityFactor) ** 2 * (durationSec / 3600) * 100;
}

/**
 * IF from what was actually recorded, per the SPEC's per-discipline basis: power for the bike,
 * pace for run/swim, HR as the fallback for any discipline. Uses Strava's whole-activity
 * averages -- average power understates Normalized Power for variable efforts, so bike TSS
 * reads a little low until streams land.
 */
export function measuredIntensityFactor(
  discipline: Discipline,
  activity: ActivityMetrics | null,
  thresholds: AthleteThresholds,
): number | null {
  if (!activity) return null;
  if (discipline === "BIKE" && activity.avgWatts && thresholds.ftpWatts) {
    return activity.avgWatts / thresholds.ftpWatts;
  }
  if (discipline === "RUN" && activity.avgSpeedMps && thresholds.runThresholdPaceSecPerKm) {
    // Actual pace in sec/km is 1000 / speed; IF is threshold pace over actual pace.
    return (thresholds.runThresholdPaceSecPerKm * activity.avgSpeedMps) / 1000;
  }
  if (discipline === "SWIM" && activity.avgSpeedMps && thresholds.swimThresholdPaceSec100m) {
    return (thresholds.swimThresholdPaceSec100m * activity.avgSpeedMps) / 100;
  }
  if (activity.avgHr && thresholds.thresholdHr) {
    return activity.avgHr / thresholds.thresholdHr;
  }
  return null;
}

/** IF implied by a structured workout's step targets, or null if it has no timed steps. */
function plannedIntensityFactor(steps: WorkoutStep[] | null, thresholds: AthleteThresholds): number | null {
  if (!steps || steps.length === 0) return null;
  const summary = summarizeSteps(steps, thresholds);
  if (summary.durationSec <= 0) return null;
  // TSS = IF^2 x hours x 100, solved for IF.
  return Math.sqrt((summary.estimatedTss * 36) / summary.durationSec);
}

function plannedDurationSec(workout: TssWorkout, thresholds: AthleteThresholds): number | null {
  if (workout.targetDurationSec) return workout.targetDurationSec;
  if (workout.structuredIntervals?.length) {
    const summary = summarizeSteps(workout.structuredIntervals, thresholds);
    if (summary.durationSec > 0) return summary.durationSec;
  }
  return null;
}

/**
 * TSS for a completed workout: actual duration (falling back to the planned one when only
 * "completed" was ticked) at the best available IF -- measured from Strava, else implied by
 * the planned steps, else an easy-effort default. Zero for anything not completed.
 */
export function actualTss(workout: TssWorkout, thresholds: AthleteThresholds): number {
  if (!workout.completed) return 0;
  const durationSec = workout.actualDurationSec ?? plannedDurationSec(workout, thresholds);
  if (!durationSec) return 0;
  const intensityFactor =
    measuredIntensityFactor(workout.discipline, workout.activity, thresholds) ??
    plannedIntensityFactor(workout.structuredIntervals, thresholds) ??
    DEFAULT_UNTARGETED_IF;
  return tssFor(durationSec, intensityFactor);
}

/**
 * TSS the plan called for, same estimate as the program builder's live TSS. Zero for a
 * workout that only exists because Strava recorded it -- nothing was planned.
 */
export function plannedTss(workout: TssWorkout, thresholds: AthleteThresholds): number {
  if (workout.source === "STRAVA") return 0;
  const durationSec = plannedDurationSec(workout, thresholds);
  if (!durationSec) return 0;
  const intensityFactor = plannedIntensityFactor(workout.structuredIntervals, thresholds) ?? DEFAULT_UNTARGETED_IF;
  return tssFor(durationSec, intensityFactor);
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(key: string, delta: number): string {
  return dateKey(new Date(Date.parse(`${key}T00:00:00.000Z`) + delta * DAY_MS));
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00.000Z`) - Date.parse(`${fromKey}T00:00:00.000Z`)) / DAY_MS);
}

/** Monday of the week containing the given date. */
export function weekStart(key: string): string {
  const weekday = (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  return addDays(key, -weekday);
}

export interface LoadDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

/**
 * Rolls CTL/ATL/TSB over every calendar day from `start` to `end` inclusive, seeded at 0.
 * Days missing from `tssByDay` are rest days (TSS 0) and still advance the recurrence --
 * it's a rolling average over the calendar, not over workout days.
 */
export function rollLoad(tssByDay: Map<string, number>, start: string, end: string): LoadDay[] {
  const days: LoadDay[] = [];
  let ctl = 0;
  let atl = 0;
  const count = daysBetween(start, end);
  for (let i = 0; i <= count; i++) {
    const date = addDays(start, i);
    const tss = tssByDay.get(date) ?? 0;
    // Form is yesterday's fitness minus yesterday's fatigue: it's how fresh you are
    // coming into the day, before today's training lands.
    const tsb = ctl - atl;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    days.push({ date, tss, ctl, atl, tsb });
  }
  return days;
}
