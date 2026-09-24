import type { WorkoutStep } from "@forge/shared";
import { z } from "zod";

/**
 * Validates a WorkoutStep tree (program builder input, or a template's saved steps) -- the
 * same shape plan-import parsers write to `structuredIntervals`, see @forge/shared.
 */
export const workoutStepSchema: z.ZodType<WorkoutStep> = z.lazy(() =>
  z.object({
    label: z.string().max(200).optional(),
    durationSec: z.number().int().nonnegative().optional(),
    distanceM: z.number().nonnegative().optional(),
    targetLow: z.number().optional(),
    targetHigh: z.number().optional(),
    targetUnit: z.string().max(50).optional(),
    targetMode: z.enum(["absolute", "percent"]).optional(),
    repeat: z.number().int().positive().optional(),
    steps: z.array(workoutStepSchema).optional(),
  }),
);

export const workoutStepsSchema = z.array(workoutStepSchema);
