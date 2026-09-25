import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { signStravaState } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../env.js";
import * as stravaService from "./strava.service.js";
import { StravaError } from "./strava.service.js";

export const stravaRouter = Router();

function handleStravaError(err: unknown, res: import("express").Response): void {
  if (err instanceof StravaError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

stravaRouter.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await stravaService.getStatus(req.athleteId!));
  }),
);

stravaRouter.get(
  "/connect-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.status(200).json({ url: stravaService.buildAuthorizeUrl(signStravaState(req.athleteId!)) });
    } catch (err) {
      handleStravaError(err, res);
    }
  }),
);

// Public: Strava redirects the athlete's browser here directly, with no Authorization header.
stravaRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code || !state) {
      res.redirect(`${env.webOrigin}/settings?strava=error`);
      return;
    }

    try {
      const athleteId = stravaService.athleteIdFromState(state);
      await stravaService.handleCallback(athleteId, code);
      res.redirect(`${env.webOrigin}/settings?strava=connected`);
    } catch {
      res.redirect(`${env.webOrigin}/settings?strava=error`);
    }
  }),
);

stravaRouter.post(
  "/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.status(200).json(await stravaService.syncActivities(req.athleteId!));
    } catch (err) {
      handleStravaError(err, res);
    }
  }),
);

stravaRouter.delete(
  "/connection",
  requireAuth,
  asyncHandler(async (req, res) => {
    await stravaService.disconnect(req.athleteId!);
    res.status(204).send();
  }),
);
