import type { AthleteThresholds, CoachWorkoutDraft, Discipline, WorkoutStep, WorkoutStepTargetUnit } from "@forge/shared";
import { summarizeSteps } from "@forge/shared";
import { z } from "zod";

/**
 * The workout shape the model fills in, and its conversion to the program builder's
 * WorkoutStep tree. The model-facing shape is deliberately simpler than WorkoutStep: minutes
 * rather than seconds, and every block is a "set" (repeat x steps, repeat 1 = plain steps)
 * so there's one uniform nesting level -- small local models got both wrong with the real
 * schema. Everything here is untrusted model output: validated, clamped, and dropped when it
 * doesn't make sense, never passed through.
 */

const DISCIPLINES = ["SWIM", "BIKE", "RUN", "STRENGTH", "OTHER"] as const;
const TARGET_TYPES = ["none", "power", "pace", "hr", "rpe"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const MAX_SETS = 20;
const MAX_STEPS_PER_SET = 6;
const MAX_REPEAT = 30;
const MAX_STEP_MINUTES = 6 * 60;
// A %-of-threshold outside this is a model mistake (e.g. a watt value typed as a percent).
const MIN_PERCENT = 30;
const MAX_PERCENT = 160;

const WARM_UP = /warm/i;
const COOL_DOWN = /cool/i;

const stepJsonSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    minutes: { type: "number" },
    meters: { type: "number" },
    targetType: { type: "string", enum: TARGET_TYPES },
    targetValue: { type: "number" },
  },
  required: ["label", "minutes", "meters", "targetType", "targetValue"],
};

/** JSON schema for Ollama's structured output (the `format` field). */
export const workoutJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    discipline: { type: "string", enum: DISCIPLINES },
    date: { anyOf: [{ type: "null" }, { type: "string" }] },
    sets: {
      type: "array",
      items: {
        type: "object",
        properties: { repeat: { type: "integer" }, steps: { type: "array", items: stepJsonSchema } },
        required: ["repeat", "steps"],
      },
    },
  },
  required: ["title", "discipline", "date", "sets"],
};

/** How the step fields are explained to the model -- kept next to the schema they describe. */
export const WORKOUT_FORMAT_INSTRUCTIONS = `A workout has a title, a discipline (SWIM, BIKE, RUN, STRENGTH or OTHER), a date (YYYY-MM-DD, or null if the athlete didn't ask for a day) and a list of sets.
Each set is {repeat, steps}: repeat 1 for plain steps (warm-up, a steady block, cool-down), or e.g. repeat 4 with two steps for "4 x (8 min hard, 4 min easy)".
Each step: label (e.g. "Warm-up"), minutes (step length in minutes), meters (step distance, 0 unless it's a distance-based swim or run step), targetType and targetValue:
- "power" (BIKE only), "pace" (RUN or SWIM) or "hr": targetValue is a PERCENT of the athlete's threshold (FTP, threshold pace, threshold HR), e.g. 90 for sweet spot, 60 for easy.
- "rpe": targetValue is effort from 1 to 10. Use this for STRENGTH, or when the athlete has no threshold set for that discipline.
- "none": no target, targetValue 0.
Always give minutes for every step so the workout's duration and TSS can be computed.
Warm-up and cool-down are always their own sets with repeat 1 -- only the repeated intervals go in a set with repeat > 1. Make the total length match what the athlete asked for.
Example, a 70-minute sweet-spot ride with 3 x (12 min on, 4 min easy):
{"title": "Sweet spot 3x12", "discipline": "BIKE", "date": null, "sets": [
  {"repeat": 1, "steps": [{"label": "Warm-up", "minutes": 12, "meters": 0, "targetType": "power", "targetValue": 60}]},
  {"repeat": 3, "steps": [{"label": "Sweet spot", "minutes": 12, "meters": 0, "targetType": "power", "targetValue": 90}, {"label": "Easy", "minutes": 4, "meters": 0, "targetType": "power", "targetValue": 55}]},
  {"repeat": 1, "steps": [{"label": "Cool-down", "minutes": 10, "meters": 0, "targetType": "none", "targetValue": 0}]}]}`;

const draftStepSchema = z.object({
  label: z.string().catch(""),
  minutes: z.number().catch(0),
  meters: z.number().catch(0),
  targetType: z.enum(TARGET_TYPES).catch("none"),
  targetValue: z.number().catch(0),
});

const draftSetSchema = z.object({
  repeat: z.number().catch(1),
  steps: z.array(z.unknown()).catch([]),
});

const rawWorkoutSchema = z.object({
  title: z.string().catch(""),
  discipline: z.enum(DISCIPLINES),
  date: z.string().nullable().catch(null),
  sets: z.array(z.unknown()).catch([]),
});

/** Which target units a step in each discipline can use -- mirrors the builder's options
 * (apps/web/src/app/program-builder/target-units.ts), so a draft always opens cleanly there. */
function targetUnitFor(discipline: Discipline, type: TargetType): WorkoutStepTargetUnit | null {
  switch (type) {
    case "power":
      return discipline === "BIKE" ? "power" : null;
    case "pace":
      if (discipline === "RUN") return "pace_sec_per_km";
      if (discipline === "SWIM") return "pace_sec_per_100m";
      return null;
    case "hr":
      return discipline === "STRENGTH" ? null : "hr";
    case "rpe":
      return "rpe";
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toStep(raw: unknown, discipline: Discipline): WorkoutStep | null {
  const parsed = draftStepSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { label, minutes, meters, targetType, targetValue } = parsed.data;

  const durationSec = Number.isFinite(minutes) && minutes > 0 ? Math.round(clamp(minutes, 0, MAX_STEP_MINUTES) * 60) : 0;
  const distanceM = Number.isFinite(meters) && meters > 0 ? Math.round(clamp(meters, 0, 200_000)) : 0;
  if (durationSec === 0 && distanceM === 0) return null;

  const step: WorkoutStep = { label: label.trim().slice(0, 80) };
  if (durationSec > 0) step.durationSec = durationSec;
  if (distanceM > 0) step.distanceM = distanceM;

  const unit = targetUnitFor(discipline, targetType);
  if (unit === "rpe" && targetValue >= 1 && targetValue <= 10) {
    Object.assign(step, { targetUnit: unit, targetMode: "absolute", targetLow: Math.round(targetValue) });
  } else if (unit && unit !== "rpe" && targetValue >= MIN_PERCENT && targetValue <= MAX_PERCENT) {
    Object.assign(step, { targetUnit: unit, targetMode: "percent", targetLow: Math.round(targetValue) });
  }
  return step;
}

/** A real calendar day on or after today, else null (the athlete picks the date in the builder). */
function validDate(value: string | null, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value >= today ? value : null;
}

/**
 * Turns the model's workout into a builder-ready draft, or null if nothing usable is left
 * (no timed steps). Duration and TSS are computed here from the steps and the athlete's
 * thresholds -- same estimate the builder shows -- never taken from the model.
 */
export function normalizeDraft(raw: unknown, thresholds: AthleteThresholds, today: string): CoachWorkoutDraft | null {
  const parsed = rawWorkoutSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { discipline } = parsed.data;

  const steps: WorkoutStep[] = [];
  for (const rawSet of parsed.data.sets.slice(0, MAX_SETS)) {
    const set = draftSetSchema.safeParse(rawSet);
    if (!set.success) continue;
    const setSteps = set.data.steps
      .slice(0, MAX_STEPS_PER_SET)
      .map((s) => toStep(s, discipline))
      .filter((s): s is WorkoutStep => s !== null);
    if (setSteps.length === 0) continue;

    const repeat = Number.isFinite(set.data.repeat) ? Math.round(clamp(set.data.repeat, 1, MAX_REPEAT)) : 1;
    if (repeat === 1) {
      steps.push(...setSteps);
      continue;
    }
    // Small models often put the warm-up and cool-down inside the repeated set, turning a
    // 75-minute ride into 5 hours: those run once, before and after the repeats.
    const before = setSteps.length > 1 && WARM_UP.test(setSteps[0].label ?? "") ? setSteps.splice(0, 1) : [];
    const after = setSteps.length > 1 && COOL_DOWN.test(setSteps.at(-1)!.label ?? "") ? setSteps.splice(-1, 1) : [];
    steps.push(...before, { repeat, steps: setSteps }, ...after);
  }

  const summary = summarizeSteps(steps, thresholds);
  if (summary.durationSec <= 0 && summary.distanceM <= 0) return null;

  return {
    title: parsed.data.title.trim().slice(0, 120) || "Coach workout",
    discipline,
    date: validDate(parsed.data.date, today),
    steps,
    durationSec: summary.durationSec,
    estimatedTss: Math.round(summary.estimatedTss),
  };
}
