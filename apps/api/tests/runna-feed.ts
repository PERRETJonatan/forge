/**
 * Builds a Runna calendar feed for tests, in the exact shape cal.runna.com serves (one event per
 * plan day, prose steps in the description, a completed run alongside the upcoming ones).
 */

export interface FeedEvent {
  /** The plan-day id Runna puts after `UPCOMING_PLAN_WORKOUT-`. */
  dayId: string;
  date: string;
  summary: string;
  description: string;
  estimatedSec?: number;
}

function compact(date: string): string {
  return date.replaceAll("-", "");
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** ICS text escaping for a DESCRIPTION value: newlines as \n. */
function escape(text: string): string {
  return text.replaceAll("\n", "\\n");
}

export function runnaFeed(events: FeedEvent[]): string {
  const body = events
    .map((e) =>
      [
        "BEGIN:VEVENT",
        `UID:UPCOMING_PLAN_WORKOUT-${e.dayId}`,
        `DTSTAMP:${compact(e.date)}`,
        `DTSTART:${compact(e.date)}`,
        `DTEND:${compact(nextDay(e.date))}`,
        `SUMMARY:${e.summary}`,
        `DESCRIPTION:${escape(e.description)}`,
        "X-USER-TIMEZONE:Europe/Zurich",
        ...(e.estimatedSec ? [`X-WORKOUT-ESTIMATED-DURATION:${e.estimatedSec}`] : []),
        "END:VEVENT",
      ].join("\n"),
    )
    .join("\n\n");
  const completed = [
    "BEGIN:VEVENT",
    "UID:COMPLETED_PLAN_WORKOUT-0C6058D6-0000-0000-0000-000000000000",
    "DTSTAMP:20260809T184128",
    "DTSTART:20260425T175834",
    "DTEND:20260425T182814",
    "SUMMARY:🏃 Your First Walk Run",
    "DESCRIPTION:📊 Summary:\\nDistance: 3.26km\\nTime: 28:37\\nAvg Pace: 8:47 /km",
    "X-USER-TIMEZONE:Europe/Zurich",
    "END:VEVENT",
  ].join("\n");
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Runna//EN\nX-WR-CALNAME:Runna\n\n${body}\n\n${completed}\nEND:VCALENDAR\n`;
}

const APP_LINK = "\n\n📲 View in the Runna app: https://club.runna.com/test/workout?dayId=x";

export const INTERVALS: Omit<FeedEvent, "dayId" | "date"> = {
  summary: "🏃 1km Repeats • 6.5km",
  description:
    "Intervals • 6.5km • 45m - 50m\n\n2km warm up at a conversational pace (no faster than 6:55/km), 90s walking rest\n\n" +
    "3 reps of:\n• 1km at 5:55/km (5:45-6:05/km), 90s walking rest\n\n1.5km cool down at a conversational pace (or slower!)" +
    APP_LINK,
  estimatedSec: 3000,
};

export const OVER_UNDERS: Omit<FeedEvent, "dayId" | "date"> = {
  summary: "🏃 Over and Unders 1km • 8km",
  description:
    "Tempo • 8km • 45m - 55m\n\n1km warm up at a conversational pace (no faster than 6:45/km)\n\n" +
    "Repeat the following 3x:\n----------\n1km at 6:10/km\n1km at 5:50/km\n----------\n\n90s walking rest\n\n" +
    "1km cool down at a conversational pace (or slower!)" +
    APP_LINK,
  estimatedSec: 3300,
};

export const LONG_RUN: Omit<FeedEvent, "dayId" | "date"> = {
  summary: "🏃 8km Long Run • 8km",
  description: "Long Run • 8km • 50m - 1h0m\n\n8km at a conversational pace" + APP_LINK,
  estimatedSec: 3300,
};

export const RACE: Omit<FeedEvent, "dayId" | "date"> = {
  summary: "🏃 Half Marathon Race • 21.1km",
  description: "Race • 21.1km • 2h10m - 2h18m\n\nHalf Marathon race at 6:10-6:30/km" + APP_LINK,
  estimatedSec: 8400,
};

export const STRENGTH: Omit<FeedEvent, "dayId" | "date"> = {
  summary: "🏋️ Loading Up • 55m - 65m",
  description:
    "Legs And Core • 55m - 65m\n\n3 sets of:\n• Bodyweight Squat\n• Squat to Calf Raise\n\n2 sets of:\n• Side Plank\n• Plank Pull Through" +
    APP_LINK,
  estimatedSec: 3900,
};
