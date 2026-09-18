import { config } from "dotenv";
import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/db.js";

config({ path: ".env" });

// Tests run against the same local Postgres instance as dev (milestone-1
// simplification — see SPEC.md, local dev only for v1). Truncate between
// tests so each test starts from a clean slate.
beforeEach(async () => {
  await prisma.workout.deleteMany();
  await prisma.planImport.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.athlete.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
