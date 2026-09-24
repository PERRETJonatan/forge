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

beforeEach(async () => {
  token = await signup("athlete@example.com");
});

describe("GET /me/thresholds", () => {
  it("defaults to all-null thresholds", async () => {
    const res = await request(app).get("/me/thresholds").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ftpWatts: null,
      runThresholdPaceSecPerKm: null,
      swimThresholdPaceSec100m: null,
      thresholdHr: null,
    });
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/me/thresholds");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /me/thresholds", () => {
  it("updates the given fields and leaves others untouched", async () => {
    await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250 });
    const res = await request(app)
      .patch("/me/thresholds")
      .set(auth(token))
      .send({ runThresholdPaceSecPerKm: 240 });

    expect(res.status).toBe(200);
    expect(res.body.ftpWatts).toBe(250);
    expect(res.body.runThresholdPaceSecPerKm).toBe(240);
  });

  it("can clear a threshold by setting it to null", async () => {
    await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250 });
    const res = await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: null });
    expect(res.status).toBe(200);
    expect(res.body.ftpWatts).toBeNull();
  });

  it("rejects a non-positive value", async () => {
    const res = await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 0 });
    expect(res.status).toBe(400);
  });

  it("doesn't leak one athlete's thresholds to another", async () => {
    const otherToken = await signup("other@example.com");
    await request(app).patch("/me/thresholds").set(auth(token)).send({ ftpWatts: 250 });

    const res = await request(app).get("/me/thresholds").set(auth(otherToken));
    expect(res.body.ftpWatts).toBeNull();
  });
});
