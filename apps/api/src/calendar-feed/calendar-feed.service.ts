import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { buildIcsFeed } from "./ics-writer.js";

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

/** Returns the athlete's current feed token, or null if sync has never been enabled. */
export async function getToken(athleteId: string): Promise<string | null> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId } });
  return athlete.calendarFeedToken;
}

/** Enables sync (or rotates the token, invalidating any previously subscribed URL). */
export async function regenerateToken(athleteId: string): Promise<string> {
  const token = generateToken();
  await prisma.athlete.update({ where: { id: athleteId }, data: { calendarFeedToken: token } });
  return token;
}

/** Disables sync: the old feed URL starts returning 404. */
export async function revokeToken(athleteId: string): Promise<void> {
  await prisma.athlete.update({ where: { id: athleteId }, data: { calendarFeedToken: null } });
}

/** Renders the ICS feed for the athlete owning `token`, or null if no athlete has it. */
export async function renderFeed(token: string, feedHost: string): Promise<string | null> {
  const athlete = await prisma.athlete.findUnique({ where: { calendarFeedToken: token } });
  if (!athlete) return null;

  const workouts = await prisma.workout.findMany({
    where: { athleteId: athlete.id },
    orderBy: { date: "asc" },
  });
  return buildIcsFeed(workouts, feedHost);
}
