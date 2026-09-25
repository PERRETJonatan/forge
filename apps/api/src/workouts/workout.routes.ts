import type { Workout } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import * as stravaService from "../strava/strava.service.js";
import { StravaError } from "../strava/strava.service.js";
import { workoutStepsSchema } from "./workout-step.schema.js";
import * as workoutService from "./workout.service.js";
import { WorkoutError } from "./workout.service.js";
import type { WorkoutWithStrava } from "./workout.service.js";

export const workoutRouter = Router();

workoutRouter.use(requireAuth);

const disciplineSchema = z.enum(["SWIM", "BIKE", "RUN", "STRENGTH", "OTHER"]);

const workoutFieldsSchema = {
  discipline: disciplineSchema,
  date: z.string().date(),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  targetDurationSec: z.number().int().nonnegative().nullable().optional(),
  targetDistanceM: z.number().nonnegative().nullable().optional(),
  targetIntensity: z.string().max(200).nullable().optional(),
  actualDurationSec: z.number().int().nonnegative().nullable().optional(),
  actualDistanceM: z.number().nonnegative().nullable().optional(),
  actualIntensity: z.string().max(200).nullable().optional(),
  structuredIntervals: workoutStepsSchema.nullable().optional(),
  completed: z.boolean().optional(),
};

const createWorkoutSchema = z.object(workoutFieldsSchema);
const updateWorkoutSchema = z.object(workoutFieldsSchema).partial();

const listQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  discipline: disciplineSchema.optional(),
  completed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export function toWorkoutDto(w: Workout | WorkoutWithStrava) {
  return {
    id: w.id,
    discipline: w.discipline,
    date: w.date.toISOString().slice(0, 10),
    source: w.source,
    title: w.title,
    notes: w.notes,
    targetDurationSec: w.targetDurationSec,
    targetDistanceM: w.targetDistanceM,
    targetIntensity: w.targetIntensity,
    actualDurationSec: w.actualDurationSec,
    actualDistanceM: w.actualDistanceM,
    actualIntensity: w.actualIntensity,
    structuredIntervals: w.structuredIntervals,
    completed: w.completed,
    planImportId: w.planImportId,
    stravaActivityId: "stravaActivity" in w ? (w.stravaActivity?.id ?? null) : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function handleWorkoutError(err: unknown, res: import("express").Response): void {
  if (err instanceof WorkoutError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

workoutRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const workouts = await workoutService.listWorkouts(req.athleteId!, parsed.data);
    res.status(200).json(workouts.map(toWorkoutDto));
  }),
);

workoutRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const workout = await workoutService.getWorkout(req.athleteId!, req.params.id);
      res.status(200).json(toWorkoutDto(workout));
    } catch (err) {
      handleWorkoutError(err, res);
    }
  }),
);

workoutRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createWorkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const workout = await workoutService.createWorkout(req.athleteId!, parsed.data);
    res.status(201).json(toWorkoutDto(workout));
  }),
);

workoutRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateWorkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const workout = await workoutService.updateWorkout(req.athleteId!, req.params.id, parsed.data);
      res.status(200).json(toWorkoutDto(workout));
    } catch (err) {
      handleWorkoutError(err, res);
    }
  }),
);

workoutRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await workoutService.deleteWorkout(req.athleteId!, req.params.id);
      res.status(204).send();
    } catch (err) {
      handleWorkoutError(err, res);
    }
  }),
);

workoutRouter.post(
  "/:id/unmatch-strava",
  asyncHandler(async (req, res) => {
    try {
      await stravaService.unmatchWorkout(req.athleteId!, req.params.id);
      res.status(204).send();
    } catch (err) {
      if (err instanceof StravaError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);
