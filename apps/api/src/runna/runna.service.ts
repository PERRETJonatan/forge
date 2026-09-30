import type { Prisma } from "@prisma/client";
import type { RunnaStatus, RunnaSyncResult } from "@forge/shared";
import { prisma } from "../db.js";
import { toDate } from "../workouts/workout.service.js";
import { parseRunnaFeed, type RunnaWorkout } from "./runna-parser.js";

/**
 * Pulls the athlete's Runna plan into Forge from Runna's calendar feed (see runna-parser.ts).
 * Runna stays in charge of the plan: each sync adds new workouts, moves rescheduled ones and
 * removes future ones the plan dropped. Past and completed workouts are never touched -- they're
 * history, and a completed one's actuals came from Strava.
 */

export class RunnaError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * The only URLs the server will fetch. The link is user-supplied and the API is internet-facing,
 * so anything else (another host, a redirect, an internal address) is refused outright.
 */
const FEED_URL = /^https:\/\/cal\.runna\.com\/[A-Za-z0-9_-]{8,128}\.ics$/;
const FETCH_TIMEOUT_MS = 15_000;
/** A year-long plan is ~50 KB; anything far past that isn't a Runna feed. */
const MAX_FEED_BYTES = 2 * 1024 * 1024;
/** How stale a feed can get before the background sync refreshes it (see background-sync.ts). */
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

/** Accepts the link as Runna shows it (webcal:// or https://), returns the https form or null. */
export function normalizeFeedUrl(raw: string): string | null {
  const url = raw.trim().replace(/^(webcal|http):\/\//i, "https://");
  return FEED_URL.test(url) ? url : null;
}

export type FeedFetcher = (url: string) => Promise<string>;

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 403 || res.status === 404) {
    throw new RunnaError("Runna no longer serves this link. Copy a fresh one from the Runna app.", 502);
  }
  if (!res.ok) throw new RunnaError(`Runna's calendar returned an error (HTTP ${res.status}). Try again later.`, 502);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FEED_BYTES) {
    throw new RunnaError("Runna's calendar is unexpectedly large.", 502);
  }
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new RunnaError("Runna's calendar is unexpectedly large.", 502);
  return body;
}

let activeFetcher: FeedFetcher = fetchFeed;

/** Test-only seam: serve a fixture instead of calling Runna. Pass null to restore the real fetch. */
export function setRunnaFetcherForTesting(fetcher: FeedFetcher | null): void {
  activeFetcher = fetcher ?? fetchFeed;
}

async function download(url: string): Promise<RunnaWorkout[]> {
  let body: string;
  try {
    body = await activeFetcher(url);
  } catch (err) {
    if (err instanceof RunnaError) throw err;
    throw new RunnaError("Couldn't reach Runna's calendar. Try again later.", 502);
  }
  if (!body.includes("BEGIN:VCALENDAR")) throw new RunnaError("That link didn't return a calendar.", 502);
  try {
    return parseRunnaFeed(body);
  } catch {
    throw new RunnaError("Couldn't read Runna's calendar.", 502);
  }
}

/** "https://cal.runna.com/0123…cdef.ics": enough to recognise the link without re-exposing it. */
function maskFeedUrl(url: string): string {
  const match = /^(https:\/\/cal\.runna\.com\/)(.+)(\.ics)$/.exec(url);
  if (!match) return url;
  const id = match[2];
  return `${match[1]}${id.slice(0, 4)}…${id.slice(-4)}${match[3]}`;
}

export async function getStatus(athleteId: string): Promise<RunnaStatus> {
  const athlete = await prisma.athlete.findUniqueOrThrow({
    where: { id: athleteId },
    select: { runnaFeedUrl: true, runnaLastSyncAt: true, runnaLastSyncError: true },
  });
  return {
    feedUrl: athlete.runnaFeedUrl ? maskFeedUrl(athlete.runnaFeedUrl) : null,
    lastSyncAt: athlete.runnaLastSyncAt?.toISOString() ?? null,
    lastSyncError: athlete.runnaLastSyncError,
  };
}

/** JSON with sorted keys: Postgres stores JSONB with its own key order, so raw strings never match. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function plannedFields(workout: RunnaWorkout) {
  return {
    date: toDate(workout.date),
    discipline: workout.discipline,
    title: workout.title,
    notes: workout.notes,
    targetDurationSec: workout.targetDurationSec,
    targetDistanceM: workout.targetDistanceM,
    structuredIntervals: (workout.structuredIntervals ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/** Writes the feed's workouts: create new, update changed, remove future ones the plan dropped. */
async function apply(athleteId: string, workouts: RunnaWorkout[]): Promise<RunnaSyncResult> {
  const existing = await prisma.workout.findMany({
    where: { athleteId, source: "RUNNA" },
    include: { stravaActivity: { select: { id: true } } },
  });
  const byExternalId = new Map(existing.map((w) => [w.externalId, w]));
  // Done means Forge owns it now: its date and actuals are history, whatever Runna says.
  const isDone = (w: (typeof existing)[number]) => w.completed || w.stravaActivity != null;

  let created = 0;
  let updated = 0;
  for (const workout of workouts) {
    const current = byExternalId.get(workout.externalId);
    const data = plannedFields(workout);
    if (!current) {
      await prisma.workout.create({ data: { ...data, athleteId, source: "RUNNA", externalId: workout.externalId } });
      created++;
      continue;
    }
    if (isDone(current)) continue;
    const changed =
      current.date.getTime() !== data.date.getTime() ||
      current.discipline !== data.discipline ||
      current.title !== data.title ||
      current.notes !== data.notes ||
      current.targetDurationSec !== data.targetDurationSec ||
      current.targetDistanceM !== data.targetDistanceM ||
      canonical(current.structuredIntervals) !== canonical(workout.structuredIntervals);
    if (changed) {
      await prisma.workout.update({ where: { id: current.id }, data });
      updated++;
    }
  }

  const inFeed = new Set(workouts.map((w) => w.externalId));
  const today = toDate(todayKey());
  const dropped = existing.filter(
    (w) => !inFeed.has(w.externalId ?? "") && !isDone(w) && w.date.getTime() >= today.getTime(),
  );
  if (dropped.length > 0) {
    await prisma.workout.deleteMany({ where: { id: { in: dropped.map((w) => w.id) } } });
  }

  return { inFeed: workouts.length, created, updated, removed: dropped.length };
}

async function recordFailure(athleteId: string, err: unknown): Promise<never> {
  const message = err instanceof RunnaError ? err.message : "Sync failed.";
  await prisma.athlete.update({ where: { id: athleteId }, data: { runnaLastSyncError: message } });
  throw err;
}

export async function sync(athleteId: string): Promise<RunnaSyncResult> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId }, select: { runnaFeedUrl: true } });
  if (!athlete.runnaFeedUrl) throw new RunnaError("Runna isn't connected.", 400);
  try {
    const result = await apply(athleteId, await download(athlete.runnaFeedUrl));
    await prisma.athlete.update({
      where: { id: athleteId },
      data: { runnaLastSyncAt: new Date(), runnaLastSyncError: null },
    });
    return result;
  } catch (err) {
    return recordFailure(athleteId, err);
  }
}

/** Saves the link and runs the first sync. A link that doesn't work is rejected, not saved. */
export async function connect(athleteId: string, rawUrl: string): Promise<RunnaSyncResult> {
  const url = normalizeFeedUrl(rawUrl);
  if (!url) {
    throw new RunnaError(
      "That isn't a Runna calendar link. It should look like https://cal.runna.com/…ics (or webcal://…).",
      400,
    );
  }
  const workouts = await download(url);
  await prisma.athlete.update({ where: { id: athleteId }, data: { runnaFeedUrl: url } });
  const result = await apply(athleteId, workouts);
  await prisma.athlete.update({
    where: { id: athleteId },
    data: { runnaLastSyncAt: new Date(), runnaLastSyncError: null },
  });
  return result;
}

/** Forgets the link and removes the upcoming Runna workouts; past and completed ones stay. */
export async function disconnect(athleteId: string): Promise<void> {
  await prisma.$transaction([
    prisma.workout.deleteMany({
      where: {
        athleteId,
        source: "RUNNA",
        completed: false,
        stravaActivity: { is: null },
        date: { gte: toDate(todayKey()) },
      },
    }),
    prisma.athlete.update({
      where: { id: athleteId },
      data: { runnaFeedUrl: null, runnaLastSyncAt: null, runnaLastSyncError: null },
    }),
  ]);
}

/** Background pass: re-syncs every connected plan whose last successful sync is over
 * AUTO_SYNC_AFTER_MS old. Failures are recorded on the athlete (shown in Settings) and retried
 * on the next pass. */
export async function syncStaleFeeds(): Promise<void> {
  const stale = await prisma.athlete.findMany({
    where: {
      runnaFeedUrl: { not: null },
      OR: [{ runnaLastSyncAt: null }, { runnaLastSyncAt: { lt: new Date(Date.now() - AUTO_SYNC_AFTER_MS) } }],
    },
    select: { id: true },
  });
  for (const { id } of stale) {
    await sync(id).catch(() => {});
  }
}
