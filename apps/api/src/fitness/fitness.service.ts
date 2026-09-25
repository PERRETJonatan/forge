import type {
  AthleteThresholds,
  Discipline,
  DisciplineVolume,
  FitnessDashboard,
  FitnessWeek,
  WorkoutStep,
} from "@forge/shared";
import { prisma } from "../db.js";
import {
  actualTss,
  addDays,
  dateKey,
  daysBetween,
  plannedTss,
  rollLoad,
  weekStart,
  type TssWorkout,
} from "./fitness-model.js";

const DISCIPLINES: Discipline[] = ["SWIM", "BIKE", "RUN", "STRENGTH", "OTHER"];

function emptyVolume(): Record<Discipline, DisciplineVolume> {
  return Object.fromEntries(DISCIPLINES.map((d) => [d, { durationSec: 0, distanceM: 0 }])) as Record<
    Discipline,
    DisciplineVolume
  >;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function addTo(map: Map<string, number>, key: string, value: number): void {
  if (value > 0) map.set(key, (map.get(key) ?? 0) + value);
}

export interface DashboardRange {
  from: string;
  to: string;
  today: string;
}

/**
 * Builds the whole dashboard from the athlete's full workout history on every request -- the
 * CTL/ATL recurrence can't be reconstructed for one day in isolation, so any change (a late
 * Strava sync, a threshold edit, an edited workout) must reroll the whole series anyway (see
 * SPEC.md, Formulas). Computing on read gets that for free; a precomputed `fitness_snapshot`
 * table is only worth adding once history is large enough for this to be slow.
 */
export async function getDashboard(athleteId: string, range: DashboardRange): Promise<FitnessDashboard> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId } });
  const thresholds: AthleteThresholds = {
    ftpWatts: athlete.ftpWatts,
    runThresholdPaceSecPerKm: athlete.runThresholdPaceSecPerKm,
    swimThresholdPaceSec100m: athlete.swimThresholdPaceSec100m,
    thresholdHr: athlete.thresholdHr,
  };

  const workouts = await prisma.workout.findMany({
    where: { athleteId },
    include: { stravaActivity: { select: { avgWatts: true, avgHr: true, avgSpeedMps: true } } },
    orderBy: { date: "asc" },
  });

  const actualByDay = new Map<string, number>();
  const plannedByDay = new Map<string, number>();
  const weeks = new Map<string, FitnessWeek>();
  const firstWeek = weekStart(range.from);
  const lastWeek = weekStart(range.to);
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    weeks.set(week, { weekStart: week, plannedTss: 0, actualTss: 0, volume: emptyVolume() });
  }

  for (const w of workouts) {
    const day = dateKey(w.date);
    const tssWorkout: TssWorkout = {
      discipline: w.discipline,
      source: w.source,
      completed: w.completed,
      targetDurationSec: w.targetDurationSec,
      actualDurationSec: w.actualDurationSec,
      structuredIntervals: w.structuredIntervals as WorkoutStep[] | null,
      activity: w.stravaActivity,
    };
    const actual = actualTss(tssWorkout, thresholds);
    const planned = plannedTss(tssWorkout, thresholds);
    addTo(actualByDay, day, actual);
    addTo(plannedByDay, day, planned);

    const week = weeks.get(weekStart(day));
    if (!week) continue;
    week.actualTss += actual;
    week.plannedTss += planned;
    if (w.completed) {
      const volume = week.volume[w.discipline];
      volume.durationSec += w.actualDurationSec ?? w.targetDurationSec ?? 0;
      volume.distanceM += w.actualDistanceM ?? w.targetDistanceM ?? 0;
    }
  }

  // Past (and today) roll what was actually done; the future rolls what's on the calendar,
  // so the chart shows where the plan takes fitness and form -- e.g. into a race-week taper.
  const tssByDay = new Map<string, number>();
  for (const [day, tss] of actualByDay) if (day <= range.today) tssByDay.set(day, tss);
  for (const [day, tss] of plannedByDay) if (day > range.today) tssByDay.set(day, tss);

  const firstDay = workouts.length > 0 ? dateKey(workouts[0].date) : range.from;
  const start = firstDay < range.from ? firstDay : range.from;
  const end = range.to > range.today ? range.to : range.today;
  const load = rollLoad(tssByDay, start, end);

  const todayLoad = load[daysBetween(start, range.today)];
  const missingThresholds = (Object.keys(thresholds) as (keyof AthleteThresholds)[]).filter(
    (key) => thresholds[key] == null,
  );

  return {
    today: range.today,
    current: { ctl: round1(todayLoad.ctl), atl: round1(todayLoad.atl), tsb: round1(todayLoad.tsb) },
    series: load
      .filter((d) => d.date >= range.from && d.date <= range.to)
      .map((d) => ({
        date: d.date,
        tss: round1(d.tss),
        ctl: round1(d.ctl),
        atl: round1(d.atl),
        tsb: round1(d.tsb),
        projected: d.date > range.today,
      })),
    weeks: [...weeks.values()].map((w) => ({
      ...w,
      plannedTss: round1(w.plannedTss),
      actualTss: round1(w.actualTss),
    })),
    race: {
      raceName: athlete.raceName,
      raceDate: athlete.raceDate ? dateKey(athlete.raceDate) : null,
    },
    missingThresholds,
  };
}
