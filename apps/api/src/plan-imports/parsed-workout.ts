import type { Discipline, WorkoutStep } from "@forge/shared";

/**
 * Output of a format parser, before it's resolved into a Workout row.
 * `date` is omitted by formats that don't carry a scheduled date (FIT/TCX
 * workout definitions) — the import request supplies one for those.
 */
export interface ParsedWorkout {
  date?: string;
  discipline: Discipline;
  title?: string;
  notes?: string;
  targetDurationSec?: number;
  targetDistanceM?: number;
  targetIntensity?: string;
  structuredIntervals?: WorkoutStep[];
}

const DISCIPLINE_KEYWORDS: [RegExp, Discipline][] = [
  [/swim/i, "SWIM"],
  [/\b(bike|ride|cycl\w*)\b/i, "BIKE"],
  [/\brun(ning)?\b/i, "RUN"],
  [/strength|weights?|gym|lift/i, "STRENGTH"],
];

export function inferDiscipline(...texts: (string | undefined)[]): Discipline {
  const joined = texts.filter(Boolean).join(" ");
  for (const [pattern, discipline] of DISCIPLINE_KEYWORDS) {
    if (pattern.test(joined)) return discipline;
  }
  return "OTHER";
}
