import type { StravaConnection } from "@prisma/client";
import { prisma } from "../db.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { toDate } from "../workouts/workout.service.js";
import { createHttpStravaClient, StravaApiError, type StravaClient } from "./strava-client.js";
import { disciplineForStravaType, summarizeIntensity } from "./strava-mapping.js";
import { env } from "../env.js";

const defaultClient = createHttpStravaClient();
let activeClient: StravaClient = defaultClient;

/** Test-only seam: swap in a fake StravaClient so route tests can exercise the full
 * connect/sync/unmatch flow without hitting the real network. Pass null to restore the
 * real HTTP client. */
export function setStravaClientForTesting(client: StravaClient | null): void {
  activeClient = client ?? defaultClient;
}

// Refresh a bit before actual expiry, so a request never races Strava's clock.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const ACTIVITIES_PER_PAGE = 100;
// Safety bound on pagination so a misbehaving API response can't loop forever.
const MAX_PAGES = 50;

export class StravaError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function callbackUrl(): string {
  return `${env.apiPublicUrl}/strava/callback`;
}

/** `state` is the athlete's own (short-lived) JWT access token: Strava's redirect is a plain
 * browser GET with no way to carry an Authorization header, so this is how the callback
 * recovers which athlete started the flow -- a v1/local-dev simplification (15min TTL, see
 * jwt.ts) rather than a separate signed-state store. */
export function buildAuthorizeUrl(state: string): string {
  if (!env.stravaClientId) {
    throw new StravaError("Strava integration is not configured on this server", 503);
  }
  const params = new URLSearchParams({
    client_id: env.stravaClientId,
    redirect_uri: callbackUrl(),
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export function athleteIdFromState(state: string): string {
  try {
    return verifyAccessToken(state).sub;
  } catch {
    throw new StravaError("Strava connect link expired -- try connecting again", 400);
  }
}

export async function handleCallback(athleteId: string, code: string): Promise<void> {
  let tokens;
  try {
    tokens = await activeClient.exchangeAuthorizationCode(code);
  } catch (err) {
    if (err instanceof StravaApiError) throw new StravaError(err.message, err.status);
    throw err;
  }
  await prisma.stravaConnection.upsert({
    where: { athleteId },
    create: {
      athleteId,
      stravaAthleteId: tokens.stravaAthleteId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
    update: {
      stravaAthleteId: tokens.stravaAthleteId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
  });
}

export interface StravaStatus {
  connected: boolean;
  stravaAthleteId: string | null;
  lastSyncAt: string | null;
}

export async function getStatus(athleteId: string): Promise<StravaStatus> {
  const connection = await prisma.stravaConnection.findUnique({ where: { athleteId } });
  return {
    connected: connection != null,
    stravaAthleteId: connection ? connection.stravaAthleteId.toString() : null,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
  };
}

export async function disconnect(athleteId: string): Promise<void> {
  await prisma.stravaConnection.deleteMany({ where: { athleteId } });
}

async function ensureFreshAccessToken(connection: StravaConnection): Promise<string> {
  if (connection.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return connection.accessToken;
  }
  const refreshed = await activeClient.refreshAccessToken(connection.refreshToken);
  await prisma.stravaConnection.update({
    where: { athleteId: connection.athleteId },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    },
  });
  return refreshed.accessToken;
}

/** Local calendar day (UTC) an activity's start_date falls on -- matches Workout.date's convention. */
function activityDay(startDate: string): Date {
  return toDate(startDate.slice(0, 10));
}

export interface SyncResult {
  fetched: number;
  matchedExisting: number;
  createdNew: number;
}

/** Fetches every activity since the last sync (or all-time, on first sync), storing each as a
 * StravaActivity and, the first time it's seen, matching it to a planned workout on the same
 * date/discipline (best-effort) or creating a new source: STRAVA workout if none fits. */
export async function syncActivities(athleteId: string): Promise<SyncResult> {
  const connection = await prisma.stravaConnection.findUnique({ where: { athleteId } });
  if (!connection) {
    throw new StravaError("Strava is not connected for this athlete", 404);
  }

  const accessToken = await ensureFreshAccessToken(connection);
  const after = connection.lastSyncAt ? Math.floor(connection.lastSyncAt.getTime() / 1000) : undefined;

  const result: SyncResult = { fetched: 0, matchedExisting: 0, createdNew: 0 };

  for (let page = 1; page <= MAX_PAGES; page++) {
    let batch;
    try {
      batch = await activeClient.listActivities(accessToken, { after, page, perPage: ACTIVITIES_PER_PAGE });
    } catch (err) {
      if (err instanceof StravaApiError) throw new StravaError(err.message, err.status);
      throw err;
    }
    if (batch.length === 0) break;
    result.fetched += batch.length;

    for (const activity of batch) {
      const existing = await prisma.stravaActivity.findUnique({ where: { stravaActivityId: activity.id } });
      const discipline = disciplineForStravaType(activity);
      const fields = {
        discipline,
        name: activity.name,
        startDate: new Date(activity.start_date),
        durationSec: activity.moving_time,
        distanceM: activity.distance,
        elevationGainM: activity.total_elevation_gain ?? null,
        avgWatts: activity.average_watts ?? null,
        avgHr: activity.average_heartrate ?? null,
        avgSpeedMps: activity.average_speed ?? null,
      };

      if (existing) {
        // Metrics can change if the athlete edits the activity on Strava; the match itself,
        // once made, is left alone so a manual unmatch sticks across future syncs.
        await prisma.stravaActivity.update({ where: { id: existing.id }, data: fields });
        continue;
      }

      const date = activityDay(activity.start_date);
      const matchTarget = await prisma.workout.findFirst({
        where: { athleteId, date, discipline, source: { in: ["MANUAL", "IMPORT"] }, stravaActivity: { is: null } },
        orderBy: { createdAt: "asc" },
      });

      if (matchTarget) {
        await prisma.workout.update({
          where: { id: matchTarget.id },
          data: {
            actualDurationSec: activity.moving_time,
            actualDistanceM: activity.distance,
            actualIntensity: summarizeIntensity(activity),
            completed: true,
          },
        });
        await prisma.stravaActivity.create({
          data: { athleteId, stravaActivityId: activity.id, ...fields, matchedWorkoutId: matchTarget.id },
        });
        result.matchedExisting++;
      } else {
        const created = await prisma.workout.create({
          data: {
            athleteId,
            discipline,
            date,
            source: "STRAVA",
            title: activity.name,
            actualDurationSec: activity.moving_time,
            actualDistanceM: activity.distance,
            actualIntensity: summarizeIntensity(activity),
            completed: true,
          },
        });
        await prisma.stravaActivity.create({
          data: { athleteId, stravaActivityId: activity.id, ...fields, matchedWorkoutId: created.id },
        });
        result.createdNew++;
      }
    }

    if (batch.length < ACTIVITIES_PER_PAGE) break;
  }

  await prisma.stravaConnection.update({ where: { athleteId }, data: { lastSyncAt: new Date() } });
  return result;
}

/** Detaches a wrongly-matched activity from a workout: for a purely-synced workout (nothing
 * else backs it) that means deleting it; for a planned workout that had actual data merged in,
 * it means clearing that actual data back out. The StravaActivity row itself is kept either
 * way (unmatched), so it isn't silently re-created on the next sync. */
export async function unmatchWorkout(athleteId: string, workoutId: string): Promise<void> {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, athleteId },
    include: { stravaActivity: true },
  });
  if (!workout) {
    throw new StravaError("Workout not found", 404);
  }
  if (!workout.stravaActivity) {
    throw new StravaError("This workout has no matched Strava activity", 400);
  }

  if (workout.source === "STRAVA") {
    // onDelete: SetNull already unlinks the activity; nothing else backs this workout.
    await prisma.workout.delete({ where: { id: workout.id } });
  } else {
    await prisma.stravaActivity.update({ where: { id: workout.stravaActivity.id }, data: { matchedWorkoutId: null } });
    await prisma.workout.update({
      where: { id: workout.id },
      data: { actualDurationSec: null, actualDistanceM: null, actualIntensity: null, completed: false },
    });
  }
}
