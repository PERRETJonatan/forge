import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

const credentials = {
  email: "athlete@example.com",
  password: "correct-horse-battery-staple",
  name: "Test Athlete",
};

describe("POST /auth/signup", () => {
  it("creates an account and returns tokens", async () => {
    const res = await request(app).post("/auth/signup").send(credentials);
    expect(res.status).toBe(201);
    expect(res.body.athlete.email).toBe(credentials.email);
    expect(res.body.athlete.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  it("rejects a duplicate email", async () => {
    await request(app).post("/auth/signup").send(credentials);
    const res = await request(app).post("/auth/signup").send(credentials);
    expect(res.status).toBe(409);
  });

  it("rejects an invalid payload", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "not-an-email", password: "short", name: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    await request(app).post("/auth/signup").send(credentials);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: credentials.email, password: credentials.password });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("rejects the wrong password", async () => {
    await request(app).post("/auth/signup").send(credentials);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: credentials.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "whatever123" });
    expect(res.status).toBe(401);
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
    const signupRes = await request(app).post("/auth/signup").send(credentials);
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${signupRes.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(credentials.email);
  });
});

describe("POST /auth/refresh", () => {
  it("exchanges a valid refresh token for a new pair", async () => {
    const signupRes = await request(app).post("/auth/signup").send(credentials);
    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: signupRes.body.refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.refreshToken).not.toBe(signupRes.body.refreshToken);
  });

  it("rejects a refresh token that was already rotated", async () => {
    const signupRes = await request(app).post("/auth/signup").send(credentials);
    await request(app).post("/auth/refresh").send({ refreshToken: signupRes.body.refreshToken });
    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: signupRes.body.refreshToken });
    expect(res.status).toBe(401);
  });

  it("rejects a refresh token after logout", async () => {
    const signupRes = await request(app).post("/auth/signup").send(credentials);
    await request(app).post("/auth/logout").send({ refreshToken: signupRes.body.refreshToken });
    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: signupRes.body.refreshToken });
    expect(res.status).toBe(401);
  });
});
