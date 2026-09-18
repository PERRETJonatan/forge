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

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:test-1@example.com
DTSTAMP:20260901T000000Z
DTSTART:20260920T100000Z
DTEND:20260920T110000Z
SUMMARY:Easy Run
DESCRIPTION:Zone 2 easy run
END:VEVENT
END:VCALENDAR
`;

const CSV = ["Date,WorkoutType,Title", "2026-09-22,Bike,Threshold Ride"].join("\n");

describe("POST /plan-imports", () => {
  it("imports an ICS file into the calendar", async () => {
    const res = await request(app)
      .post("/plan-imports")
      .set(auth(token))
      .attach("file", Buffer.from(ICS), "plan.ics");

    expect(res.status).toBe(201);
    expect(res.body.format).toBe("ICS");
    expect(res.body.createdCount).toBe(1);
    expect(res.body.updatedCount).toBe(0);

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
    expect(workouts.body[0]).toMatchObject({ title: "Easy Run", discipline: "RUN", source: "IMPORT" });
  });

  it("updates rather than duplicates on a re-import of overlapping dates", async () => {
    await request(app).post("/plan-imports").set(auth(token)).attach("file", Buffer.from(CSV), "plan.csv");
    const res = await request(app)
      .post("/plan-imports")
      .set(auth(token))
      .attach("file", Buffer.from(CSV), "plan.csv");

    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(0);
    expect(res.body.updatedCount).toBe(1);

    const workouts = await request(app).get("/workouts").set(auth(token));
    expect(workouts.body).toHaveLength(1);
  });

  it("does not import into another athlete's calendar", async () => {
    const otherToken = await signup("other@example.com");
    await request(app).post("/plan-imports").set(auth(token)).attach("file", Buffer.from(CSV), "plan.csv");

    const workouts = await request(app).get("/workouts").set(auth(otherToken));
    expect(workouts.body).toHaveLength(0);
  });

  it("rejects an unsupported file type", async () => {
    const res = await request(app)
      .post("/plan-imports")
      .set(auth(token))
      .attach("file", Buffer.from("hello"), "plan.txt");
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/plan-imports").attach("file", Buffer.from(CSV), "plan.csv");
    expect(res.status).toBe(401);
  });
});

describe("GET /plan-imports", () => {
  it("lists past imports for the athlete, newest first", async () => {
    await request(app).post("/plan-imports").set(auth(token)).attach("file", Buffer.from(CSV), "plan.csv");
    await request(app).post("/plan-imports").set(auth(token)).attach("file", Buffer.from(ICS), "plan.ics");

    const res = await request(app).get("/plan-imports").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].filename).toBe("plan.ics");
    expect(res.body[1].filename).toBe("plan.csv");
  });
});
