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

let token: string;

beforeEach(async () => {
  token = await signup("athlete@example.com");
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("POST /workouts", () => {
  it("creates a manual workout", async () => {
    const res = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-09-20", title: "Easy run", targetDurationSec: 1800 });
    expect(res.status).toBe(201);
    expect(res.body.discipline).toBe("RUN");
    expect(res.body.date).toBe("2026-09-20");
    expect(res.body.source).toBe("MANUAL");
    expect(res.body.title).toBe("Easy run");
    expect(res.body.completed).toBe(false);
  });

  it("rejects an invalid payload", async () => {
    const res = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "SCUBA", date: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/workouts").send({ discipline: "RUN", date: "2026-09-20" });
    expect(res.status).toBe(401);
  });
});

describe("GET /workouts", () => {
  it("lists only the requesting athlete's workouts", async () => {
    const otherToken = await signup("other@example.com");
    await request(app).post("/workouts").set(auth(token)).send({ discipline: "RUN", date: "2026-09-20" });
    await request(app).post("/workouts").set(auth(otherToken)).send({ discipline: "BIKE", date: "2026-09-21" });

    const res = await request(app).get("/workouts").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].discipline).toBe("RUN");
  });

  it("filters by date range and discipline", async () => {
    await request(app).post("/workouts").set(auth(token)).send({ discipline: "RUN", date: "2026-09-10" });
    await request(app).post("/workouts").set(auth(token)).send({ discipline: "BIKE", date: "2026-09-20" });
    await request(app).post("/workouts").set(auth(token)).send({ discipline: "RUN", date: "2026-10-01" });

    const res = await request(app)
      .get("/workouts")
      .query({ from: "2026-09-01", to: "2026-09-30", discipline: "BIKE" })
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe("2026-09-20");
  });

  it("filters by completed", async () => {
    await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-09-20", completed: true });
    await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-09-21", completed: false });

    const res = await request(app).get("/workouts").query({ completed: "true" }).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].completed).toBe(true);
  });
});

describe("GET /workouts/:id", () => {
  it("returns 404 for another athlete's workout", async () => {
    const otherToken = await signup("other@example.com");
    const createRes = await request(app)
      .post("/workouts")
      .set(auth(otherToken))
      .send({ discipline: "RUN", date: "2026-09-20" });

    const res = await request(app).get(`/workouts/${createRes.body.id}`).set(auth(token));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /workouts/:id", () => {
  it("updates fields and can clear an optional field", async () => {
    const createRes = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-09-20", title: "Easy run" });

    const res = await request(app)
      .patch(`/workouts/${createRes.body.id}`)
      .set(auth(token))
      .send({ completed: true, title: null });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.title).toBeNull();
  });

  it("returns 404 when updating another athlete's workout", async () => {
    const otherToken = await signup("other@example.com");
    const createRes = await request(app)
      .post("/workouts")
      .set(auth(otherToken))
      .send({ discipline: "RUN", date: "2026-09-20" });

    const res = await request(app)
      .patch(`/workouts/${createRes.body.id}`)
      .set(auth(token))
      .send({ completed: true });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /workouts/:id", () => {
  it("deletes a workout owned by the athlete", async () => {
    const createRes = await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({ discipline: "RUN", date: "2026-09-20" });

    const res = await request(app).delete(`/workouts/${createRes.body.id}`).set(auth(token));
    expect(res.status).toBe(204);

    const getRes = await request(app).get(`/workouts/${createRes.body.id}`).set(auth(token));
    expect(getRes.status).toBe(404);
  });

  it("returns 404 when deleting another athlete's workout", async () => {
    const otherToken = await signup("other@example.com");
    const createRes = await request(app)
      .post("/workouts")
      .set(auth(otherToken))
      .send({ discipline: "RUN", date: "2026-09-20" });

    const res = await request(app).delete(`/workouts/${createRes.body.id}`).set(auth(token));
    expect(res.status).toBe(404);
  });
});
