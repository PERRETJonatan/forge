import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { authRouter } from "./auth/auth.routes.js";
import { calendarFeedRouter } from "./calendar-feed/calendar-feed.routes.js";
import { env } from "./env.js";
import { healthRouter } from "./health/health.routes.js";
import { planImportRouter } from "./plan-imports/plan-import.routes.js";
import { stravaRouter } from "./strava/strava.routes.js";
import { thresholdsRouter } from "./thresholds/thresholds.routes.js";
import { workoutTemplateRouter } from "./workout-templates/workout-template.routes.js";
import { workoutRouter } from "./workouts/workout.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json());

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/workouts", workoutRouter);
  app.use("/plan-imports", planImportRouter);
  app.use("/calendar-feed", calendarFeedRouter);
  app.use("/me/thresholds", thresholdsRouter);
  app.use("/workout-templates", workoutTemplateRouter);
  app.use("/strava", stravaRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
