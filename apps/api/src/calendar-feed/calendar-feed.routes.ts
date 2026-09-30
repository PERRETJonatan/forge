import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { env } from "../env.js";
import * as calendarFeedService from "./calendar-feed.service.js";

export const calendarFeedRouter = Router();

function feedUrl(token: string): string {
  return `${env.apiPublicUrl}/calendar-feed/${token}.ics`;
}

/** The all-workouts URL plus one per sport, on the same token -- or nothing while sync is off. */
function feedStatus(token: string | null) {
  if (!token) return { url: null, sports: [] };
  return {
    url: feedUrl(token),
    sports: calendarFeedService.SPORT_FEEDS.map((s) => ({
      discipline: s.discipline,
      url: `${env.apiPublicUrl}/calendar-feed/${token}/${s.slug}.ics`,
    })),
  };
}

// Athlete-facing management endpoints (JWT-authenticated).
calendarFeedRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(feedStatus(await calendarFeedService.getToken(req.athleteId!)));
  }),
);

calendarFeedRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(feedStatus(await calendarFeedService.regenerateToken(req.athleteId!)));
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
function serveFeed(sportOf: (params: Record<string, string>) => string | undefined) {
  return asyncHandler(async (req, res) => {
    const feedHost = new URL(env.apiPublicUrl).host;
    const sport = sportOf(req.params);
    const ics = await calendarFeedService.renderFeed(req.params.token, feedHost, sport);
    if (!ics) {
      res.status(404).json({ error: "Unknown or revoked calendar feed" });
      return;
    }
    res.status(200).set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="forge${sport ? `-${sport}` : ""}.ics"`,
    });
    res.send(ics);
  });
}

calendarFeedRouter.get("/:token.ics", serveFeed(() => undefined));
// One sport's workouts, e.g. /calendar-feed/<token>/swim.ics -- its own calendar, so its own color.
calendarFeedRouter.get("/:token/:sport.ics", serveFeed((params) => params.sport));
