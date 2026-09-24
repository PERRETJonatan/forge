import type { WorkoutStep } from "@forge/shared";
import type { Discipline, WorkoutTemplate } from "@prisma/client";
import { prisma } from "../db.js";
import { toDate } from "../workouts/workout.service.js";

export class WorkoutTemplateError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface WorkoutTemplateInput {
  name: string;
  discipline: Discipline;
  steps: WorkoutStep[];
}

export async function listTemplates(athleteId: string): Promise<WorkoutTemplate[]> {
  return prisma.workoutTemplate.findMany({ where: { athleteId }, orderBy: { updatedAt: "desc" } });
}

export async function getTemplate(athleteId: string, id: string): Promise<WorkoutTemplate> {
  const template = await prisma.workoutTemplate.findFirst({ where: { id, athleteId } });
  if (!template) {
    throw new WorkoutTemplateError("Workout template not found", 404);
  }
  return template;
}

export async function createTemplate(athleteId: string, input: WorkoutTemplateInput): Promise<WorkoutTemplate> {
  return prisma.workoutTemplate.create({
    data: {
      athleteId,
      name: input.name,
      discipline: input.discipline,
      steps: input.steps as unknown as object,
    },
  });
}

export async function updateTemplate(
  athleteId: string,
  id: string,
  input: Partial<WorkoutTemplateInput>,
): Promise<WorkoutTemplate> {
  await getTemplate(athleteId, id);
  return prisma.workoutTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.discipline !== undefined ? { discipline: input.discipline } : {}),
      ...(input.steps !== undefined ? { steps: input.steps as unknown as object } : {}),
    },
  });
}

export async function deleteTemplate(athleteId: string, id: string): Promise<void> {
  await getTemplate(athleteId, id);
  await prisma.workoutTemplate.delete({ where: { id } });
}

/** Applies a template to a date: creates an ordinary manual Workout carrying its steps. */
export async function applyTemplate(athleteId: string, id: string, date: string) {
  const template = await getTemplate(athleteId, id);
  return prisma.workout.create({
    data: {
      athleteId,
      source: "MANUAL",
      discipline: template.discipline,
      date: toDate(date),
      title: template.name,
      structuredIntervals: template.steps as object,
    },
  });
}
