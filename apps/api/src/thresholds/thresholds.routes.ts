import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";

export const thresholdsRouter = Router();

thresholdsRouter.use(requireAuth);

const thresholdsSchema = z.object({
  ftpWatts: z.number().int().positive().nullable().optional(),
  runThresholdPaceSecPerKm: z.number().int().positive().nullable().optional(),
  swimThresholdPaceSec100m: z.number().int().positive().nullable().optional(),
  thresholdHr: z.number().int().positive().nullable().optional(),
});

function toThresholdsDto(athlete: {
  ftpWatts: number | null;
  runThresholdPaceSecPerKm: number | null;
  swimThresholdPaceSec100m: number | null;
  thresholdHr: number | null;
}) {
  return {
    ftpWatts: athlete.ftpWatts,
    runThresholdPaceSecPerKm: athlete.runThresholdPaceSecPerKm,
    swimThresholdPaceSec100m: athlete.swimThresholdPaceSec100m,
    thresholdHr: athlete.thresholdHr,
  };
}

thresholdsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: req.athleteId! } });
    res.status(200).json(toThresholdsDto(athlete));
  }),
);

thresholdsRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = thresholdsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const athlete = await prisma.athlete.update({ where: { id: req.athleteId! }, data: parsed.data });
    res.status(200).json(toThresholdsDto(athlete));
  }),
);
