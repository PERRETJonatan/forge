import { Decoder, Stream } from "@garmin/fitsdk";
import type { Discipline, WorkoutStep } from "@forge/shared";
import type { ParsedWorkout } from "../parsed-workout.js";

export class FitParseError extends Error {}

function mapSport(sport: string | undefined): Discipline {
  switch (sport) {
    case "running":
      return "RUN";
    case "cycling":
    case "eBiking":
      return "BIKE";
    case "swimming":
      return "SWIM";
    case "training":
    case "fitnessEquipment":
      return "STRENGTH";
    default:
      return "OTHER";
  }
}

function normalizeString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const str = Array.isArray(value) ? value.join("") : String(value);
  return str.trim() || undefined;
}

function targetUnitLabel(targetType: string | undefined): string | undefined {
  switch (targetType) {
    case "heartRate":
    case "heartRateLap":
      return "hr";
    case "power":
    case "power3s":
    case "power10s":
    case "power30s":
    case "powerLap":
      return "power";
    case "speed":
    case "speedLap":
      return "speed";
    case "cadence":
      return "cadence_rpm";
    default:
      return undefined;
  }
}

// A structured FIT workout is a flat, messageIndex-ordered list of steps.
// Simple N-times repeats ("6x 4min @ threshold") are stored as a step whose
// durationType is repeatUntilStepsCmplt, pointing back at the messageIndex
// to loop from — this reconstructs that into a nested repeat group.
// The other repeatUntil* duration types repeat until a time/distance/HR/
// power *threshold* rather than a fixed count, which doesn't map onto our
// count-based group model, so those are left as plain leaf steps.
const SIMPLE_REPEAT_DURATION_TYPE = "repeatUntilStepsCmplt";

interface RawWorkoutStep {
  messageIndex?: number;
  wktStepName?: unknown;
  durationType?: string;
  durationValue?: number;
  durationTime?: number;
  durationDistance?: number;
  durationStep?: number;
  targetType?: string;
  targetValue?: number;
  repeatSteps?: number;
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
}

interface IndexedNode {
  messageIndex: number;
  node: WorkoutStep;
}

function buildLeafStep(step: RawWorkoutStep): WorkoutStep {
  const label = normalizeString(step.wktStepName);
  const durationSec = step.durationTime != null ? Math.round(step.durationTime) : undefined;
  const distanceM = step.durationDistance != null ? step.durationDistance : undefined;
  const targetLow = step.customTargetValueLow != null ? step.customTargetValueLow : undefined;
  const targetHigh = step.customTargetValueHigh != null ? step.customTargetValueHigh : undefined;
  const targetUnit = targetUnitLabel(step.targetType);

  return {
    ...(label ? { label } : {}),
    ...(durationSec != null ? { durationSec } : {}),
    ...(distanceM != null ? { distanceM } : {}),
    ...(targetLow != null ? { targetLow } : {}),
    ...(targetHigh != null ? { targetHigh } : {}),
    ...(targetUnit ? { targetUnit } : {}),
  };
}

function buildStructuredIntervals(rawSteps: RawWorkoutStep[]): WorkoutStep[] {
  const sorted = [...rawSteps].sort((a, b) => (a.messageIndex ?? 0) - (b.messageIndex ?? 0));
  const output: IndexedNode[] = [];

  sorted.forEach((step, i) => {
    const messageIndex = step.messageIndex ?? i;

    if (step.durationType === SIMPLE_REPEAT_DURATION_TYPE) {
      const fromIndex = step.durationStep ?? step.durationValue;
      const count = step.repeatSteps ?? step.targetValue;
      if (fromIndex != null && count != null) {
        const grouped: WorkoutStep[] = [];
        while (output.length > 0 && output[output.length - 1].messageIndex >= fromIndex) {
          grouped.unshift(output.pop()!.node);
        }
        output.push({ messageIndex, node: { repeat: Number(count), steps: grouped } });
        return;
      }
    }

    output.push({ messageIndex, node: buildLeafStep(step) });
  });

  return output.map((o) => o.node);
}

export function parseFit(buffer: Buffer): ParsedWorkout[] {
  const stream = Stream.fromBuffer(buffer);
  if (!Decoder.isFIT(stream)) {
    throw new FitParseError("Not a valid FIT file");
  }

  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();
  const workoutMesgs = (messages.workoutMesgs ?? []) as Array<{
    sport?: string;
    wktName?: unknown;
    wktDescription?: unknown;
  }>;
  if (workoutMesgs.length === 0) {
    throw new FitParseError(
      errors.length > 0 ? errors.map(String).join("; ") : "No workout definition found in this FIT file",
    );
  }

  const workout = workoutMesgs[0];
  const stepMesgs = (messages.workoutStepMesgs ?? []) as RawWorkoutStep[];

  return [
    {
      discipline: mapSport(workout.sport),
      title: normalizeString(workout.wktName),
      notes: normalizeString(workout.wktDescription),
      structuredIntervals: buildStructuredIntervals(stepMesgs),
    },
  ];
}
