import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/env.js";
import { createTestAthlete, TEST_PASSWORD } from "./helpers.js";

// The test setup turns limits off for every other file; this one checks them, on its own app
// instance so its in-memory counters start from zero.
beforeAll(() => {
  env.rateLimitEnabled = true;
});
afterAll(() => {
  env.rateLimitEnabled = false;
});

function login(app: ReturnType<typeof createApp>, email: string, password: string, ip: string) {
  return request(app).post("/auth/login").set("X-Forwarded-For", ip).send({ email, password });
}

// Hundreds of requests per test: more than the default 5 s on a slow machine.
describe("rate limits", { timeout: 30_000 }, () => {
  it("locks an account after 10 failed logins, whatever IP they come from", async () => {
    const app = createApp();
    await createTestAthlete("victim@example.com");
    for (let i = 0; i < 10; i++) {
      const res = await login(app, "victim@example.com", "wrong-password", `203.0.113.${i}`);
      expect(res.status).toBe(401);
    }
    const blocked = await login(app, "victim@example.com", TEST_PASSWORD, "203.0.113.200");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many failed logins/);
  });

  it("doesn't count successful logins against the account", async () => {
    const app = createApp();
    await createTestAthlete("regular@example.com");
    for (let i = 0; i < 12; i++) {
      const res = await login(app, "regular@example.com", TEST_PASSWORD, `198.51.100.${i}`);
      expect(res.status).toBe(200);
    }
  });

  it("limits login attempts per IP across accounts", async () => {
    const app = createApp();
    for (let i = 0; i < 20; i++) {
      await login(app, `guess${i}@example.com`, "wrong-password", "192.0.2.7");
    }
    const blocked = await login(app, "someone-else@example.com", "wrong-password", "192.0.2.7");
    expect(blocked.status).toBe(429);
    const otherIp = await login(app, "someone-else@example.com", "wrong-password", "192.0.2.8");
    expect(otherIp.status).toBe(401);
  });

  it("sends standard RateLimit headers", async () => {
    const app = createApp();
    const res = await login(app, "nobody@example.com", "wrong-password", "192.0.2.50");
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });

  it("never throttles the health check", async () => {
    const app = createApp();
    for (let i = 0; i < 305; i++) {
      const res = await request(app).get("/health").set("X-Forwarded-For", "192.0.2.99");
      expect(res.status).toBe(200);
    }
  });
});
