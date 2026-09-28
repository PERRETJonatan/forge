import type { CoachStatus } from "@forge/shared";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { normalizeDraft } from "../src/coach/coach-draft.js";
import { setCoachLlmForTesting } from "../src/coach/coach.service.js";
import { CoachLlmError, type ChatTurn, type CoachLlm } from "../src/coach/ollama-client.js";
import { prisma } from "../src/db.js";
import { signupAndLogin } from "./helpers.js";

const app = createApp();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Answers with whatever the test queues, and records what it was sent. */
class FakeCoachLlm implements CoachLlm {
  answers: (object | string | Error)[] = [];
  calls: { messages: ChatTurn[]; schema: object }[] = [];

  async chat(messages: ChatTurn[], schema: object): Promise<string> {
    this.calls.push({ messages, schema });
    const next = this.answers.shift() ?? { reply: "Keep it up.", workout: null };
    if (next instanceof Error) throw next;
    return typeof next === "string" ? next : JSON.stringify(next);
  }

  async status(): Promise<CoachStatus> {
    return { model: "fake", available: true, error: null };
  }

  get systemPrompt(): string {
    return this.calls.at(-1)!.messages[0].content;
  }
}

const SWEET_SPOT = {
  title: "Sweet spot 3x12",
  discipline: "BIKE",
  date: "2026-09-29",
  sets: [
    { repeat: 1, steps: [{ label: "Warm-up", minutes: 15, meters: 0, targetType: "power", targetValue: 60 }] },
    {
      repeat: 3,
      steps: [
        { label: "Sweet spot", minutes: 12, meters: 0, targetType: "power", targetValue: 90 },
        { label: "Easy", minutes: 4, meters: 0, targetType: "power", targetValue: 55 },
      ],
    },
    { repeat: 1, steps: [{ label: "Cool-down", minutes: 10, meters: 0, targetType: "none", targetValue: 0 }] },
  ],
};

const THRESHOLDS = { ftpWatts: 250, runThresholdPaceSecPerKm: null, swimThresholdPaceSec100m: null, thresholdHr: null };

let llm: FakeCoachLlm;
let token: string;

beforeEach(async () => {
  llm = new FakeCoachLlm();
  setCoachLlmForTesting(llm);
  token = await signupAndLogin("athlete@example.com");
});

afterEach(() => {
  setCoachLlmForTesting(null);
});

describe("coach messages", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/coach/messages")).status).toBe(401);
    expect((await request(app).post("/coach/messages").send({ content: "hi" })).status).toBe(401);
  });

  it("starts with an empty history", async () => {
    const res = await request(app).get("/coach/messages").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("stores the question and the reply, and returns them in order", async () => {
    llm.answers.push({ reply: "Your form is fine.", workout: null });

    const res = await request(app)
      .post("/coach/messages")
      .set(auth(token))
      .send({ content: "How's my form?", today: "2026-09-28" });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ role: "USER", content: "How's my form?", draft: null });
    expect(res.body.reply).toMatchObject({ role: "ASSISTANT", content: "Your form is fine.", draft: null });

    const history = await request(app).get("/coach/messages").set(auth(token));
    expect(history.body.map((m: { role: string }) => m.role)).toEqual(["USER", "ASSISTANT"]);
  });

  it("sends the athlete's training data and earlier turns to the model", async () => {
    await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250, thresholdHr: 165 });
    await request(app).patch("/me/race-target").set(auth(token)).send({ raceName: "Ironman Nice", raceDate: "2026-11-01" });
    await request(app).post("/workouts").set(auth(token)).send({
      discipline: "BIKE",
      date: "2026-09-26",
      title: "Long ride",
      actualDurationSec: 3 * 3600,
      completed: true,
    });
    await request(app).post("/workouts").set(auth(token)).send({
      discipline: "RUN",
      date: "2026-09-30",
      title: "Tempo run",
      targetDurationSec: 3600,
    });

    await request(app).post("/coach/messages").set(auth(token)).send({ content: "First question", today: "2026-09-28" });
    await request(app).post("/coach/messages").set(auth(token)).send({ content: "Follow-up", today: "2026-09-28" });

    const prompt = llm.systemPrompt;
    expect(prompt).toContain("Today is Mon 2026-09-28.");
    expect(prompt).toContain("Ironman Nice on 2026-11-01 (34 days away)");
    expect(prompt).toContain("FTP: 250 W");
    expect(prompt).toContain("Threshold HR: 165 bpm");
    expect(prompt).toContain("Run threshold pace: not set");
    expect(prompt).toMatch(/CTL \d+\.\d, ATL \d+\.\d, TSB [+-]\d+\.\d/);
    expect(prompt).toMatch(/Sat 2026-09-26, BIKE, "Long ride", 3h, TSS \d+/);
    expect(prompt).toMatch(/Wed 2026-09-30, RUN, "Tempo run", 1h/);

    const turns = llm.calls[1].messages.slice(1).map((m) => [m.role, m.content]);
    expect(turns).toEqual([
      ["user", "First question"],
      ["assistant", "Keep it up."],
      ["user", "Follow-up"],
    ]);
  });

  it("keeps a proposed workout as a builder-ready draft with a server-computed TSS", async () => {
    await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250 });
    llm.answers.push({ reply: "Try this sweet spot session.", workout: { ...SWEET_SPOT, estimatedTss: 999 } });

    const res = await request(app)
      .post("/coach/messages")
      .set(auth(token))
      .send({ content: "Give me a sweet spot ride for tomorrow", today: "2026-09-28" });
    expect(res.status).toBe(201);

    const draft = res.body.reply.draft;
    expect(draft).toMatchObject({ title: "Sweet spot 3x12", discipline: "BIKE", date: "2026-09-29", durationSec: 73 * 60 });
    expect(draft.steps).toEqual([
      { label: "Warm-up", durationSec: 900, targetUnit: "power", targetMode: "percent", targetLow: 60 },
      {
        repeat: 3,
        steps: [
          { label: "Sweet spot", durationSec: 720, targetUnit: "power", targetMode: "percent", targetLow: 90 },
          { label: "Easy", durationSec: 240, targetUnit: "power", targetMode: "percent", targetLow: 55 },
        ],
      },
      { label: "Cool-down", durationSec: 600 },
    ]);
    expect(draft.estimatedTss).toBeGreaterThan(50);
    expect(draft.estimatedTss).toBeLessThan(90);

    // Proposing a workout never touches the calendar.
    expect(await prisma.workout.count()).toBe(0);

    const history = await request(app).get("/coach/messages").set(auth(token));
    expect(history.body[1].draft).toEqual(draft);
  });

  it("stores nothing when the model is unreachable, so the athlete can resend", async () => {
    llm.answers.push(new CoachLlmError("The coach is offline: can't reach the Ollama server.", 503));

    const res = await request(app).post("/coach/messages").set(auth(token)).send({ content: "Hello?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/offline/);
    expect(await prisma.coachMessage.count()).toBe(0);
  });

  it("rejects a garbled model answer without storing it", async () => {
    llm.answers.push("not json at all");
    const res = await request(app).post("/coach/messages").set(auth(token)).send({ content: "Hello?" });
    expect(res.status).toBe(502);
    expect(await prisma.coachMessage.count()).toBe(0);
  });

  it("rejects an empty or oversized message", async () => {
    expect((await request(app).post("/coach/messages").set(auth(token)).send({ content: "   " })).status).toBe(400);
    expect((await request(app).post("/coach/messages").set(auth(token)).send({ content: "x".repeat(4001) })).status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });

  it("keeps each athlete's conversation private, and clears only their own", async () => {
    const other = await signupAndLogin("other@example.com");
    await request(app).post("/coach/messages").set(auth(token)).send({ content: "Mine" });
    await request(app).post("/coach/messages").set(auth(other)).send({ content: "Theirs" });

    const mine = await request(app).get("/coach/messages").set(auth(token));
    expect(mine.body.map((m: { content: string }) => m.content)).toEqual(["Mine", "Keep it up."]);
    // The other athlete's question never reaches this athlete's prompt either.
    expect(llm.calls[1].messages.some((m) => m.content.includes("Mine"))).toBe(false);

    expect((await request(app).delete("/coach/messages").set(auth(token))).status).toBe(204);
    expect((await request(app).get("/coach/messages").set(auth(token))).body).toEqual([]);
    expect((await request(app).get("/coach/messages").set(auth(other))).body).toHaveLength(2);
  });
});

describe("POST /coach/draft", () => {
  it("drafts a workout for the builder without adding it to the chat or the calendar", async () => {
    llm.answers.push({ note: "Classic sweet spot to build FTP.", workout: SWEET_SPOT });

    const res = await request(app)
      .post("/coach/draft")
      .set(auth(token))
      .send({ request: "90 minute sweet spot ride", discipline: "BIKE", today: "2026-09-28" });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe("Classic sweet spot to build FTP.");
    expect(res.body.draft.title).toBe("Sweet spot 3x12");
    expect(llm.calls[0].messages.at(-1)!.content).toContain("The builder is set to BIKE");

    expect(await prisma.coachMessage.count()).toBe(0);
    expect(await prisma.workout.count()).toBe(0);
  });

  it("fails clearly when the model's workout has nothing usable in it", async () => {
    llm.answers.push({ note: "Hmm", workout: { title: "Empty", discipline: "RUN", date: null, sets: [] } });
    const res = await request(app).post("/coach/draft").set(auth(token)).send({ request: "something" });
    expect(res.status).toBe(502);
  });
});

describe("POST /workouts with a coach draft", () => {
  it("records a reviewed coach draft as source COACH_DRAFT, and refuses server-only sources", async () => {
    const saved = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "BIKE", date: "2026-09-29", source: "COACH_DRAFT" });
    expect(saved.status).toBe(201);
    expect(saved.body.source).toBe("COACH_DRAFT");

    const forged = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "BIKE", date: "2026-09-29", source: "STRAVA" });
    expect(forged.status).toBe(400);
  });
});

describe("normalizeDraft", () => {
  const step = (overrides: Record<string, unknown>) => ({
    label: "Step",
    minutes: 10,
    meters: 0,
    targetType: "none",
    targetValue: 0,
    ...overrides,
  });
  const workout = (discipline: string, steps: unknown[], extra: Record<string, unknown> = {}) => ({
    title: "W",
    discipline,
    date: null,
    sets: [{ repeat: 1, steps }],
    ...extra,
  });

  it("maps pace to the discipline's pace unit and drops targets the discipline can't use", () => {
    const run = normalizeDraft(workout("RUN", [step({ targetType: "pace", targetValue: 85 })]), THRESHOLDS, "2026-09-28");
    expect(run!.steps[0]).toMatchObject({ targetUnit: "pace_sec_per_km", targetMode: "percent", targetLow: 85 });

    const swim = normalizeDraft(workout("SWIM", [step({ targetType: "pace", targetValue: 95 })]), THRESHOLDS, "2026-09-28");
    expect(swim!.steps[0]).toMatchObject({ targetUnit: "pace_sec_per_100m" });

    const runPower = normalizeDraft(workout("RUN", [step({ targetType: "power", targetValue: 90 })]), THRESHOLDS, "2026-09-28");
    expect(runPower!.steps[0].targetUnit).toBeUndefined();
  });

  it("drops out-of-range targets instead of passing them through", () => {
    const draft = normalizeDraft(
      workout("BIKE", [step({ targetType: "power", targetValue: 250 }), step({ targetType: "rpe", targetValue: 14 })]),
      THRESHOLDS,
      "2026-09-28",
    );
    expect(draft!.steps.map((s) => s.targetUnit)).toEqual([undefined, undefined]);
  });

  it("flattens repeat-1 sets, drops empty steps, and clamps the repeat count", () => {
    const draft = normalizeDraft(
      {
        title: "Intervals",
        discipline: "BIKE",
        date: null,
        sets: [
          { repeat: 1, steps: [step({ label: "A" }), step({ label: "Nothing", minutes: 0 })] },
          { repeat: 500, steps: [step({ label: "B" })] },
          { repeat: 3, steps: [] },
        ],
      },
      THRESHOLDS,
      "2026-09-28",
    );
    expect(draft!.steps).toEqual([
      { label: "A", durationSec: 600 },
      { repeat: 30, steps: [{ label: "B", durationSec: 600 }] },
    ]);
  });

  it("runs a warm-up and cool-down once even when the model puts them inside a repeated set", () => {
    const draft = normalizeDraft(
      {
        title: "Sweet spot",
        discipline: "BIKE",
        date: null,
        sets: [
          {
            repeat: 4,
            steps: [
              step({ label: "Warm-up", minutes: 15 }),
              step({ label: "Sweet spot", minutes: 10 }),
              step({ label: "Cool-down", minutes: 10 }),
            ],
          },
        ],
      },
      THRESHOLDS,
      "2026-09-28",
    );
    expect(draft!.steps).toEqual([
      { label: "Warm-up", durationSec: 900 },
      { repeat: 4, steps: [{ label: "Sweet spot", durationSec: 600 }] },
      { label: "Cool-down", durationSec: 600 },
    ]);
    expect(draft!.durationSec).toBe(65 * 60);
  });

  it("keeps a distance-only swim step, and only real, non-past dates", () => {
    const swim = normalizeDraft(workout("SWIM", [step({ minutes: 0, meters: 400 })], { date: "2026-10-01" }), THRESHOLDS, "2026-09-28");
    expect(swim!.steps[0]).toEqual({ label: "Step", distanceM: 400 });
    expect(swim!.date).toBe("2026-10-01");

    const past = normalizeDraft(workout("RUN", [step({})], { date: "2026-09-01" }), THRESHOLDS, "2026-09-28");
    expect(past!.date).toBeNull();
    const bogus = normalizeDraft(workout("RUN", [step({})], { date: "2026-02-30" }), THRESHOLDS, "2026-09-28");
    expect(bogus!.date).toBeNull();
  });

  it("returns null for an unknown discipline or a workout with no usable steps", () => {
    expect(normalizeDraft(workout("YOGA", [step({})]), THRESHOLDS, "2026-09-28")).toBeNull();
    expect(normalizeDraft(workout("RUN", [step({ minutes: 0 })]), THRESHOLDS, "2026-09-28")).toBeNull();
    expect(normalizeDraft("nonsense", THRESHOLDS, "2026-09-28")).toBeNull();
  });
});
