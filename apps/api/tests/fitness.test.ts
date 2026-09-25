import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signupAndLogin } from "./helpers.js";
import { prisma } from "../src/db.js";

const app = createApp();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createWorkout(token: string, body: Record<string, unknown>) {
  const res = await request(app).post("/workouts").set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

function dashboard(token: string, query: Record<string, string>) {
  return request(app).get("/fitness/dashboard").query(query).set(auth(token));
}

let token: string;

beforeEach(async () => {
  token = await signupAndLogin("athlete@example.com");
  await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250 });
});

describe("GET /fitness/dashboard", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/fitness/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns a zeroed series for an athlete with no workouts", async () => {
    const res = await dashboard(token, { from: "2026-09-01", to: "2026-09-07", today: "2026-09-07" });
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(7);
    expect(res.body.current).toEqual({ ctl: 0, atl: 0, tsb: 0 });
    expect(res.body.missingThresholds).toEqual(["runThresholdPaceSecPerKm", "swimThresholdPaceSec100m", "thresholdHr"]);
  });

  it("rolls completed workouts into CTL/ATL, including history before the charted range", async () => {
    // One hour at FTP (100 TSS) well before the range still has to seed the recurrence.
    await createWorkout(token, {
      discipline: "BIKE",
      date: "2026-08-01",
      completed: true,
      actualDurationSec: 3600,
      structuredIntervals: [{ durationSec: 3600, targetLow: 100, targetMode: "percent" }],
    });

    const res = await dashboard(token, { from: "2026-09-01", to: "2026-09-02", today: "2026-09-02" });
    expect(res.status).toBe(200);
    expect(res.body.series[0].date).toBe("2026-09-01");
    expect(res.body.series[0].ctl).toBeGreaterThan(0);
    // 31 rest days after a single 100 TSS day: CTL decays by 41/42 per day.
    expect(res.body.series[0].ctl).toBeCloseTo(Math.round((100 / 42) * (41 / 42) ** 31 * 10) / 10, 1);
  });

  it("counts TSS from a matched Strava activity's average power", async () => {
    const workout = await createWorkout(token, {
      discipline: "BIKE",
      date: "2026-09-02",
      completed: true,
      actualDurationSec: 3600,
    });
    const athlete = await prisma.athlete.findUniqueOrThrow({ where: { email: "athlete@example.com" } });
    await prisma.stravaActivity.create({
      data: {
        athleteId: athlete.id,
        stravaActivityId: 1n,
        discipline: "BIKE",
        startDate: new Date("2026-09-02T07:00:00Z"),
        durationSec: 3600,
        avgWatts: 250,
        matchedWorkoutId: workout.id,
      },
    });

    const res = await dashboard(token, { from: "2026-09-02", to: "2026-09-02", today: "2026-09-02" });
    expect(res.body.series[0].tss).toBe(100);
  });

  it("projects future days from planned workouts and flags them", async () => {
    await createWorkout(token, {
      discipline: "BIKE",
      date: "2026-09-05",
      structuredIntervals: [{ durationSec: 3600, targetLow: 250, targetUnit: "power" }],
    });

    const res = await dashboard(token, { from: "2026-09-03", to: "2026-09-05", today: "2026-09-03" });
    const [today, , future] = res.body.series;
    expect(today.projected).toBe(false);
    expect(future.projected).toBe(true);
    expect(future.tss).toBe(100);
  });

  it("does not count an uncompleted planned workout as actual load once its day has passed", async () => {
    await createWorkout(token, { discipline: "RUN", date: "2026-09-01", targetDurationSec: 3600 });

    const res = await dashboard(token, { from: "2026-09-01", to: "2026-09-01", today: "2026-09-02" });
    expect(res.body.series[0].tss).toBe(0);
    expect(res.body.weeks[0].plannedTss).toBeGreaterThan(0);
    expect(res.body.weeks[0].actualTss).toBe(0);
  });

  it("buckets weekly volume per discipline and planned vs actual TSS by Monday-start week", async () => {
    await createWorkout(token, {
      discipline: "RUN",
      date: "2026-09-21",
      completed: true,
      actualDurationSec: 1800,
      actualDistanceM: 6000,
    });
    await createWorkout(token, {
      discipline: "RUN",
      date: "2026-09-27",
      completed: true,
      actualDurationSec: 3600,
      actualDistanceM: 12000,
    });
    await createWorkout(token, { discipline: "SWIM", date: "2026-09-28", completed: true, actualDurationSec: 2700 });

    const res = await dashboard(token, { from: "2026-09-21", to: "2026-10-04", today: "2026-10-04" });
    expect(res.body.weeks.map((w: { weekStart: string }) => w.weekStart)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(res.body.weeks[0].volume.RUN).toEqual({ durationSec: 5400, distanceM: 18000 });
    expect(res.body.weeks[0].volume.SWIM).toEqual({ durationSec: 0, distanceM: 0 });
    expect(res.body.weeks[1].volume.SWIM.durationSec).toBe(2700);
    expect(res.body.weeks[0].actualTss).toBeGreaterThan(0);
  });

  it("includes the athlete's race target", async () => {
    await request(app).patch("/me/race-target").set(auth(token)).send({ raceName: "IM Kona", raceDate: "2026-10-10" });

    const res = await dashboard(token, { today: "2026-09-25" });
    expect(res.body.race).toEqual({ raceName: "IM Kona", raceDate: "2026-10-10" });
  });

  it("defaults to 12 weeks of history plus 2 weeks ahead", async () => {
    const res = await dashboard(token, { today: "2026-09-25" });
    expect(res.body.series[0].date).toBe("2026-07-03");
    expect(res.body.series.at(-1).date).toBe("2026-10-09");
  });

  it("rejects an inverted or oversized range", async () => {
    expect((await dashboard(token, { from: "2026-09-10", to: "2026-09-01" })).status).toBe(400);
    expect((await dashboard(token, { from: "2020-01-01", to: "2026-09-01" })).status).toBe(400);
  });

  it("doesn't leak one athlete's workouts into another's dashboard", async () => {
    await createWorkout(token, { discipline: "BIKE", date: "2026-09-01", completed: true, actualDurationSec: 3600 });
    const otherToken = await signupAndLogin("other@example.com");

    const res = await dashboard(otherToken, { from: "2026-09-01", to: "2026-09-01", today: "2026-09-01" });
    expect(res.body.series[0].tss).toBe(0);
  });
});

describe("/me/race-target", () => {
  it("defaults to no race", async () => {
    const res = await request(app).get("/me/race-target").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ raceName: null, raceDate: null });
  });

  it("sets and clears the race", async () => {
    const set = await request(app)
      .patch("/me/race-target")
      .set(auth(token))
      .send({ raceName: "  IM Frankfurt ", raceDate: "2027-06-27" });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ raceName: "IM Frankfurt", raceDate: "2027-06-27" });

    const cleared = await request(app).patch("/me/race-target").set(auth(token)).send({ raceName: "", raceDate: null });
    expect(cleared.body).toEqual({ raceName: null, raceDate: null });
  });

  it("rejects a malformed date", async () => {
    const res = await request(app).patch("/me/race-target").set(auth(token)).send({ raceDate: "next june" });
    expect(res.status).toBe(400);
  });
});
