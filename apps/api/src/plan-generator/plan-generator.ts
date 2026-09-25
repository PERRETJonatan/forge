import {
  summarizeSteps,
  type AthleteThresholds,
  type GeneratedWeek,
  type GeneratedWorkout,
  type RaceDistance,
  type TrainingPhase,
  type Weekday,
} from "@forge/shared";
import { addDays, daysBetween, weekStart } from "../fitness/fitness-model.js";
import { buildSession, SESSION_DISCIPLINE, type SessionContext, type SessionKind } from "./workout-library.js";

/**
 * Rule-based periodized plan: phases counted back from race day, a 3:1 load/recovery rhythm,
 * weekly hours ramped from current fitness to the athlete's peak, and each week's hours split
 * into sessions placed on their available days. Pure and deterministic -- the same inputs
 * always give the same plan, so "apply" can regenerate exactly what was previewed.
 */

export interface GeneratorInput {
  startDate: string;
  raceDate: string;
  distance: RaceDistance;
  maxWeeklyHours: number;
  startingHours: number;
  trainingDays: Weekday[];
  longRideDay: Weekday;
  longRunDay: Weekday;
  /** Dates the generator must leave alone (an existing workout the athlete keeps). */
  blockedDates: Set<string>;
}

export interface WeekPlan {
  weekStart: string;
  phase: TrainingPhase;
  recovery: boolean;
  hours: number;
}

const TAPER_WEEKS: Record<RaceDistance, number> = { FULL: 2, HALF: 1, OLYMPIC: 1, SPRINT: 0 };
const PEAK_WEEKS: Record<RaceDistance, number> = { FULL: 3, HALF: 3, OLYMPIC: 2, SPRINT: 2 };
/** Taper hours as a fraction of peak, first taper week to last. */
const TAPER_FACTORS: Record<RaceDistance, number[]> = { FULL: [0.7, 0.5], HALF: [0.6], OLYMPIC: [0.6], SPRINT: [] };
/** Share of weekly hours per discipline -- the bike dominates as race distance grows. */
const SPLIT: Record<RaceDistance, { SWIM: number; BIKE: number; RUN: number }> = {
  FULL: { SWIM: 0.15, BIKE: 0.52, RUN: 0.33 },
  HALF: { SWIM: 0.17, BIKE: 0.48, RUN: 0.35 },
  OLYMPIC: { SWIM: 0.2, BIKE: 0.42, RUN: 0.38 },
  SPRINT: { SWIM: 0.2, BIKE: 0.4, RUN: 0.4 },
};
/** Share of a week's bike time that goes to the long ride. */
const LONG_RIDE_SHARE: Record<RaceDistance, number> = { FULL: 0.6, HALF: 0.55, OLYMPIC: 0.5, SPRINT: 0.5 };
const LONG_RUN_SHARE = 0.5;
const LONG_RIDE_CAP_H: Record<RaceDistance, number> = { FULL: 6, HALF: 3.5, OLYMPIC: 2.5, SPRINT: 1.5 };
const LONG_RUN_CAP_H: Record<RaceDistance, number> = { FULL: 2.75, HALF: 2, OLYMPIC: 1.25, SPRINT: 1 };

/** Never add more than this much week-on-week in a load week. */
const MAX_WEEKLY_RAMP = 1.1;
const RECOVERY_FACTOR = 0.65;
/** Average TSS per hour of mostly-aerobic triathlon training, to turn CTL into weekly hours. */
const TSS_PER_HOUR = 50;

const MIN = 60;
const HOUR = 3600;

/** Weekly hours the plan starts from: what current fitness (CTL) implies, within sane bounds. */
export function startingHoursFromCtl(ctl: number, maxWeeklyHours: number): number {
  const fromCtl = (ctl * 7) / TSS_PER_HOUR;
  return Math.min(maxWeeklyHours * 0.85, Math.max(maxWeeklyHours * 0.4, fromCtl));
}

function roundTo5Min(sec: number): number {
  return Math.round(sec / (5 * MIN)) * 5 * MIN;
}

/** Phase and hours for every week from the start date's week to race week. */
export function planWeeks(input: Omit<GeneratorInput, "trainingDays" | "longRideDay" | "longRunDay" | "blockedDates">): WeekPlan[] {
  const firstWeek = weekStart(input.startDate);
  const raceWeek = weekStart(addDays(input.raceDate, -1));
  const count = daysBetween(firstWeek, raceWeek) / 7 + 1;

  // Assign phases from race day backwards; when time is short the earliest phases give way.
  const phases: TrainingPhase[] = ["RACE"];
  const push = (phase: TrainingPhase, n: number) => {
    for (let i = 0; i < n && phases.length < count; i++) phases.unshift(phase);
  };
  push("TAPER", TAPER_WEEKS[input.distance]);
  push("PEAK", PEAK_WEEKS[input.distance]);
  const remaining = count - phases.length;
  const buildWeeks = Math.min(12, Math.round(remaining * 0.45));
  push("BUILD", buildWeeks);
  push("BASE", count - phases.length);

  const weeks: WeekPlan[] = [];
  let lastLoadHours = input.startingHours;
  let peakHours = input.startingHours;
  let loadIndex = 0;
  const loadWeekCount = phases.filter((p) => p === "BASE" || p === "BUILD").length;
  let taperIndex = 0;

  for (let i = 0; i < count; i++) {
    const phase = phases[i];
    const start = addDays(firstWeek, i * 7);
    let hours: number;
    let recovery = false;

    if (phase === "BASE" || phase === "BUILD") {
      // 3:1 -- every 4th base/build week backs off to absorb the three before it.
      recovery = loadIndex % 4 === 3;
      if (recovery) {
        hours = lastLoadHours * RECOVERY_FACTOR;
      } else {
        const progress = loadWeekCount > 0 ? loadIndex / loadWeekCount : 1;
        const target = input.startingHours + (input.maxWeeklyHours - input.startingHours) * progress;
        hours = i === 0 ? input.startingHours : Math.min(target, lastLoadHours * MAX_WEEKLY_RAMP);
        lastLoadHours = hours;
        peakHours = Math.max(peakHours, hours);
      }
      loadIndex++;
    } else if (phase === "PEAK") {
      hours = Math.min(input.maxWeeklyHours, lastLoadHours * MAX_WEEKLY_RAMP);
      lastLoadHours = hours;
      peakHours = Math.max(peakHours, hours);
    } else if (phase === "TAPER") {
      hours = peakHours * (TAPER_FACTORS[input.distance][taperIndex++] ?? 0.6);
    } else {
      hours = 0; // Race week is fixed openers, not an hours budget.
    }

    // A plan starting mid-week only gets the days it actually covers.
    if (i === 0) {
      const daysCovered = 7 - daysBetween(start, input.startDate);
      hours *= daysCovered / 7;
    }
    weeks.push({ weekStart: start, phase, recovery, hours });
  }
  return weeks;
}

interface Session {
  kind: SessionKind;
  durationSec: number;
  /** Preferred weekdays, best first. */
  prefer: Weekday[];
  /** Must land on the same day as this already-placed session (a brick). */
  sameDayAs?: SessionKind;
  /** Weekdays to avoid if at all possible (e.g. the long days, for quality sessions). */
  avoidKinds?: SessionKind[];
}

/** Sessions for one normal (non-race) week, with durations, in placement-priority order. */
function weekSessions(week: WeekPlan, input: GeneratorInput): Session[] {
  const split = SPLIT[input.distance];
  const bikeSec = week.hours * split.BIKE * HOUR;
  const runSec = week.hours * split.RUN * HOUR;
  const swimSec = week.hours * split.SWIM * HOUR;
  const hardWeek = !week.recovery && (week.phase === "BUILD" || week.phase === "PEAK");
  const longDays: SessionKind[] = ["LONG_RIDE", "LONG_RUN"];
  const sessions: Session[] = [];

  // Bike: long ride, then a quality session, then endurance with whatever is left. A leftover
  // too short to be worth a session folds back into the long ride (up to its cap).
  let longRideSec = Math.min(bikeSec * LONG_RIDE_SHARE[input.distance], LONG_RIDE_CAP_H[input.distance] * HOUR);
  const bikeQualitySec = Math.min(75 * MIN, bikeSec - longRideSec);
  let bikeEnduranceSec = Math.min(2.5 * HOUR, bikeSec - longRideSec - bikeQualitySec);
  if (bikeEnduranceSec < 30 * MIN) {
    longRideSec = Math.min(longRideSec + bikeEnduranceSec, LONG_RIDE_CAP_H[input.distance] * HOUR);
    bikeEnduranceSec = 0;
  }

  // Run: an optional brick off the long ride, a long run, a quality session, easy runs.
  const brickSec = hardWeek && input.distance !== "SPRINT" ? Math.min(30 * MIN, Math.max(15 * MIN, runSec * 0.1)) : 0;
  let longRunSec = Math.min((runSec - brickSec) * LONG_RUN_SHARE, LONG_RUN_CAP_H[input.distance] * HOUR);
  const restRunSec = runSec - brickSec - longRunSec;
  const runQualitySec = Math.min(60 * MIN, restRunSec);
  const easyRunTotal = restRunSec - runQualitySec;
  const easyRuns = easyRunTotal >= 80 * MIN ? 2 : easyRunTotal >= 25 * MIN ? 1 : 0;
  const runEasySec = easyRuns ? Math.min(75 * MIN, easyRunTotal / easyRuns) : 0;
  if (!easyRuns) longRunSec = Math.min(longRunSec + easyRunTotal, LONG_RUN_CAP_H[input.distance] * HOUR);

  // At least two swims: open-water fitness fades fast with only one a week.
  const swimCount = Math.max(2, Math.min(3, Math.round(swimSec / (45 * MIN))));
  const swimEachSec = Math.min(75 * MIN, Math.max(30 * MIN, swimSec / swimCount));
  const swimKinds: SessionKind[] = ["SWIM_QUALITY", "SWIM_TECHNIQUE", "SWIM_ENDURANCE"];

  sessions.push({ kind: "LONG_RIDE", durationSec: longRideSec, prefer: [input.longRideDay, 5, 6, 4, 3, 2, 1, 0] });
  if (brickSec) sessions.push({ kind: "BRICK_RUN", durationSec: brickSec, prefer: [], sameDayAs: "LONG_RIDE" });
  sessions.push({ kind: "LONG_RUN", durationSec: longRunSec, prefer: [input.longRunDay, 6, 5, 3, 2, 4, 1, 0], avoidKinds: ["LONG_RIDE"] });
  sessions.push({ kind: "BIKE_QUALITY", durationSec: bikeQualitySec, prefer: [1, 3, 2, 0, 4, 5, 6], avoidKinds: longDays });
  sessions.push({ kind: "RUN_QUALITY", durationSec: runQualitySec, prefer: [3, 1, 2, 4, 0, 5, 6], avoidKinds: [...longDays, "BIKE_QUALITY"] });
  sessions.push({ kind: swimKinds[0], durationSec: swimEachSec, prefer: [0, 2, 4, 1, 3, 5, 6], avoidKinds: longDays });
  if (swimCount >= 2) sessions.push({ kind: swimKinds[1], durationSec: swimEachSec, prefer: [2, 4, 0, 3, 1, 6, 5], avoidKinds: [...longDays, swimKinds[0]] });
  sessions.push({ kind: "BIKE_ENDURANCE", durationSec: bikeEnduranceSec, prefer: [2, 4, 0, 3, 6, 5, 1], avoidKinds: [...longDays, "BIKE_QUALITY"] });
  for (let i = 0; i < easyRuns; i++) {
    sessions.push({ kind: "RUN_EASY", durationSec: runEasySec, prefer: i === 0 ? [4, 0, 2, 1, 5, 6, 3] : [0, 2, 1, 5, 4, 6, 3], avoidKinds: ["LONG_RUN", "RUN_QUALITY", "LONG_RIDE"] });
  }
  if (swimCount >= 3) sessions.push({ kind: swimKinds[2], durationSec: swimEachSec, prefer: [4, 5, 1, 3, 0, 2, 6], avoidKinds: [swimKinds[0], swimKinds[1]] });

  // Anything still too short isn't worth a kit change -- drop it.
  return sessions
    .map((s) => ({ ...s, durationSec: roundTo5Min(s.durationSec) }))
    .filter((s) => s.durationSec >= (s.kind === "BRICK_RUN" ? 10 * MIN : 20 * MIN));
}

/** Openers early in race week; placeSessions keeps the day before the race free. Their
 * lengths are fixed by the workout library, so no duration budget here. */
const RACE_WEEK_SESSIONS: Session[] = [
  { kind: "BIKE_OPENER", durationSec: 0, prefer: [1, 2, 0, 3, 4] },
  { kind: "SWIM_OPENER", durationSec: 0, prefer: [0, 2, 3, 1, 4] },
  { kind: "RUN_OPENER", durationSec: 0, prefer: [2, 3, 1, 0, 4], avoidKinds: ["BIKE_OPENER"] },
];

/** Places a week's sessions on its available dates: at most two per day, one per discipline. */
function placeSessions(week: WeekPlan, sessions: Session[], input: GeneratorInput): { date: string; kind: SessionKind; durationSec: number }[] {
  const lastTrainingDay = addDays(input.raceDate, week.phase === "RACE" ? -2 : -1);
  const available = new Map<Weekday, string>();
  for (let d = 0; d < 7; d++) {
    const date = addDays(week.weekStart, d);
    if (date < input.startDate || date > lastTrainingDay) continue;
    if (!input.trainingDays.includes(d as Weekday) || input.blockedDates.has(date)) continue;
    available.set(d as Weekday, date);
  }

  const onDay = new Map<string, SessionKind[]>();
  const dateOf = new Map<SessionKind, string>();
  const placed: { date: string; kind: SessionKind; durationSec: number }[] = [];
  const fits = (date: string, kind: SessionKind) => {
    const kinds = onDay.get(date) ?? [];
    return kinds.length < 2 && !kinds.some((k) => SESSION_DISCIPLINE[k] === SESSION_DISCIPLINE[kind]);
  };

  for (const session of sessions) {
    let date: string | undefined;
    if (session.sameDayAs) {
      const anchor = dateOf.get(session.sameDayAs);
      date = anchor && fits(anchor, session.kind) ? anchor : undefined;
    } else {
      const avoid = new Set((session.avoidKinds ?? []).map((k) => dateOf.get(k)).filter((d): d is string => !!d));
      const order = [...session.prefer, ...([0, 1, 2, 3, 4, 5, 6] as Weekday[])];
      const candidates = order.map((d) => available.get(d)).filter((d): d is string => !!d);
      // Prefer an empty day, then any day that isn't one to avoid, then anything that fits.
      date =
        candidates.find((d) => !avoid.has(d) && !onDay.has(d)) ??
        candidates.find((d) => !avoid.has(d) && fits(d, session.kind)) ??
        candidates.find((d) => fits(d, session.kind));
    }
    if (!date) continue; // Not enough days this week -- lowest-priority sessions drop first.
    onDay.set(date, [...(onDay.get(date) ?? []), session.kind]);
    dateOf.set(session.kind, date);
    placed.push({ date, kind: session.kind, durationSec: session.durationSec });
  }
  return placed;
}

const PERCENT_ONLY: AthleteThresholds = {
  ftpWatts: null,
  runThresholdPaceSecPerKm: null,
  swimThresholdPaceSec100m: null,
  thresholdHr: null,
};

export function generatePlan(input: GeneratorInput): GeneratedWeek[] {
  return planWeeks(input).map((week) => {
    const ctx: SessionContext = { phase: week.phase, recovery: week.recovery, distance: input.distance };
    const sessions = week.phase === "RACE" ? RACE_WEEK_SESSIONS : weekSessions(week, input);
    const workouts: GeneratedWorkout[] = placeSessions(week, sessions, input)
      .map(({ date, kind, durationSec }) => {
        const plan = buildSession(kind, durationSec, ctx);
        // Every generated target is percent-of-threshold, so thresholds don't affect the estimate.
        const summary = summarizeSteps(plan.steps, PERCENT_ONLY);
        return {
          date,
          discipline: SESSION_DISCIPLINE[kind],
          title: plan.title,
          notes: plan.notes,
          targetDurationSec: summary.durationSec,
          structuredIntervals: plan.steps,
          estimatedTss: Math.round(summary.estimatedTss),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalSec = workouts.reduce((sum, w) => sum + w.targetDurationSec, 0);
    return {
      weekStart: week.weekStart,
      phase: week.phase,
      recovery: week.recovery,
      plannedHours: Math.round((totalSec / HOUR) * 10) / 10,
      plannedTss: workouts.reduce((sum, w) => sum + w.estimatedTss, 0),
      workouts,
    };
  });
}
