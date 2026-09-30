import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signupAndLogin } from "./helpers.js";
import { prisma } from "../src/db.js";
import { signStravaState, verifyAccessToken, verifyStravaState } from "../src/auth/jwt.js";
import { env } from "../src/env.js";
import { StravaApiError, type StravaActivityDto, type StravaClient, type StravaTokenRefresh, type StravaTokens } from "../src/strava/strava-client.js";
import { setStravaClientForTesting, syncActivities, syncStaleConnections } from "../src/strava/strava.service.js";

const app = createApp();

/** The OAuth state the connect-url endpoint would have issued this athlete. */
function stateFor(token: string): string {
  return signStravaState(verifyAccessToken(token).sub);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function activity(overrides: Partial<StravaActivityDto> & { id: number }): StravaActivityDto {
  return {
    name: "Morning Ride",
    type: "Ride",
    start_date: "2026-09-20T07:00:00Z",
    moving_time: 3600,
    distance: 30000,
    ...overrides,
  };
}

class FakeStravaClient implements StravaClient {
  activitiesByPage: StravaActivityDto[][] = [];
  /** The `after` of every listActivities call, in order. */
  afterCalls: (number | undefined)[] = [];
  /** When set, listActivities fails with this instead of answering. */
  failWith: Error | null = null;
  exchangeCalls: string[] = [];
  refreshCalls: string[] = [];

  async exchangeAuthorizationCode(code: string): Promise<StravaTokens> {
    this.exchangeCalls.push(code);
    return {
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      stravaAthleteId: 12345,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<StravaTokenRefresh> {
    this.refreshCalls.push(refreshToken);
    return {
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    };
  }

  async listActivities(_accessToken: string, opts: { after?: number; page: number }): Promise<StravaActivityDto[]> {
    if (opts.page === 1) this.afterCalls.push(opts.after);
    if (this.failWith) throw this.failWith;
    return this.activitiesByPage[opts.page - 1] ?? [];
  }
}

let fakeClient: FakeStravaClient;
let token: string;

beforeEach(async () => {
  fakeClient = new FakeStravaClient();
  setStravaClientForTesting(fakeClient);
  token = await signupAndLogin("athlete@example.com");
});

afterEach(() => {
  setStravaClientForTesting(null);
});

describe("GET /strava/status", () => {
  it("reports disconnected before connecting", async () => {
    const res = await request(app).get("/strava/status").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, stravaAthleteId: null, lastSyncAt: null, lastSyncError: null });
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/strava/status");
    expect(res.status).toBe(401);
  });
});

describe("GET /strava/connect-url", () => {
  // Neither a dev .env nor CI's sets real Strava credentials; the URL only needs *a* client id.
  let originalClientId: string | null;
  beforeEach(() => {
    originalClientId = env.stravaClientId;
    env.stravaClientId = "test-client-id";
  });
  afterEach(() => {
    env.stravaClientId = originalClientId;
  });

  it("returns a Strava authorize URL whose state names the athlete without being their access token", async () => {
    const res = await request(app).get("/strava/connect-url").set(auth(token));
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.hostname).toBe("www.strava.com");
    const state = url.searchParams.get("state")!;
    expect(state).not.toBe(token);
    expect(verifyStravaState(state).sub).toBe(verifyAccessToken(token).sub);
    expect(url.searchParams.get("scope")).toBe("activity:read_all");
  });

  it("reports 503 when the server has no Strava credentials configured", async () => {
    env.stravaClientId = null;
    const res = await request(app).get("/strava/connect-url").set(auth(token));
    expect(res.status).toBe(503);
  });
});

describe("GET /strava/callback", () => {
  it("exchanges the code and connects the athlete identified by state", async () => {
    const res = await request(app).get("/strava/callback").query({ code: "auth-code-123", state: stateFor(token) });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("strava=connected");
    expect(fakeClient.exchangeCalls).toEqual(["auth-code-123"]);

    const status = await request(app).get("/strava/status").set(auth(token));
    expect(status.body.connected).toBe(true);
    expect(status.body.stravaAthleteId).toBe("12345");
    await syncActivities(verifyAccessToken(token).sub);
  });

  it("starts the first sync by itself, so activities appear without pressing Sync now", async () => {
    fakeClient.activitiesByPage = [[activity({ id: 9, type: "Run" })]];
    await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(token) });
    // Joins the sync the callback started rather than starting another.
    await syncActivities(verifyAccessToken(token).sub);
    expect(fakeClient.afterCalls).toEqual([undefined]);
    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body.map((w: { title: string }) => w.title)).toEqual(["Morning Ride"]);
  });

  it("redirects with an error for an invalid/expired state", async () => {
    const res = await request(app).get("/strava/callback").query({ code: "auth-code-123", state: "not-a-jwt" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("strava=error");
  });

  it("rejects an access token passed as state", async () => {
    const res = await request(app).get("/strava/callback").query({ code: "auth-code-123", state: token });
    expect(res.headers.location).toContain("strava=error");
    expect(fakeClient.exchangeCalls).toEqual([]);
  });

  it("redirects with an error when code or state is missing", async () => {
    const res = await request(app).get("/strava/callback").query({ state: stateFor(token) });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("strava=error");
  });
});

describe("background sync", () => {
  it("syncs connections that are stale or never synced, and leaves fresh ones alone", async () => {
    const other = await signupAndLogin("other@example.com");
    const fresh = await signupAndLogin("fresh@example.com");
    for (const t of [token, other, fresh]) {
      await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(t) });
      await syncActivities(verifyAccessToken(t).sub);
    }
    const ids = [token, other, fresh].map((t) => verifyAccessToken(t).sub);
    await prisma.stravaConnection.update({ where: { athleteId: ids[0] }, data: { lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    await prisma.stravaConnection.update({ where: { athleteId: ids[1] }, data: { lastSyncAt: null } });
    fakeClient.afterCalls = [];

    await syncStaleConnections();

    expect(fakeClient.afterCalls).toHaveLength(2);
    const synced = await prisma.stravaConnection.findMany({ where: { athleteId: { in: ids.slice(0, 2) } } });
    for (const c of synced) expect(Date.now() - c.lastSyncAt!.getTime()).toBeLessThan(60_000);
  });
});

describe("POST /strava/sync", () => {
  /** Connects, and waits out the first sync the callback starts so each test begins from a quiet connection. */
  async function connect() {
    await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(token) });
    await syncActivities(verifyAccessToken(token).sub);
    fakeClient.afterCalls = [];
  }

  it("requires a connection first", async () => {
    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.status).toBe(404);
  });

  it("matches a synced activity to a same-date/discipline planned workout", async () => {
    await connect();
    await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "BIKE", date: "2026-09-20", title: "Threshold ride" });
    fakeClient.activitiesByPage = [[activity({ id: 1 })]];

    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fetched: 1, matchedExisting: 1, createdNew: 0 });

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
    expect(workouts.body[0].source).toBe("MANUAL");
    expect(workouts.body[0].completed).toBe(true);
    expect(workouts.body[0].actualDistanceM).toBe(30000);
    expect(workouts.body[0].stravaActivityId).not.toBeNull();
  });

  it("matches a synced activity to a workout from a generated plan", async () => {
    await connect();
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { email: "athlete@example.com" } });
    await prisma.workout.create({
      data: { athleteId: athlete.id, source: "GENERATED", discipline: "BIKE", date: new Date("2026-09-20T00:00:00Z") },
    });
    fakeClient.activitiesByPage = [[activity({ id: 1 })]];

    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.body).toEqual({ fetched: 1, matchedExisting: 1, createdNew: 0 });
  });

  it("matches a synced run to a workout pulled from Runna", async () => {
    await connect();
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { email: "athlete@example.com" } });
    const planned = await prisma.workout.create({
      data: { athleteId: athlete.id, source: "RUNNA", externalId: "plan_week_1_EASY_RUN_0", discipline: "RUN", date: new Date("2026-09-20T00:00:00Z") },
    });
    fakeClient.activitiesByPage = [[activity({ id: 1, type: "Run", distance: 8000 })]];

    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.body).toEqual({ fetched: 1, matchedExisting: 1, createdNew: 0 });
    expect((await prisma.workout.findUniqueOrThrow({ where: { id: planned.id } })).completed).toBe(true);
  });

  it("creates a new source: STRAVA workout when nothing matches", async () => {
    await connect();
    fakeClient.activitiesByPage = [[activity({ id: 2, type: "Run", distance: 10000 })]];

    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.body).toEqual({ fetched: 1, matchedExisting: 0, createdNew: 1 });

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
    expect(workouts.body[0].source).toBe("STRAVA");
    expect(workouts.body[0].discipline).toBe("RUN");
  });

  it("is idempotent: re-syncing the same activity doesn't duplicate it", async () => {
    await connect();
    fakeClient.activitiesByPage = [[activity({ id: 3, type: "Swim" })]];
    await request(app).post("/strava/sync").set(auth(token));
    // Second sync page-1 still returns the same activity (e.g. `after` filtering not modeled by the fake).
    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.body.createdNew).toBe(0);

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
  });

  it("looks back a few days on each sync, so an activity uploaded late isn't missed", async () => {
    await connect();
    const athleteId = verifyAccessToken(token).sub;
    const lastSyncAt = new Date("2026-09-30T10:00:00Z");
    await prisma.stravaConnection.update({ where: { athleteId }, data: { lastSyncAt } });

    // Started at 9:30, before the 10:00 sync, but only uploaded afterwards.
    fakeClient.activitiesByPage = [[activity({ id: 11, type: "Run", start_date: "2026-09-30T09:30:00Z" })]];
    const res = await request(app).post("/strava/sync").set(auth(token));

    expect(fakeClient.afterCalls).toEqual([lastSyncAt.getTime() / 1000 - 3 * 24 * 60 * 60]);
    expect(res.body).toEqual({ fetched: 1, matchedExisting: 0, createdNew: 1 });
  });

  it("records why a sync failed, and clears it on the next success", async () => {
    await connect();
    fakeClient.failWith = new StravaApiError("Strava API error (500)", 502);
    expect((await request(app).post("/strava/sync").set(auth(token))).status).toBe(502);
    expect((await request(app).get("/strava/status").set(auth(token))).body.lastSyncError).toBe("Strava API error (500)");

    fakeClient.failWith = null;
    expect((await request(app).post("/strava/sync").set(auth(token))).status).toBe(200);
    expect((await request(app).get("/strava/status").set(auth(token))).body.lastSyncError).toBeNull();
  });

  it("asks to reconnect when Strava refuses to refresh the access token", async () => {
    await connect();
    const athleteId = verifyAccessToken(token).sub;
    await prisma.stravaConnection.update({ where: { athleteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    fakeClient.refreshAccessToken = async () => {
      throw new StravaApiError("Bad Request", 400);
    };
    expect((await request(app).post("/strava/sync").set(auth(token))).status).toBe(400);
    expect((await request(app).get("/strava/status").set(auth(token))).body.lastSyncError).toMatch(/connect Strava again/);
  });

  it("runs overlapping syncs for the same athlete once", async () => {
    await connect();
    fakeClient.activitiesByPage = [[activity({ id: 12, type: "Run" })]];
    const [a, b] = await Promise.all([
      request(app).post("/strava/sync").set(auth(token)),
      request(app).post("/strava/sync").set(auth(token)),
    ]);
    expect(fakeClient.afterCalls).toHaveLength(1);
    expect(a.body).toEqual(b.body);
    expect((await request(app).get("/workouts").set(auth(token))).body).toHaveLength(1);
  });

  it("refreshes an expiring access token before syncing", async () => {
    await connect();
    await prisma.stravaConnection.update({
      where: { athleteId: (await prisma.athlete.findFirstOrThrow()).id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    fakeClient.activitiesByPage = [[]];

    const res = await request(app).post("/strava/sync").set(auth(token));
    expect(res.status).toBe(200);
    expect(fakeClient.refreshCalls).toEqual(["fake-refresh-token"]);
  });

  it("only syncs into the requesting athlete's own calendar", async () => {
    await connect();
    const otherToken = await signupAndLogin("other@example.com");
    fakeClient.activitiesByPage = [[activity({ id: 4 })]];
    await request(app).post("/strava/sync").set(auth(token));

    const otherWorkouts = await request(app).get("/workouts").set(auth(otherToken));
    expect(otherWorkouts.body).toHaveLength(0);
  });
});

describe("DELETE /strava/connection", () => {
  it("disconnects without deleting already-synced workouts", async () => {
    await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(token) });
    fakeClient.activitiesByPage = [[activity({ id: 5 })]];
    await request(app).post("/strava/sync").set(auth(token));

    const del = await request(app).delete("/strava/connection").set(auth(token));
    expect(del.status).toBe(204);

    const status = await request(app).get("/strava/status").set(auth(token));
    expect(status.body.connected).toBe(false);

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
  });
});

describe("POST /workouts/:id/unmatch-strava", () => {
  it("deletes a purely-synced (source: STRAVA) workout on unmatch", async () => {
    await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(token) });
    fakeClient.activitiesByPage = [[activity({ id: 6, type: "Run" })]];
    await request(app).post("/strava/sync").set(auth(token));
    const workouts = await request(app).get("/workouts").set(auth(token));
    const workoutId = workouts.body[0].id;

    const res = await request(app).post(`/workouts/${workoutId}/unmatch-strava`).set(auth(token));
    expect(res.status).toBe(204);

    const after = await request(app).get("/workouts").set(auth(token));
    expect(after.body).toHaveLength(0);
  });

  it("clears actual data (keeps the workout) when unmatching a planned workout", async () => {
    await request(app).get("/strava/callback").query({ code: "auth-code", state: stateFor(token) });
    await request(app).post("/workouts").set(auth(token)).send({ discipline: "BIKE", date: "2026-09-21" });
    fakeClient.activitiesByPage = [[activity({ id: 7, start_date: "2026-09-21T07:00:00Z" })]];
    await request(app).post("/strava/sync").set(auth(token));
    const workouts = await request(app).get("/workouts").set(auth(token));
    const workoutId = workouts.body[0].id;
    expect(workouts.body[0].source).toBe("MANUAL");

    const res = await request(app).post(`/workouts/${workoutId}/unmatch-strava`).set(auth(token));
    expect(res.status).toBe(204);

    const after = await request(app).get(`/workouts/${workoutId}`).set(auth(token));
    expect(after.body.completed).toBe(false);
    expect(after.body.actualDistanceM).toBeNull();
    expect(after.body.stravaActivityId).toBeNull();
  });

  it("404s for a workout with no matched activity", async () => {
    const created = await request(app).post("/workouts").set(auth(token)).send({ discipline: "RUN", date: "2026-09-22" });
    const res = await request(app).post(`/workouts/${created.body.id}/unmatch-strava`).set(auth(token));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/workouts/some-id/unmatch-strava");
    expect(res.status).toBe(401);
  });
});
