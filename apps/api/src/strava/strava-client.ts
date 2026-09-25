import { env } from "../env.js";

export class StravaApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface StravaTokenRefresh {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Only returned by the initial authorization-code exchange -- a token refresh doesn't repeat it. */
export interface StravaTokens extends StravaTokenRefresh {
  stravaAthleteId: number;
}

/** The subset of Strava's activity summary object (GET /athlete/activities) this app uses.
 * Streams (pace/power over the activity, splits/laps) are a separate, per-activity endpoint --
 * out of scope for v1, see StravaActivity in schema.prisma. */
export interface StravaActivityDto {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  moving_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_watts?: number;
  average_heartrate?: number;
  average_speed?: number;
}

/** Thin wrapper around Strava's REST API, injectable so sync/matching logic can be tested
 * against a fake implementation instead of the real network (see strava.service.test.ts). */
export interface StravaClient {
  exchangeAuthorizationCode(code: string): Promise<StravaTokens>;
  refreshAccessToken(refreshToken: string): Promise<StravaTokenRefresh>;
  listActivities(accessToken: string, opts: { after?: number; page: number; perPage: number }): Promise<StravaActivityDto[]>;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number };
}

function toTokenRefresh(raw: RawTokenResponse): StravaTokenRefresh {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: new Date(raw.expires_at * 1000),
  };
}

function toTokens(raw: RawTokenResponse): StravaTokens {
  if (raw.athlete?.id == null) {
    throw new StravaApiError("Strava did not return an athlete id", 502);
  }
  return { ...toTokenRefresh(raw), stravaAthleteId: raw.athlete.id };
}

async function requireCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (!env.stravaClientId || !env.stravaClientSecret) {
    throw new StravaApiError("Strava integration is not configured on this server", 503);
  }
  return { clientId: env.stravaClientId, clientSecret: env.stravaClientSecret };
}

export function createHttpStravaClient(): StravaClient {
  return {
    async exchangeAuthorizationCode(code) {
      const { clientId, clientSecret } = await requireCredentials();
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" }),
      });
      if (!res.ok) {
        throw new StravaApiError(`Strava token exchange failed: ${res.status}`, 502);
      }
      return toTokens((await res.json()) as RawTokenResponse);
    },

    async refreshAccessToken(refreshToken) {
      const { clientId, clientSecret } = await requireCredentials();
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) {
        throw new StravaApiError(`Strava token refresh failed: ${res.status}`, 502);
      }
      return toTokenRefresh((await res.json()) as RawTokenResponse);
    },

    async listActivities(accessToken, { after, page, perPage }) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (after != null) params.set("after", String(after));
      const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new StravaApiError(`Strava activity list failed: ${res.status}`, 502);
      }
      return (await res.json()) as StravaActivityDto[];
    },
  };
}
