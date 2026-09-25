function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:4200",
  /** Base URL the API itself is reachable at, used to build the absolute calendar feed URL. */
  apiPublicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:3000",
  /** Strava OAuth app credentials (https://www.strava.com/settings/api). Optional: routes that
   * need them fail with a clear error instead of crashing the whole app at startup. */
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? null,
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? null,
};
