import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import * as authService from "./auth.service.js";
import { AuthError } from "./auth.service.js";
import { requireAuth } from "./middleware.js";

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function toAthleteDto(athlete: { id: string; email: string; name: string; createdAt: Date }) {
  return {
    id: athlete.id,
    email: athlete.email,
    name: athlete.name,
    createdAt: athlete.createdAt.toISOString(),
  };
}

function handleAuthError(err: unknown, res: import("express").Response): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const { athlete, tokens } = await authService.signup(
        parsed.data.email,
        parsed.data.password,
        parsed.data.name,
      );
      res.status(201).json({ athlete: toAthleteDto(athlete), ...tokens });
    } catch (err) {
      handleAuthError(err, res);
    }
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const { athlete, tokens } = await authService.login(
        parsed.data.email,
        parsed.data.password,
      );
      res.status(200).json({ athlete: toAthleteDto(athlete), ...tokens });
    } catch (err) {
      handleAuthError(err, res);
    }
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const tokens = await authService.refresh(parsed.data.refreshToken);
      res.status(200).json(tokens);
    } catch (err) {
      handleAuthError(err, res);
    }
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await authService.logout(parsed.data.refreshToken);
    res.status(204).send();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const athlete = await prisma.athlete.findUnique({ where: { id: req.athleteId } });
    if (!athlete) {
      res.status(404).json({ error: "Athlete not found" });
      return;
    }
    res.status(200).json(toAthleteDto(athlete));
  }),
);
