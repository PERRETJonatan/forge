import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import * as runnaService from "./runna.service.js";
import { RunnaError } from "./runna.service.js";

export const runnaRouter = Router();

runnaRouter.use(requireAuth);

const connectSchema = z.object({ feedUrl: z.string().trim().min(1).max(500) });

function handleRunnaError(err: unknown, res: Response): void {
  if (err instanceof RunnaError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

runnaRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.status(200).json(await runnaService.getStatus(req.athleteId!));
  }),
);

runnaRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Paste your Runna calendar link." });
      return;
    }
    try {
      res.status(200).json(await runnaService.connect(req.athleteId!, parsed.data.feedUrl));
    } catch (err) {
      handleRunnaError(err, res);
    }
  }),
);

runnaRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    try {
      res.status(200).json(await runnaService.sync(req.athleteId!));
    } catch (err) {
      handleRunnaError(err, res);
    }
  }),
);

runnaRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    await runnaService.disconnect(req.athleteId!);
    res.status(204).end();
  }),
);
