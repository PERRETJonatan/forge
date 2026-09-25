import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { toDate } from "../workouts/workout.service.js";

export const raceTargetRouter = Router();

raceTargetRouter.use(requireAuth);

const raceTargetSchema = z.object({
  raceName: z.string().trim().max(200).nullable().optional(),
  raceDate: z.string().date().nullable().optional(),
});

function toRaceTargetDto(athlete: { raceName: string | null; raceDate: Date | null }) {
  return {
    raceName: athlete.raceName,
    raceDate: athlete.raceDate ? athlete.raceDate.toISOString().slice(0, 10) : null,
  };
}

raceTargetRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: req.athleteId! } });
    res.status(200).json(toRaceTargetDto(athlete));
  }),
);

raceTargetRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = raceTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { raceName, raceDate } = parsed.data;
    const athlete = await prisma.athlete.update({
      where: { id: req.athleteId! },
      data: {
        ...(raceName !== undefined ? { raceName: raceName || null } : {}),
        ...(raceDate !== undefined ? { raceDate: raceDate ? toDate(raceDate) : null } : {}),
      },
    });
    res.status(200).json(toRaceTargetDto(athlete));
  }),
);
