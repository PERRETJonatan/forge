import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signupAndLogin } from "./helpers.js";

const app = createApp();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let token: string;

beforeEach(async () => {
  token = await signupAndLogin("athlete@example.com");
});

describe("GET /calendar-feed", () => {
  it("reports no feed until sync is enabled", async () => {
    const res = await request(app).get("/calendar-feed").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null });
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/calendar-feed");
    expect(res.status).toBe(401);
  });
});

describe("POST /calendar-feed", () => {
  it("enables sync and returns a feed URL", async () => {
    const res = await request(app).post("/calendar-feed").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https?:\/\/.+\/calendar-feed\/[0-9a-f]{48}\.ics$/);
  });

  it("rotates the token, invalidating the previous URL", async () => {
    const first = await request(app).post("/calendar-feed").set(auth(token));
    const second = await request(app).post("/calendar-feed").set(auth(token));
    expect(second.body.url).not.toBe(first.body.url);

    const oldFeedPath = new URL(first.body.url).pathname;
    const staleRes = await request(app).get(oldFeedPath);
    expect(staleRes.status).toBe(404);
  });
});

describe("DELETE /calendar-feed", () => {
  it("revokes the token so the old URL 404s", async () => {
    const enabled = await request(app).post("/calendar-feed").set(auth(token));
    const feedPath = new URL(enabled.body.url).pathname;

    const del = await request(app).delete("/calendar-feed").set(auth(token));
    expect(del.status).toBe(204);

    const res = await request(app).get(feedPath);
    expect(res.status).toBe(404);

    const status = await request(app).get("/calendar-feed").set(auth(token));
    expect(status.body).toEqual({ url: null });
  });
});

describe("GET /calendar-feed/:token.ics", () => {
  it("404s for an unknown token", async () => {
    const res = await request(app).get("/calendar-feed/does-not-exist.ics");
    expect(res.status).toBe(404);
  });

  it("serves a VCALENDAR with an all-day VEVENT per workout, unauthenticated", async () => {
    await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({
        discipline: "BIKE",
        date: "2026-09-25",
        title: "Threshold ride",
        targetDurationSec: 3600,
        targetDistanceM: 30000,
      });
    await request(app)
      .post("/workouts")
      .set(auth(token))
      .send({
        discipline: "RUN",
        date: "2026-09-26",
        title: "Long run",
        completed: true,
        actualDurationSec: 5400,
        actualDistanceM: 18000,
      });

    const enabled = await request(app).post("/calendar-feed").set(auth(token));
    const feedPath = new URL(enabled.body.url).pathname;

    const res = await request(app).get(feedPath);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/calendar");

    const body = res.text as string;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain("DTSTART;VALUE=DATE:20260925");
    expect(body).toContain("DTEND;VALUE=DATE:20260926");
    expect(body).toContain("SUMMARY:Bike: Threshold ride (planned)");
    expect(body).toContain("SUMMARY:Run: Long run");
    expect(body).toContain("STATUS:TENTATIVE");
    expect(body).toContain("STATUS:CONFIRMED");
    expect(body).toContain("Target distance: 30.0 km");
    expect(body).toContain("Actual distance: 18.0 km");
  });

  it("only includes the token owner's workouts", async () => {
    const otherToken = await signupAndLogin("other@example.com");
    await request(app)
      .post("/workouts")
      .set(auth(otherToken))
      .send({ discipline: "SWIM", date: "2026-09-27", title: "Other athlete's swim" });

    const enabled = await request(app).post("/calendar-feed").set(auth(token));
    const feedPath = new URL(enabled.body.url).pathname;

    const res = await request(app).get(feedPath);
    expect(res.text).not.toContain("Other athlete's swim");
  });
});
