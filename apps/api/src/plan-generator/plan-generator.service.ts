import { TYPICAL_PEAK_HOURS, type PlanApplyResult, type PlanGenerationRequest, type PlanGeneratorDefaults, type PlanPreview, type RaceDistance } from "@forge/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { dateKey, daysBetween, weekStart } from "../fitness/fitness-model.js";
import { getDashboard } from "../fitness/fitness.service.js";
import { toDate } from "../workouts/workout.service.js";
import { generatePlan, startingHoursFromCtl, swimBikeShare, TSS_PER_HOUR, type ExternalSession } from "./plan-generator.js";
import type { SessionKind } from "./workout-library.js";

export class PlanGeneratorError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * The generated session a Runna workout stands in for, from its plan-day id
 * ("…_plan_week_3_LONG_RUN_0"): what the generator should keep the long ride and hard rides away from.
 */
function runnaSessionKind(workout: { discipline: string; externalId: string | null }): SessionKind {
  if (workout.discipline === "STRENGTH") return "STRENGTH_A";
  const id = workout.externalId ?? "";
  if (/_LONG_RUN_/.test(id)) return "LONG_RUN";
  if (/_(INTERVALS|TEMPO|TIME_TRIAL|RACE|TAPER_INTERVALS|HILLS|FARTLEK)_/.test(id)) return "RUN_QUALITY";
  return "RUN_EASY";
}

const MIN_WEEKS = 2;
const MAX_WEEKS = 52;

/**
 * Everything the generator needs from the database, computed the same way for preview and
 * apply so applying writes exactly the plan that was previewed.
 */
async function prepare(athleteId: string, request: PlanGenerationRequest, today: string): Promise<PlanPreview> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId } });
  if (!athlete.raceDate) {
    throw new PlanGeneratorError("Set your target race in Settings before generating a plan", 400);
  }
  const raceDate = dateKey(athlete.raceDate);
  const weeks = daysBetween(request.startDate, raceDate) / 7;
  if (request.startDate < today) {
    throw new PlanGeneratorError("The plan can't start in the past", 400);
  }
  if (weeks < MIN_WEEKS || weeks > MAX_WEEKS) {
    throw new PlanGeneratorError(
      `Your race must be between ${MIN_WEEKS} and ${MAX_WEEKS} weeks after the plan's start date`,
      400,
    );
  }

  const { current } = await getDashboard(athleteId, { from: today, to: today, today });
  const startingHours = startingHoursFromCtl(current.ctl, request.maxWeeklyHours);

  const runningFromRunna = request.runningFromRunna ?? false;
  if (runningFromRunna && !athlete.runnaFeedUrl) {
    throw new PlanGeneratorError("Connect your Runna plan in Settings first", 400);
  }

  // A previous generated plan's unfinished workouts get replaced; anything else on the
  // calendar (hand-built, imported, or already completed) is kept, and its day left alone --
  // except, when running comes from Runna, a day holding only upcoming Runna workouts: the
  // generator plans around those itself.
  const existing = await prisma.workout.findMany({
    where: { athleteId, date: { gte: toDate(request.startDate) } },
    select: { date: true, source: true, completed: true, discipline: true, externalId: true, targetDurationSec: true },
  });
  const isRunna = (w: (typeof existing)[number]) => runningFromRunna && w.source === "RUNNA" && !w.completed;
  const replaceable = existing.filter((w) => w.source === "GENERATED" && !w.completed);
  const keptDates = [
    ...new Set(
      existing.filter((w) => (w.source !== "GENERATED" || w.completed) && !isRunna(w)).map((w) => dateKey(w.date)),
    ),
  ].sort();
  const runnaSessions: ExternalSession[] = existing.filter(isRunna).map((w) => ({
    date: dateKey(w.date),
    kind: runnaSessionKind(w),
    durationSec: w.targetDurationSec ?? 0,
  }));

  const weekPlans = generatePlan({
    startDate: request.startDate,
    raceDate,
    distance: request.raceDistance,
    maxWeeklyHours: request.maxWeeklyHours,
    startingHours,
    trainingDays: request.trainingDays,
    longRideDay: request.longRideDay,
    longRunDay: request.longRunDay,
    strengthSessionsPerWeek: request.strengthSessionsPerWeek,
    blockedDates: new Set(keptDates),
    runningFromRunna,
    runnaSessions,
  });

  return {
    raceName: athlete.raceName,
    raceDate,
    startingHours: Math.round(startingHours * 10) / 10,
    weeks: weekPlans,
    replacesCount: replaceable.length,
    keptDates: keptDates.filter((d) => d < raceDate),
  };
}

const DISTANCES: RaceDistance[] = ["SPRINT", "OLYMPIC", "HALF", "FULL"];

function roundToHalf(hours: number): number {
  return Math.round(hours * 2) / 2;
}

/**
 * Pre-fills for the generator form, so "Peak week" is a suggestion rather than a guess:
 * the middle of the usual range for the distance, raised to 25% above current training, and --
 * with running from Runna -- raised so swim and bike keep their usual share on top of Runna's
 * biggest week.
 */
export async function getDefaults(athleteId: string, today: string): Promise<PlanGeneratorDefaults> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId }, select: { runnaFeedUrl: true } });
  const { current } = await getDashboard(athleteId, { from: today, to: today, today });
  const currentWeeklyHours = Math.round(((current.ctl * 7) / TSS_PER_HOUR) * 10) / 10;

  const runna = athlete.runnaFeedUrl
    ? await prisma.workout.findMany({
        where: { athleteId, source: "RUNNA", completed: false, date: { gte: toDate(today) } },
        select: { date: true, targetDurationSec: true },
      })
    : [];
  const weekHours = new Map<string, number>();
  for (const w of runna) {
    const week = weekStart(dateKey(w.date));
    weekHours.set(week, (weekHours.get(week) ?? 0) + (w.targetDurationSec ?? 0) / 3600);
  }
  const runnaPeakWeekHours = runna.length ? Math.round(Math.max(...weekHours.values()) * 10) / 10 : null;
  const runnaPlanEnd = runna.length ? dateKey(new Date(Math.max(...runna.map((w) => w.date.getTime())))) : null;

  const clamp = (h: number) => Math.min(30, Math.max(3, roundToHalf(h)));
  const suggestedPeakHours = Object.fromEntries(
    DISTANCES.map((d) => {
      const [low, high] = TYPICAL_PEAK_HOURS[d];
      const typical = (low + high) / 2;
      const planned = clamp(Math.max(typical, currentWeeklyHours * 1.25));
      const withRunna =
        runnaPeakWeekHours == null ? null : clamp(Math.max(planned, runnaPeakWeekHours + typical * swimBikeShare(d)));
      return [d, { planned, withRunna }];
    }),
  ) as PlanGeneratorDefaults["suggestedPeakHours"];

  return { currentWeeklyHours, suggestedPeakHours, runnaPlanEnd, runnaPeakWeekHours };
}

export async function previewPlan(athleteId: string, request: PlanGenerationRequest, today: string): Promise<PlanPreview> {
  return prepare(athleteId, request, today);
}

export async function applyPlan(athleteId: string, request: PlanGenerationRequest, today: string): Promise<PlanApplyResult> {
  const preview = await prepare(athleteId, request, today);
  const workouts = preview.weeks.flatMap((w) => w.workouts);

  const [deleted, created] = await prisma.$transaction([
    prisma.workout.deleteMany({
      where: { athleteId, source: "GENERATED", completed: false, date: { gte: toDate(request.startDate) } },
    }),
    prisma.workout.createMany({
      data: workouts.map((w) => ({
        athleteId,
        source: "GENERATED" as const,
        discipline: w.discipline,
        date: toDate(w.date),
        title: w.title,
        notes: w.notes,
        targetDurationSec: w.targetDurationSec,
        structuredIntervals: w.structuredIntervals as unknown as Prisma.InputJsonValue,
      })),
    }),
  ]);
  return { created: created.count, deleted: deleted.count };
}
