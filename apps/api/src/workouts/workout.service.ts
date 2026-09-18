import type { Discipline, Workout } from "@prisma/client";
import { prisma } from "../db.js";

export class WorkoutError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface WorkoutInput {
  discipline: Discipline;
  date: string;
  title?: string | null;
  notes?: string | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetIntensity?: string | null;
  actualDurationSec?: number | null;
  actualDistanceM?: number | null;
  actualIntensity?: string | null;
  completed?: boolean;
}

export interface WorkoutFilter {
  from?: string;
  to?: string;
  discipline?: Discipline;
  completed?: boolean;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function listWorkouts(athleteId: string, filter: WorkoutFilter): Promise<Workout[]> {
  return prisma.workout.findMany({
    where: {
      athleteId,
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: toDate(filter.from) } : {}),
              ...(filter.to ? { lte: toDate(filter.to) } : {}),
            },
          }
        : {}),
      ...(filter.discipline ? { discipline: filter.discipline } : {}),
      ...(filter.completed !== undefined ? { completed: filter.completed } : {}),
    },
    orderBy: { date: "asc" },
  });
}

export async function getWorkout(athleteId: string, id: string): Promise<Workout> {
  const workout = await prisma.workout.findFirst({ where: { id, athleteId } });
  if (!workout) {
    throw new WorkoutError("Workout not found", 404);
  }
  return workout;
}

export async function createWorkout(athleteId: string, input: WorkoutInput): Promise<Workout> {
  return prisma.workout.create({
    data: {
      athleteId,
      source: "MANUAL",
      discipline: input.discipline,
      date: toDate(input.date),
      title: input.title ?? null,
      notes: input.notes ?? null,
      targetDurationSec: input.targetDurationSec ?? null,
      targetDistanceM: input.targetDistanceM ?? null,
      targetIntensity: input.targetIntensity ?? null,
      actualDurationSec: input.actualDurationSec ?? null,
      actualDistanceM: input.actualDistanceM ?? null,
      actualIntensity: input.actualIntensity ?? null,
      completed: input.completed ?? false,
    },
  });
}

export async function updateWorkout(
  athleteId: string,
  id: string,
  input: Partial<WorkoutInput>,
): Promise<Workout> {
  await getWorkout(athleteId, id);
  return prisma.workout.update({
    where: { id },
    data: {
      ...(input.discipline !== undefined ? { discipline: input.discipline } : {}),
      ...(input.date !== undefined ? { date: toDate(input.date) } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.targetDurationSec !== undefined ? { targetDurationSec: input.targetDurationSec } : {}),
      ...(input.targetDistanceM !== undefined ? { targetDistanceM: input.targetDistanceM } : {}),
      ...(input.targetIntensity !== undefined ? { targetIntensity: input.targetIntensity } : {}),
      ...(input.actualDurationSec !== undefined ? { actualDurationSec: input.actualDurationSec } : {}),
      ...(input.actualDistanceM !== undefined ? { actualDistanceM: input.actualDistanceM } : {}),
      ...(input.actualIntensity !== undefined ? { actualIntensity: input.actualIntensity } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    },
  });
}

export async function deleteWorkout(athleteId: string, id: string): Promise<void> {
  await getWorkout(athleteId, id);
  await prisma.workout.delete({ where: { id } });
}
