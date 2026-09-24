import type { WorkoutTemplate } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { workoutStepsSchema } from "../workouts/workout-step.schema.js";
import { toWorkoutDto } from "../workouts/workout.routes.js";
import * as templateService from "./workout-template.service.js";
import { WorkoutTemplateError } from "./workout-template.service.js";

export const workoutTemplateRouter = Router();

workoutTemplateRouter.use(requireAuth);

const disciplineSchema = z.enum(["SWIM", "BIKE", "RUN", "STRENGTH", "OTHER"]);

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  discipline: disciplineSchema,
  steps: workoutStepsSchema,
});

const updateTemplateSchema = createTemplateSchema.partial();

const applyTemplateSchema = z.object({
  date: z.string().date(),
});

function toTemplateDto(t: WorkoutTemplate) {
  return {
    id: t.id,
    name: t.name,
    discipline: t.discipline,
    steps: t.steps,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function handleTemplateError(err: unknown, res: import("express").Response): void {
  if (err instanceof WorkoutTemplateError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

workoutTemplateRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const templates = await templateService.listTemplates(req.athleteId!);
    res.status(200).json(templates.map(toTemplateDto));
  }),
);

workoutTemplateRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const template = await templateService.getTemplate(req.athleteId!, req.params.id);
      res.status(200).json(toTemplateDto(template));
    } catch (err) {
      handleTemplateError(err, res);
    }
  }),
);

workoutTemplateRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const template = await templateService.createTemplate(req.athleteId!, parsed.data);
    res.status(201).json(toTemplateDto(template));
  }),
);

workoutTemplateRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const template = await templateService.updateTemplate(req.athleteId!, req.params.id, parsed.data);
      res.status(200).json(toTemplateDto(template));
    } catch (err) {
      handleTemplateError(err, res);
    }
  }),
);

workoutTemplateRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await templateService.deleteTemplate(req.athleteId!, req.params.id);
      res.status(204).send();
    } catch (err) {
      handleTemplateError(err, res);
    }
  }),
);

workoutTemplateRouter.post(
  "/:id/apply",
  asyncHandler(async (req, res) => {
    const parsed = applyTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      // toWorkoutDto so an applied template renders identically to any other manual workout
      // in the calendar/list views.
      const workout = await templateService.applyTemplate(req.athleteId!, req.params.id, parsed.data.date);
      res.status(201).json(toWorkoutDto(workout));
    } catch (err) {
      handleTemplateError(err, res);
    }
  }),
);
