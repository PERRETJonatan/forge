import { config } from "dotenv";
import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/db.js";
import { env } from "../src/env.js";

config({ path: ".env" });

// Tests log in far more often than any real client; rate-limit.test.ts turns limits back on.
env.rateLimitEnabled = false;

// Tests run against the same local Postgres instance as dev (milestone-1
// simplification — see SPEC.md, local dev only for v1). Truncate between
// tests so each test starts from a clean slate.
beforeEach(async () => {
  await prisma.workout.deleteMany();
  await prisma.workoutTemplate.deleteMany();
  await prisma.stravaActivity.deleteMany();
  await prisma.stravaConnection.deleteMany();
  await prisma.planImport.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.athlete.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
