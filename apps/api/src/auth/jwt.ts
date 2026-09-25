import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

export interface AccessTokenPayload {
  sub: string;
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;

export function signAccessToken(athleteId: string): string {
  return jwt.sign({ sub: athleteId } satisfies AccessTokenPayload, env.jwtAccessSecret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function signRefreshToken(athleteId: string): string {
  // jti makes each refresh token unique even when issued for the same athlete
  // within the same second (iat has 1s resolution) — without it, two tokens
  // signed back-to-back would be byte-identical and collide on the DB's
  // unique tokenHash constraint.
  return jwt.sign({ sub: athleteId, jti: randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as AccessTokenPayload;
}

export function refreshTokenExpiryDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return date;
}

const STRAVA_STATE_TTL = "10m";

/** Its own key, derived from (not equal to) the access-token secret: a state token can't be
 * replayed as an API login, and an access token can't pose as a state. */
function stravaStateKey(): Buffer {
  return createHmac("sha256", env.jwtAccessSecret).update("forge:strava-oauth-state").digest();
}

/**
 * OAuth `state` for Strava connect. Strava's redirect back is a plain browser GET with no
 * Authorization header, so the state is what identifies the athlete on the callback. It ends
 * up in Strava's logs and browser history, hence single-purpose and short-lived (just long
 * enough for the consent screen), rather than the athlete's actual access token.
 */
export function signStravaState(athleteId: string): string {
  return jwt.sign({ sub: athleteId } satisfies AccessTokenPayload, stravaStateKey(), { expiresIn: STRAVA_STATE_TTL });
}

export function verifyStravaState(state: string): AccessTokenPayload {
  return jwt.verify(state, stravaStateKey()) as AccessTokenPayload;
}
