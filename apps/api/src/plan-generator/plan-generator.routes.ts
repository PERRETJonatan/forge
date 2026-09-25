import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { dateKey } from "../fitness/fitness-model.js";
import * as planGeneratorService from "./plan-generator.service.js";
import { PlanGeneratorError } from "./plan-generator.service.js";

export const planGeneratorRouter = Router();

planGeneratorRouter.use(requireAuth);

const weekdaySchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6),
]);

const requestSchema = z
  .object({
    startDate: z.string().date(),
    raceDistance: z.enum(["SPRINT", "OLYMPIC", "HALF", "FULL"]),
    maxWeeklyHours: z.number().min(3).max(30),
    trainingDays: z.array(weekdaySchema).min(3).max(7),
    longRideDay: weekdaySchema,
    longRunDay: weekdaySchema,
    // The client's own calendar day, so "can't start in the past" follows the athlete's timezone.
    today: z.string().date().optional(),
  })
  .refine((r) => r.trainingDays.includes(r.longRideDay) && r.trainingDays.includes(r.longRunDay), {
    message: "The long ride and long run days must be training days",
  })
  .refine((r) => r.longRideDay !== r.longRunDay, { message: "Put the long ride and long run on different days" });

function handle(action: typeof planGeneratorService.previewPlan | typeof planGeneratorService.applyPlan) {
  return asyncHandler(async (req, res: Response) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { today, ...request } = parsed.data;
    const trainingDays = [...new Set(request.trainingDays)];
    try {
      res.status(200).json(await action(req.athleteId!, { ...request, trainingDays }, today ?? dateKey(new Date())));
    } catch (err) {
      if (err instanceof PlanGeneratorError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });
}

planGeneratorRouter.post("/preview", handle(planGeneratorService.previewPlan));
planGeneratorRouter.post("/apply", handle(planGeneratorService.applyPlan));
