import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { addDays, dateKey, daysBetween } from "./fitness-model.js";
import * as fitnessService from "./fitness.service.js";

export const fitnessRouter = Router();

fitnessRouter.use(requireAuth);

/** Longest window one request may chart -- the full history still feeds the recurrence. */
const MAX_RANGE_DAYS = 3 * 366;
const DEFAULT_HISTORY_DAYS = 12 * 7;
const DEFAULT_LOOKAHEAD_DAYS = 14;

const dashboardQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  // The client's own calendar day, so "today" (actual vs projected) follows the athlete's
  // timezone rather than the server's.
  today: z.string().date().optional(),
});

fitnessRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const parsed = dashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const today = parsed.data.today ?? dateKey(new Date());
    const from = parsed.data.from ?? addDays(today, -DEFAULT_HISTORY_DAYS);
    const to = parsed.data.to ?? addDays(today, DEFAULT_LOOKAHEAD_DAYS);
    const span = daysBetween(from, to);
    if (span < 0 || span > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `from must be on or before to, at most ${MAX_RANGE_DAYS} days apart` });
      return;
    }

    res.status(200).json(await fitnessService.getDashboard(req.athleteId!, { from, to, today }));
  }),
);
