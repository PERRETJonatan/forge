function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

/** A signing secret. In production, refuse the .env.example placeholders or anything short
 * enough to brute-force -- a guessable JWT secret lets anyone mint a login for any account. */
function secret(name: string): string {
  const value = required(name);
  if (isProduction && (value.length < 32 || /change-me/i.test(value))) {
    throw new Error(`${name} must be a random string of at least 32 characters in production (e.g. \`openssl rand -hex 32\`)`);
  }
  return value;
}

/** Number of reverse proxies in front of the API (see README, "Deploying"). */
function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY ?? "1";
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(`TRUST_PROXY must be a whole number of proxy hops, got "${raw}"`);
  }
  return hops;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: secret("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: secret("JWT_REFRESH_SECRET"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:4200",
  /** Base URL the API itself is reachable at, used to build the absolute calendar feed URL. */
  apiPublicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:3000",
  /** Strava OAuth app credentials (https://www.strava.com/settings/api). Optional: routes that
   * need them fail with a clear error instead of crashing the whole app at startup. */
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? null,
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? null,
  /**
   * How many proxies sit between the client and the API, so rate limits key on the real client
   * IP from X-Forwarded-For. 1 = the bundled web container's nginx. Only count proxies you run:
   * trusting more hops than exist lets a client spoof its IP and dodge the limits.
   */
  trustProxy: trustProxyHops(),
  /** Switched off by the test setup, which logs in far more often than any real client. */
  rateLimitEnabled: true,
};
