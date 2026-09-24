import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { env } from "../env.js";
import * as calendarFeedService from "./calendar-feed.service.js";

export const calendarFeedRouter = Router();

function feedUrl(token: string): string {
  return `${env.apiPublicUrl}/calendar-feed/${token}.ics`;
}

// Athlete-facing management endpoints (JWT-authenticated).
calendarFeedRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = await calendarFeedService.getToken(req.athleteId!);
    res.status(200).json({ url: token ? feedUrl(token) : null });
  }),
);

calendarFeedRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = await calendarFeedService.regenerateToken(req.athleteId!);
    res.status(200).json({ url: feedUrl(token) });
  }),
);

calendarFeedRouter.delete(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    await calendarFeedService.revokeToken(req.athleteId!);
    res.status(204).send();
  }),
);

// The feed itself: unauthenticated (calendar apps can't do JWT auth headers), gated by the
// unguessable token in the path instead. Anyone with the URL can read that athlete's
// workouts, which is why it's opt-in and rotatable rather than derived from the athlete id.
calendarFeedRouter.get(
  "/:token.ics",
  asyncHandler(async (req, res) => {
    const feedHost = new URL(env.apiPublicUrl).host;
    const ics = await calendarFeedService.renderFeed(req.params.token, feedHost);
    if (!ics) {
      res.status(404).json({ error: "Unknown or revoked calendar feed" });
      return;
    }
    res.status(200).set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="forge.ics"',
    });
    res.send(ics);
  }),
);
