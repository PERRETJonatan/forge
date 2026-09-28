import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { dateKey } from "../fitness/fitness-model.js";
import { coachLimiter } from "../rate-limit.js";
import * as coachService from "./coach.service.js";
import { CoachError } from "./coach.service.js";

export const coachRouter = Router();

coachRouter.use(requireAuth);

const MAX_MESSAGE_LENGTH = 4000;

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Write a message first").max(MAX_MESSAGE_LENGTH),
  // The client's own calendar day, so "tomorrow" and "this week" follow the athlete's timezone.
  today: z.string().date().optional(),
});

const draftSchema = z.object({
  request: z.string().trim().min(1, "Describe the workout you want").max(1000),
  discipline: z.enum(["SWIM", "BIKE", "RUN", "STRENGTH", "OTHER"]).optional(),
  today: z.string().date().optional(),
});

function handleCoachError(err: unknown, res: Response): void {
  if (err instanceof CoachError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

coachRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await coachService.getStatus());
  }),
);

coachRouter.get(
  "/messages",
  asyncHandler(async (req, res) => {
    res.status(200).json(await coachService.listMessages(req.athleteId!));
  }),
);

coachRouter.post(
  "/messages",
  coachLimiter,
  asyncHandler(async (req, res) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    try {
      const { content, today } = parsed.data;
      res.status(201).json(await coachService.sendMessage(req.athleteId!, content, today ?? dateKey(new Date())));
    } catch (err) {
      handleCoachError(err, res);
    }
  }),
);

coachRouter.delete(
  "/messages",
  asyncHandler(async (req, res) => {
    await coachService.clearMessages(req.athleteId!);
    res.status(204).send();
  }),
);

coachRouter.post(
  "/draft",
  coachLimiter,
  asyncHandler(async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    try {
      const { request, discipline, today } = parsed.data;
      res.status(200).json(await coachService.draftWorkout(req.athleteId!, request, discipline, today ?? dateKey(new Date())));
    } catch (err) {
      handleCoachError(err, res);
    }
  }),
);
