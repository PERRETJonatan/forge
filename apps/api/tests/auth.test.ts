import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAthlete, setPassword } from "../src/auth/auth.service.js";
import { createTestAthlete, TEST_PASSWORD } from "./helpers.js";

const app = createApp();

const EMAIL = "athlete@example.com";

describe("account creation", () => {
  it("has no public signup endpoint", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: EMAIL, password: TEST_PASSWORD, name: "Test Athlete" });
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate email", async () => {
    await createAthlete(EMAIL, TEST_PASSWORD, "Test Athlete");
    await expect(createAthlete(EMAIL, TEST_PASSWORD, "Test Athlete")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a short password", async () => {
    await expect(createAthlete(EMAIL, "short-pass", "Test Athlete")).rejects.toMatchObject({ status: 400 });
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials, without exposing the password hash", async () => {
    await createAthlete(EMAIL, TEST_PASSWORD, "Test Athlete");
    const res = await request(app).post("/auth/login").send({ email: EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
    expect(res.body.athlete.email).toBe(EMAIL);
    expect(res.body.athlete.passwordHash).toBeUndefined();
  });

  it("rejects the wrong password", async () => {
    await createAthlete(EMAIL, TEST_PASSWORD, "Test Athlete");
    const res = await request(app).post("/auth/login").send({ email: EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with the same error as a wrong password", async () => {
    await createAthlete(EMAIL, TEST_PASSWORD, "Test Athlete");
    const unknown = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "whatever123" });
    const wrong = await request(app).post("/auth/login").send({ email: EMAIL, password: "whatever123" });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe("GET /auth/me", () => {
  it("rejects a missing token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await request(app).get("/auth/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns the athlete for a valid access token", async () => {
    const tokens = await createTestAthlete(EMAIL);
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${tokens.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(EMAIL);
  });
});

describe("POST /auth/refresh", () => {
  it("exchanges a valid refresh token for a new pair", async () => {
    const tokens = await createTestAthlete(EMAIL);
    const res = await request(app).post("/auth/refresh").send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.refreshToken).not.toBe(tokens.refreshToken);
  });

  it("rejects a refresh token that was already rotated", async () => {
    const tokens = await createTestAthlete(EMAIL);
    await request(app).post("/auth/refresh").send({ refreshToken: tokens.refreshToken });
    const res = await request(app).post("/auth/refresh").send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(401);
  });

  it("rejects a refresh token after logout", async () => {
    const tokens = await createTestAthlete(EMAIL);
    await request(app).post("/auth/logout").send({ refreshToken: tokens.refreshToken });
    const res = await request(app).post("/auth/refresh").send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(401);
  });
});

describe("setPassword", () => {
  it("replaces the password and signs out every existing session", async () => {
    const tokens = await createTestAthlete(EMAIL);
    await setPassword(EMAIL, "a-brand-new-password");

    const refreshed = await request(app).post("/auth/refresh").send({ refreshToken: tokens.refreshToken });
    expect(refreshed.status).toBe(401);
    const oldLogin = await request(app).post("/auth/login").send({ email: EMAIL, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/auth/login").send({ email: EMAIL, password: "a-brand-new-password" });
    expect(newLogin.status).toBe(200);
  });
});
