import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signupAndLogin } from "./helpers.js";
import { prisma } from "../src/db.js";
import { setRunnaFetcherForTesting } from "../src/runna/runna.service.js";
import { INTERVALS, LONG_RUN, STRENGTH, runnaFeed, type FeedEvent } from "./runna-feed.js";

const app = createApp();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const TODAY = "2026-09-25";

// Monday 2026-09-28 to a Sunday race 12 weeks later.
const body = {
  startDate: "2026-09-28",
  raceDistance: "HALF",
  maxWeeklyHours: 9,
  trainingDays: [0, 1, 2, 3, 5, 6],
  longRideDay: 5,
  longRunDay: 6,
  today: TODAY,
};

let token: string;

beforeEach(async () => {
  token = await signupAndLogin("athlete@example.com");
  await request(app).patch("/me/race-target").set(auth(token)).send({ raceName: "70.3 Test", raceDate: "2026-12-20" });
});

function preview(overrides: Record<string, unknown> = {}) {
  return request(app).post("/plan-generator/preview").set(auth(token)).send({ ...body, ...overrides });
}

function apply(overrides: Record<string, unknown> = {}) {
  return request(app).post("/plan-generator/apply").set(auth(token)).send({ ...body, ...overrides });
}

async function workoutsBySource() {
  const res = await request(app).get("/workouts").set(auth(token));
  const counts: Record<string, number> = {};
  for (const w of res.body) counts[w.source] = (counts[w.source] ?? 0) + 1;
  return { all: res.body as { date: string; source: string; completed: boolean }[], counts };
}

describe("POST /plan-generator/preview", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/plan-generator/preview").send(body);
    expect(res.status).toBe(401);
  });

  it("previews a plan up to the race without writing anything", async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.raceName).toBe("70.3 Test");
    expect(res.body.raceDate).toBe("2026-12-20");
    expect(res.body.weeks).toHaveLength(12);
    expect(res.body.weeks.at(-1).phase).toBe("RACE");
    expect(res.body.replacesCount).toBe(0);
    expect((await workoutsBySource()).all).toHaveLength(0);
  });

  it("starts from 40% of peak hours for an athlete with no training history", async () => {
    const res = await preview();
    expect(res.body.startingHours).toBe(3.6);
  });

  it("asks for a race target first", async () => {
    await request(app).patch("/me/race-target").set(auth(token)).send({ raceDate: null });
    const res = await preview();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target race/);
  });

  it("rejects a start date in the past, or a race too close/far away", async () => {
    expect((await preview({ startDate: "2026-09-20" })).status).toBe(400);
    expect((await preview({ startDate: "2026-12-14" })).status).toBe(400);
  });

  it("requires the long days to be distinct training days", async () => {
    expect((await preview({ longRideDay: 4 })).status).toBe(400);
    const same = await preview({ longRunDay: 5 });
    expect(same.status).toBe(400);
    expect(same.body.error).toMatch(/different days/);
  });
});

describe("POST /plan-generator/apply", () => {
  it("writes exactly the previewed workouts as source GENERATED", async () => {
    const planned = (await preview()).body;
    const res = await apply();
    expect(res.status).toBe(200);

    const total = planned.weeks.reduce((n: number, w: { workouts: unknown[] }) => n + w.workouts.length, 0);
    expect(res.body).toEqual({ created: total, deleted: 0 });
    const { counts } = await workoutsBySource();
    expect(counts).toEqual({ GENERATED: total });
  });

  it("regenerating replaces the previous generated plan, but keeps completed and hand-built workouts", async () => {
    await apply();
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { email: "athlete@example.com" } });
    const firstGenerated = await prisma.workout.findFirstOrThrow({ where: { athleteId: athlete.id, source: "GENERATED" }, orderBy: { date: "asc" } });
    await prisma.workout.update({ where: { id: firstGenerated.id }, data: { completed: true } });
    const manual = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-10-14", title: "Club track night" });
    expect(manual.status).toBe(201);

    const secondPreview = (await preview({ maxWeeklyHours: 7 })).body;
    expect(secondPreview.keptDates).toContain("2026-10-14");
    expect(secondPreview.keptDates).toContain(firstGenerated.date.toISOString().slice(0, 10));

    const before = (await workoutsBySource()).counts.GENERATED;
    const res = await apply({ maxWeeklyHours: 7 });
    expect(res.body.deleted).toBe(before - 1);

    const { all } = await workoutsBySource();
    // The hand-built workout and the completed one survive, and nothing new lands on their days.
    expect(all.filter((w) => w.date === "2026-10-14").map((w) => w.source)).toEqual(["MANUAL"]);
    expect(all.filter((w) => w.date === firstGenerated.date.toISOString().slice(0, 10))).toHaveLength(1);
    expect(all.find((w) => w.completed)?.source).toBe("GENERATED");
  });

  it("doesn't touch another athlete's calendar", async () => {
    const otherToken = await signupAndLogin("other@example.com");
    await request(app).patch("/me/race-target").set(auth(otherToken)).send({ raceDate: "2026-12-20" });
    await request(app).post("/plan-generator/apply").set(auth(otherToken)).send(body);

    await apply();
    const res = await request(app).post("/plan-generator/apply").set(auth(otherToken)).send(body);
    expect(res.body.deleted).toBe(res.body.created);
    expect((await workoutsBySource()).counts.GENERATED).toBeGreaterThan(0);
  });
});

describe("running from Runna", () => {
  // A Runna plan over the whole window (2026-09-28 .. race 2026-12-20): Tue intervals, Wed gym, Sun long run.
  function runnaPlan(): FeedEvent[] {
    const events: FeedEvent[] = [];
    for (let week = 0; week < 12; week++) {
      const monday = new Date(Date.parse("2026-09-28T00:00:00Z") + week * 7 * 86_400_000);
      const day = (d: number) => new Date(monday.getTime() + d * 86_400_000).toISOString().slice(0, 10);
      events.push(
        { dayId: `plan_week_${week}_INTERVALS_0`, date: day(1), ...INTERVALS },
        { dayId: `plan_week_${week}_LEGS_AND_CORE_0`, date: day(2), ...STRENGTH },
        { dayId: `plan_week_${week}_LONG_RUN_0`, date: day(6), ...LONG_RUN },
      );
    }
    return events;
  }

  async function connectRunna() {
    setRunnaFetcherForTesting(async () => runnaFeed(runnaPlan()));
    const res = await request(app).put("/runna").set(auth(token)).send({ feedUrl: "https://cal.runna.com/0123456789abcdef.ics" });
    setRunnaFetcherForTesting(null);
    expect(res.status).toBe(200);
  }

  it("needs Runna connected", async () => {
    const res = await preview({ runningFromRunna: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Runna/);
  });

  it("plans swim and bike around the Runna workouts instead of leaving their days out", async () => {
    await connectRunna();
    const res = await preview({ runningFromRunna: true, strengthSessionsPerWeek: 2 });
    expect(res.status).toBe(200);
    const workouts = res.body.weeks.flatMap((w: { workouts: { discipline: string }[] }) => w.workouts);
    expect(new Set(workouts.map((w: { discipline: string }) => w.discipline))).toEqual(new Set(["SWIM", "BIKE"]));
    expect(res.body.keptDates).toEqual([]);
    expect(res.body.weeks[1].runnaHours).toBeGreaterThan(0);
  });

  it("doesn't need a separate long run day", async () => {
    await connectRunna();
    const res = await preview({ runningFromRunna: true, longRunDay: 5, longRideDay: 5 });
    expect(res.status).toBe(200);
  });

  it("regenerating replaces the old plan's runs and gym sessions and keeps the Runna ones", async () => {
    await apply({ strengthSessionsPerWeek: 2 });
    const before = await prisma.workout.groupBy({ by: ["discipline"], where: { source: "GENERATED" }, _count: true });
    expect(before.map((g) => g.discipline)).toEqual(expect.arrayContaining(["RUN", "STRENGTH"]));

    await connectRunna();
    const res = await apply({ runningFromRunna: true });
    expect(res.status).toBe(200);

    const generated = await prisma.workout.findMany({ where: { source: "GENERATED" }, select: { discipline: true } });
    expect(new Set(generated.map((w) => w.discipline))).toEqual(new Set(["SWIM", "BIKE"]));
    expect(await prisma.workout.count({ where: { source: "RUNNA" } })).toBe(36);
  });
});

describe("GET /plan-generator/defaults", () => {
  it("suggests the middle of the usual range when there's no training history and no Runna plan", async () => {
    const res = await request(app).get("/plan-generator/defaults").query({ today: TODAY }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentWeeklyHours: 0,
      suggestedPeakHours: {
        SPRINT: { planned: 6.5, withRunna: null },
        OLYMPIC: { planned: 8.5, withRunna: null },
        HALF: { planned: 12, withRunna: null },
        FULL: { planned: 15.5, withRunna: null },
      },
      runnaPlanEnd: null,
      runnaPeakWeekHours: null,
    });
  });

  it("with a Runna plan, reports when it ends and keeps room for swim and bike beside its biggest week", async () => {
    // Four heavy Runna weeks of ~5.5 h: intervals 50 min + gym 65 min + long run 3 x 70 min.
    const heavyLongRun = { ...LONG_RUN, estimatedSec: 3 * 70 * 60 };
    setRunnaFetcherForTesting(async () =>
      runnaFeed(
        [0, 1, 2, 3].flatMap((week) => {
          const day = (d: number) => new Date(Date.parse("2026-09-28T00:00:00Z") + (week * 7 + d) * 86_400_000).toISOString().slice(0, 10);
          return [
            { dayId: `plan_week_${week}_INTERVALS_0`, date: day(1), ...INTERVALS },
            { dayId: `plan_week_${week}_LEGS_AND_CORE_0`, date: day(2), ...STRENGTH },
            { dayId: `plan_week_${week}_LONG_RUN_0`, date: day(6), ...heavyLongRun },
          ];
        }),
      ),
    );
    await request(app).put("/runna").set(auth(token)).send({ feedUrl: "https://cal.runna.com/0123456789abcdef.ics" });
    setRunnaFetcherForTesting(null);

    const res = await request(app).get("/plan-generator/defaults").query({ today: TODAY }).set(auth(token));
    expect(res.body.runnaPlanEnd).toBe("2026-10-25");
    expect(res.body.runnaPeakWeekHours).toBe(5.4);
    // A sprint's usual 6.5 h can't hold 5.4 h of Runna plus a sprint's swim and bike: raised.
    expect(res.body.suggestedPeakHours.SPRINT.withRunna).toBeGreaterThan(res.body.suggestedPeakHours.SPRINT.planned);
    for (const d of ["SPRINT", "OLYMPIC", "HALF", "FULL"]) {
      expect(res.body.suggestedPeakHours[d].withRunna).toBeGreaterThanOrEqual(res.body.suggestedPeakHours[d].planned);
    }
  });
});
