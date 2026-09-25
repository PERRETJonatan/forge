import type { PlanApplyResult, PlanGenerationRequest, PlanPreview } from "@forge/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { dateKey, daysBetween } from "../fitness/fitness-model.js";
import { getDashboard } from "../fitness/fitness.service.js";
import { toDate } from "../workouts/workout.service.js";
import { generatePlan, startingHoursFromCtl } from "./plan-generator.js";

export class PlanGeneratorError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
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

  // A previous generated plan's unfinished workouts get replaced; anything else on the
  // calendar (hand-built, imported, or already completed) is kept, and its day left alone.
  const existing = await prisma.workout.findMany({
    where: { athleteId, date: { gte: toDate(request.startDate) } },
    select: { date: true, source: true, completed: true },
  });
  const replaceable = existing.filter((w) => w.source === "GENERATED" && !w.completed);
  const keptDates = [
    ...new Set(existing.filter((w) => w.source !== "GENERATED" || w.completed).map((w) => dateKey(w.date))),
  ].sort();

  const weekPlans = generatePlan({
    startDate: request.startDate,
    raceDate,
    distance: request.raceDistance,
    maxWeeklyHours: request.maxWeeklyHours,
    startingHours,
    trainingDays: request.trainingDays,
    longRideDay: request.longRideDay,
    longRunDay: request.longRunDay,
    blockedDates: new Set(keptDates),
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
