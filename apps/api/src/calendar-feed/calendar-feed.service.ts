import { randomBytes } from "node:crypto";
import type { Discipline } from "@forge/shared";
import { prisma } from "../db.js";
import { buildIcsFeed } from "./ics-writer.js";

/**
 * The per-sport feeds, by the path segment in their URL (`/calendar-feed/<token>/swim.ics`),
 * with the calendar name and suggested color each gets -- the web app's discipline colors.
 */
export const SPORT_FEEDS: { slug: string; discipline: Discipline; name: string; color: string }[] = [
  { slug: "swim", discipline: "SWIM", name: "Forge · Swim", color: "#2F6FED" },
  { slug: "bike", discipline: "BIKE", name: "Forge · Bike", color: "#E8603C" },
  { slug: "run", discipline: "RUN", name: "Forge · Run", color: "#0E7C7B" },
  { slug: "strength", discipline: "STRENGTH", name: "Forge · Strength", color: "#8A5CF6" },
  { slug: "other", discipline: "OTHER", name: "Forge · Other", color: "#6B7280" },
];

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

/**
 * Renders the ICS feed for the athlete owning `token` -- every workout, or one sport's when
 * `sportSlug` is given -- or null if no athlete has the token or the sport doesn't exist.
 */
export async function renderFeed(token: string, feedHost: string, sportSlug?: string): Promise<string | null> {
  const sport = sportSlug === undefined ? null : SPORT_FEEDS.find((s) => s.slug === sportSlug);
  if (sport === undefined) return null;
  const athlete = await prisma.athlete.findUnique({ where: { calendarFeedToken: token } });
  if (!athlete) return null;

  const workouts = await prisma.workout.findMany({
    where: { athleteId: athlete.id, ...(sport ? { discipline: sport.discipline } : {}) },
    orderBy: { date: "asc" },
  });
  return buildIcsFeed(workouts, feedHost, sport ? { name: sport.name, color: sport.color } : undefined);
}
