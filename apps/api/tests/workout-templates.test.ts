import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

async function signup(email: string) {
  const res = await request(app)
    .post("/auth/signup")
    .send({ email, password: "correct-horse-battery-staple", name: "Test Athlete" });
  return res.body.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let token: string;

const STEPS = [
  { label: "Warm-up", durationSec: 600, targetLow: 50, targetHigh: 60, targetUnit: "power", targetMode: "percent" },
  {
    repeat: 4,
    steps: [
      { label: "On", durationSec: 240, targetLow: 105, targetUnit: "power", targetMode: "percent" },
      { label: "Off", durationSec: 120, targetLow: 50, targetUnit: "power", targetMode: "percent" },
    ],
  },
];

beforeEach(async () => {
  token = await signup("athlete@example.com");
});

describe("POST /workout-templates", () => {
  it("creates a template", async () => {
    const res = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Sweet spot 4x4", discipline: "BIKE", steps: STEPS });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Sweet spot 4x4");
    expect(res.body.discipline).toBe("BIKE");
    expect(res.body.steps).toEqual(STEPS);
  });

  it("rejects malformed steps", async () => {
    const res = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Bad", discipline: "BIKE", steps: [{ repeat: "six" }] });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/workout-templates")
      .send({ name: "Sweet spot", discipline: "BIKE", steps: STEPS });
    expect(res.status).toBe(401);
  });
});

describe("GET /workout-templates", () => {
  it("only lists the requesting athlete's templates", async () => {
    const otherToken = await signup("other@example.com");
    await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Mine", discipline: "BIKE", steps: STEPS });
    await request(app)
      .post("/workout-templates")
      .set(auth(otherToken))
      .send({ name: "Theirs", discipline: "RUN", steps: STEPS });

    const res = await request(app).get("/workout-templates").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Mine");
  });
});

describe("PATCH /workout-templates/:id", () => {
  it("renames a template", async () => {
    const created = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Draft", discipline: "BIKE", steps: STEPS });

    const res = await request(app)
      .patch(`/workout-templates/${created.body.id}`)
      .set(auth(token))
      .send({ name: "Sweet spot 4x4" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Sweet spot 4x4");
  });

  it("404s for another athlete's template", async () => {
    const otherToken = await signup("other@example.com");
    const created = await request(app)
      .post("/workout-templates")
      .set(auth(otherToken))
      .send({ name: "Theirs", discipline: "BIKE", steps: STEPS });

    const res = await request(app)
      .patch(`/workout-templates/${created.body.id}`)
      .set(auth(token))
      .send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /workout-templates/:id", () => {
  it("deletes a template", async () => {
    const created = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Draft", discipline: "BIKE", steps: STEPS });

    const del = await request(app).delete(`/workout-templates/${created.body.id}`).set(auth(token));
    expect(del.status).toBe(204);

    const get = await request(app).get(`/workout-templates/${created.body.id}`).set(auth(token));
    expect(get.status).toBe(404);
  });
});

describe("POST /workout-templates/:id/apply", () => {
  it("creates a manual workout from the template's steps on the given date", async () => {
    const created = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Sweet spot 4x4", discipline: "BIKE", steps: STEPS });

    const res = await request(app)
      .post(`/workout-templates/${created.body.id}/apply`)
      .set(auth(token))
      .send({ date: "2026-10-05" });

    expect(res.status).toBe(201);
    expect(res.body.discipline).toBe("BIKE");
    expect(res.body.date).toBe("2026-10-05");
    expect(res.body.source).toBe("MANUAL");
    expect(res.body.title).toBe("Sweet spot 4x4");
    expect(res.body.structuredIntervals).toEqual(STEPS);

    const inCalendar = await request(app).get("/workouts").set(auth(token));
    expect(inCalendar.body).toHaveLength(1);
  });

  it("can apply the same template to multiple dates (repeat on a schedule)", async () => {
    const created = await request(app)
      .post("/workout-templates")
      .set(auth(token))
      .send({ name: "Sweet spot 4x4", discipline: "BIKE", steps: STEPS });

    for (const date of ["2026-10-06", "2026-10-13", "2026-10-20"]) {
      const res = await request(app)
        .post(`/workout-templates/${created.body.id}/apply`)
        .set(auth(token))
        .send({ date });
      expect(res.status).toBe(201);
    }

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(3);
  });
});
