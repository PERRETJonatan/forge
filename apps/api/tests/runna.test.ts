import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { normalizeFeedUrl, setRunnaFetcherForTesting, syncStaleFeeds } from "../src/runna/runna.service.js";
import { signupAndLogin } from "./helpers.js";
import { INTERVALS, LONG_RUN, STRENGTH, runnaFeed, type FeedEvent } from "./runna-feed.js";

const app = createApp();
const FEED_URL = "https://cal.runna.com/0123456789abcdef0123456789abcdef.ics";

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function daysFromToday(delta: number): string {
  return new Date(Date.now() + delta * 86_400_000).toISOString().slice(0, 10);
}

/** What the fake Runna serves, and which URLs were asked for. */
let served: FeedEvent[] = [];
let fetched: string[] = [];

beforeEach(() => {
  served = [
    { dayId: "plan_week_1_EASY_RUN_0", date: daysFromToday(1), ...LONG_RUN },
    { dayId: "plan_week_1_LEGS_AND_CORE_0", date: daysFromToday(2), ...STRENGTH },
    { dayId: "plan_week_1_INTERVALS_0", date: daysFromToday(3), ...INTERVALS },
  ];
  fetched = [];
  setRunnaFetcherForTesting(async (url) => {
    fetched.push(url);
    return runnaFeed(served);
  });
});

afterEach(() => {
  setRunnaFetcherForTesting(null);
});

async function runnaWorkouts(token: string) {
  const res = await request(app).get("/workouts").set(auth(token));
  return (res.body as { id: string; source: string; date: string; title: string }[])
    .filter((w) => w.source === "RUNNA")
    .sort((a, b) => a.date.localeCompare(b.date));
}

describe("normalizeFeedUrl", () => {
  it("accepts the link as Runna shows it and nothing else", () => {
    expect(normalizeFeedUrl(` webcal://cal.runna.com/0123456789abcdef.ics `)).toBe("https://cal.runna.com/0123456789abcdef.ics");
    expect(normalizeFeedUrl("http://cal.runna.com/0123456789abcdef.ics")).toBe("https://cal.runna.com/0123456789abcdef.ics");
    for (const bad of [
      "https://evil.example/0123456789abcdef.ics",
      "https://cal.runna.com.evil.example/0123456789abcdef.ics",
      "https://cal.runna.com/../admin.ics",
      "https://cal.runna.com/0123456789abcdef.ics?x=1",
      "https://user@cal.runna.com/0123456789abcdef.ics",
      "http://localhost:3000/0123456789abcdef.ics",
    ]) {
      expect(normalizeFeedUrl(bad)).toBeNull();
    }
  });
});

describe("Runna sync", () => {
  it("connects with a valid link and imports the upcoming plan", async () => {
    const token = await signupAndLogin("runna@example.com");
    const res = await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL.replace("https", "webcal") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inFeed: 3, created: 3, updated: 0, removed: 0 });
    expect(fetched).toEqual([FEED_URL]);

    const workouts = await runnaWorkouts(token);
    expect(workouts.map((w) => w.title)).toEqual(["8km Long Run", "Loading Up", "1km Repeats"]);

    const status = await request(app).get("/runna").set(auth(token));
    expect(status.body.feedUrl).toBe("https://cal.runna.com/0123…cdef.ics");
    expect(status.body.lastSyncAt).not.toBeNull();
    expect(status.body.lastSyncError).toBeNull();
  });

  it("refuses links that aren't Runna calendar links, without fetching them", async () => {
    const token = await signupAndLogin("runna@example.com");
    const res = await request(app).put("/runna").set(auth(token)).send({ feedUrl: "http://169.254.169.254/latest.ics" });
    expect(res.status).toBe(400);
    expect(fetched).toEqual([]);
    expect((await request(app).get("/runna").set(auth(token))).body.feedUrl).toBeNull();
  });

  it("doesn't save a link whose feed can't be fetched", async () => {
    const token = await signupAndLogin("runna@example.com");
    setRunnaFetcherForTesting(async () => {
      throw new Error("network down");
    });
    const res = await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL });
    expect(res.status).toBe(502);
    expect((await request(app).get("/runna").set(auth(token))).body.feedUrl).toBeNull();
  });

  it("re-syncing is idempotent, follows moved workouts and drops future ones the plan removed", async () => {
    const token = await signupAndLogin("runna@example.com");
    await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL });

    const again = await request(app).post("/runna/sync").set(auth(token));
    expect(again.body).toEqual({ inFeed: 3, created: 0, updated: 0, removed: 0 });

    // Runna moves the intervals by a day and drops the strength session.
    served = [served[0], { ...served[2], date: daysFromToday(4) }];
    const changed = await request(app).post("/runna/sync").set(auth(token));
    expect(changed.body).toEqual({ inFeed: 2, created: 0, updated: 1, removed: 1 });

    const workouts = await runnaWorkouts(token);
    expect(workouts.map((w) => [w.title, w.date])).toEqual([
      ["8km Long Run", daysFromToday(1)],
      ["1km Repeats", daysFromToday(4)],
    ]);
  });

  it("leaves past and completed Runna workouts alone when the plan drops them", async () => {
    const token = await signupAndLogin("runna@example.com");
    served = [
      { dayId: "past", date: daysFromToday(-3), ...LONG_RUN },
      { dayId: "done", date: daysFromToday(1), ...INTERVALS },
    ];
    await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL });
    const done = (await runnaWorkouts(token)).find((w) => w.title === "1km Repeats")!;
    await request(app).patch(`/workouts/${done.id}`).set(auth(token)).send({ completed: true });

    served = [];
    const res = await request(app).post("/runna/sync").set(auth(token));
    expect(res.body.removed).toBe(0);
    expect((await runnaWorkouts(token)).map((w) => w.title)).toEqual(["8km Long Run", "1km Repeats"]);
  });

  it("records a failed sync so Settings can show it, and clears it on the next success", async () => {
    const token = await signupAndLogin("runna@example.com");
    await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL });

    setRunnaFetcherForTesting(async () => {
      throw new Error("network down");
    });
    expect((await request(app).post("/runna/sync").set(auth(token))).status).toBe(502);
    expect((await request(app).get("/runna").set(auth(token))).body.lastSyncError).toMatch(/Couldn't reach Runna/);

    setRunnaFetcherForTesting(async () => runnaFeed(served));
    expect((await request(app).post("/runna/sync").set(auth(token))).status).toBe(200);
    expect((await request(app).get("/runna").set(auth(token))).body.lastSyncError).toBeNull();
  });

  it("disconnecting forgets the link and removes only the upcoming Runna workouts", async () => {
    const token = await signupAndLogin("runna@example.com");
    served = [
      { dayId: "past", date: daysFromToday(-3), ...LONG_RUN },
      { dayId: "future", date: daysFromToday(2), ...INTERVALS },
    ];
    await request(app).put("/runna").set(auth(token)).send({ feedUrl: FEED_URL });

    expect((await request(app).delete("/runna").set(auth(token))).status).toBe(204);
    expect((await runnaWorkouts(token)).map((w) => w.title)).toEqual(["8km Long Run"]);
    expect((await request(app).get("/runna").set(auth(token))).body.feedUrl).toBeNull();
    expect((await request(app).post("/runna/sync").set(auth(token))).status).toBe(400);
  });

  it("keeps each athlete's Runna workouts separate", async () => {
    const a = await signupAndLogin("a@example.com");
    const b = await signupAndLogin("b@example.com");
    await request(app).put("/runna").set(auth(a)).send({ feedUrl: FEED_URL });
    await request(app).put("/runna").set(auth(b)).send({ feedUrl: FEED_URL });
    expect(await runnaWorkouts(a)).toHaveLength(3);
    expect(await runnaWorkouts(b)).toHaveLength(3);
    await request(app).delete("/runna").set(auth(a));
    expect(await runnaWorkouts(b)).toHaveLength(3);
  });

  it("the background pass re-syncs only plans last synced over six hours ago", async () => {
    const stale = await signupAndLogin("stale@example.com");
    const fresh = await signupAndLogin("fresh@example.com");
    await request(app).put("/runna").set(auth(stale)).send({ feedUrl: FEED_URL });
    await request(app).put("/runna").set(auth(fresh)).send({ feedUrl: FEED_URL });
    await prisma.athlete.update({
      where: { email: "stale@example.com" },
      data: { runnaLastSyncAt: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    });
    fetched = [];

    await syncStaleFeeds();

    expect(fetched).toEqual([FEED_URL]);
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { email: "stale@example.com" } });
    expect(Date.now() - athlete.runnaLastSyncAt!.getTime()).toBeLessThan(60_000);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/runna")).status).toBe(401);
  });
});
