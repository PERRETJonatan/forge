import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signupAndLogin } from "./helpers.js";
import { prisma } from "../src/db.js";

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
