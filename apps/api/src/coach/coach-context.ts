import type { AthleteThresholds, WorkoutStep } from "@forge/shared";
import type { Discipline } from "@prisma/client";
import { prisma } from "../db.js";
import { actualTss, addDays, dateKey, daysBetween, plannedTss, weekStart, type TssWorkout } from "../fitness/fitness-model.js";
import { getDashboard } from "../fitness/fitness.service.js";
import { toDate } from "../workouts/workout.service.js";

/**
 * The athlete's training data the coach answers from, assembled server-side on every turn
 * (see SPEC.md, Virtual coach) so it's always current: fitness/fatigue/form and their trend,
 * recent and upcoming workouts with TSS, thresholds and the target race. Rendered as compact
 * plain text for the system prompt -- the numbers are the app's own, so the coach quotes the
 * same CTL/TSS the dashboard shows rather than estimating its own.
 */

const RECENT_DAYS = 14;
const UPCOMING_DAYS = 14;
const TREND_WEEKS = 4;
// Keeps the prompt bounded for athletes who log several workouts a day.
const MAX_WORKOUT_LINES = 40;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CoachContext {
  text: string;
  thresholds: AthleteThresholds;
}

function weekday(key: string): string {
  return WEEKDAYS[new Date(`${key}T00:00:00.000Z`).getUTCDay()];
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? String(rest).padStart(2, "0") : ""}`;
}

function formatPace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function formatDistance(meters: number, discipline: Discipline): string {
  return discipline === "SWIM" || meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function thresholdLines(t: AthleteThresholds): string[] {
  return [
    `- FTP: ${t.ftpWatts ? `${t.ftpWatts} W` : "not set"}`,
    `- Run threshold pace: ${t.runThresholdPaceSecPerKm ? `${formatPace(t.runThresholdPaceSecPerKm)}/km` : "not set"}`,
    `- Swim threshold pace (CSS): ${t.swimThresholdPaceSec100m ? `${formatPace(t.swimThresholdPaceSec100m)}/100m` : "not set"}`,
    `- Threshold HR: ${t.thresholdHr ? `${t.thresholdHr} bpm` : "not set"}`,
  ];
}

interface ContextWorkout {
  date: Date;
  discipline: Discipline;
  title: string | null;
  completed: boolean;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  actualDurationSec: number | null;
  actualDistanceM: number | null;
}

function workoutLine(w: ContextWorkout, tss: number, done: boolean): string {
  const day = dateKey(w.date);
  const duration = done ? (w.actualDurationSec ?? w.targetDurationSec) : w.targetDurationSec;
  const distance = done ? (w.actualDistanceM ?? w.targetDistanceM) : w.targetDistanceM;
  const parts = [
    `${weekday(day)} ${day}`,
    w.discipline,
    w.title ? `"${w.title}"` : null,
    duration ? formatDuration(duration) : null,
    distance ? formatDistance(distance, w.discipline) : null,
    tss > 0 ? `TSS ${Math.round(tss)}` : null,
  ];
  return `- ${parts.filter(Boolean).join(", ")}`;
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_WORKOUT_LINES) return lines;
  return [...lines.slice(0, MAX_WORKOUT_LINES), `- ... and ${lines.length - MAX_WORKOUT_LINES} more`];
}

export async function buildCoachContext(athleteId: string, today: string): Promise<CoachContext> {
  const athlete = await prisma.athlete.findUniqueOrThrow({ where: { id: athleteId } });
  const thresholds: AthleteThresholds = {
    ftpWatts: athlete.ftpWatts,
    runThresholdPaceSecPerKm: athlete.runThresholdPaceSecPerKm,
    swimThresholdPaceSec100m: athlete.swimThresholdPaceSec100m,
    thresholdHr: athlete.thresholdHr,
  };

  const dashboard = await getDashboard(athleteId, {
    from: addDays(today, -(TREND_WEEKS * 7 - 1)),
    to: addDays(today, UPCOMING_DAYS),
    today,
  });
  const weekAgo = dashboard.series.find((d) => d.date === addDays(today, -7));
  const inTwoWeeks = dashboard.series.find((d) => d.date === addDays(today, UPCOMING_DAYS));

  const workouts = await prisma.workout.findMany({
    where: { athleteId, date: { gte: toDate(addDays(today, -RECENT_DAYS)), lte: toDate(addDays(today, UPCOMING_DAYS)) } },
    include: { stravaActivity: { select: { avgWatts: true, avgHr: true, avgSpeedMps: true } } },
    orderBy: { date: "asc" },
  });

  const done: string[] = [];
  const missed: string[] = [];
  const upcoming: string[] = [];
  for (const w of workouts) {
    const day = dateKey(w.date);
    const tssWorkout: TssWorkout = {
      discipline: w.discipline,
      source: w.source,
      completed: w.completed,
      targetDurationSec: w.targetDurationSec,
      actualDurationSec: w.actualDurationSec,
      structuredIntervals: w.structuredIntervals as WorkoutStep[] | null,
      activity: w.stravaActivity,
    };
    if (w.completed) {
      done.push(workoutLine(w, actualTss(tssWorkout, thresholds), true));
    } else if (day < today) {
      missed.push(workoutLine(w, plannedTss(tssWorkout, thresholds), false));
    } else {
      upcoming.push(workoutLine(w, plannedTss(tssWorkout, thresholds), false));
    }
  }

  const { ctl, atl, tsb } = dashboard.current;
  const lines = [
    `Today is ${weekday(today)} ${today}.`,
    `Athlete: ${athlete.name}.`,
  ];

  if (athlete.raceDate) {
    const raceDay = dateKey(athlete.raceDate);
    const daysToGo = daysBetween(today, raceDay);
    const name = athlete.raceName ?? "Target race";
    lines.push(
      daysToGo >= 0
        ? `Target race: ${name} on ${raceDay} (${daysToGo} days away).`
        : `Target race: ${name} was on ${raceDay} (already past; no new race set).`,
    );
  } else {
    lines.push("Target race: not set.");
  }

  lines.push("", "Thresholds:", ...thresholdLines(thresholds));
  if (dashboard.missingThresholds.length > 0) {
    lines.push("(TSS for disciplines without a threshold is a rough estimate.)");
  }

  lines.push(
    "",
    "Training load today (Performance Management model; CTL = fitness, 42-day; ATL = fatigue, 7-day; TSB = form = CTL - ATL):",
    `- CTL ${ctl.toFixed(1)}, ATL ${atl.toFixed(1)}, TSB ${signed(tsb)}`,
  );
  if (weekAgo) {
    lines.push(`- 7 days ago: CTL ${weekAgo.ctl.toFixed(1)}, ATL ${weekAgo.atl.toFixed(1)}, TSB ${signed(weekAgo.tsb)}`);
  }
  if (inTwoWeeks) {
    lines.push(
      `- Projected in ${UPCOMING_DAYS} days if the planned workouts are done: CTL ${inTwoWeeks.ctl.toFixed(1)}, TSB ${signed(inTwoWeeks.tsb)}`,
    );
  }

  const pastWeeks = dashboard.weeks.filter((w) => w.weekStart <= today).slice(-TREND_WEEKS);
  if (pastWeeks.length > 0) {
    lines.push("", "Weekly TSS (Monday-start weeks, planned vs actual):");
    for (const w of pastWeeks) {
      const current = w.weekStart === weekStart(today) ? ` (this week, in progress: ${daysBetween(w.weekStart, today) + 1} of 7 days)` : "";
      lines.push(`- Week of ${w.weekStart}${current}: planned ${Math.round(w.plannedTss)}, actual ${Math.round(w.actualTss)}`);
    }
  }

  lines.push("", `Completed workouts, last ${RECENT_DAYS} days:`, ...(done.length ? capped(done) : ["- none"]));
  if (missed.length > 0) {
    lines.push("", `Planned but not completed, last ${RECENT_DAYS} days:`, ...capped(missed));
  }
  lines.push("", `Planned workouts, next ${UPCOMING_DAYS} days:`, ...(upcoming.length ? capped(upcoming) : ["- none"]));

  return { text: lines.join("\n"), thresholds };
}
