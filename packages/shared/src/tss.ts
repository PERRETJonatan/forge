import type { AthleteThresholds, WorkoutStep } from './index.js';

/**
 * Live TSS estimate for a workout being assembled in the program builder, using the same
 * `TSS = IF^2 x duration_hours x 100` model as the dashboard (see SPEC.md, Formulas) --
 * IF here comes from each step's target converted through the athlete's thresholds, since
 * there's no actual power/pace/HR stream yet (the workout hasn't happened).
 *
 * Steps with a distance but no duration don't contribute duration/TSS (there's no reliable
 * pace to convert with unless the step itself targets pace) -- reflected in `untimedDistanceM`
 * so the caller can still show "12 km" it just couldn't estimate seconds for.
 */
export interface StepsSummary {
  durationSec: number;
  distanceM: number;
  untimedDistanceM: number;
  estimatedTss: number;
}

/** IF assumed for a step with no target at all -- an easy/recovery-effort default, not a measurement.
 * The dashboard uses the same default for a workout with no measured or planned intensity. */
export const DEFAULT_UNTARGETED_IF = 0.55;

/** Very rough RPE(1-10) -> IF mapping for a builder estimate; there's no better signal without a target. */
function ifFromRpe(rpe: number): number {
  return Math.min(1.3, Math.max(0, rpe / 10));
}

function averageTarget(step: WorkoutStep): number | null {
  if (step.targetLow != null && step.targetHigh != null) return (step.targetLow + step.targetHigh) / 2;
  return step.targetLow ?? step.targetHigh ?? null;
}

/** Converts a step's target into an Intensity Factor using the athlete's thresholds. Null if it can't be. */
function intensityFactorFor(step: WorkoutStep, thresholds: AthleteThresholds): number | null {
  const target = averageTarget(step);
  if (target == null) return null;

  if (step.targetMode === 'percent') {
    return target / 100;
  }

  switch (step.targetUnit) {
    case 'power':
      return thresholds.ftpWatts ? target / thresholds.ftpWatts : null;
    case 'pace_sec_per_km':
      // Lower seconds/km is faster, i.e. a higher IF -- threshold pace divided by the target.
      return thresholds.runThresholdPaceSecPerKm ? thresholds.runThresholdPaceSecPerKm / target : null;
    case 'pace_sec_per_100m':
      return thresholds.swimThresholdPaceSec100m ? thresholds.swimThresholdPaceSec100m / target : null;
    case 'hr':
      return thresholds.thresholdHr ? target / thresholds.thresholdHr : null;
    case 'rpe':
      return ifFromRpe(target);
    default:
      return null;
  }
}

function walkSteps(steps: WorkoutStep[], thresholds: AthleteThresholds, repeatFactor: number, acc: StepsSummary): void {
  for (const step of steps) {
    if (step.repeat != null && step.steps) {
      walkSteps(step.steps, thresholds, repeatFactor * step.repeat, acc);
      continue;
    }

    const n = repeatFactor;
    if (step.durationSec != null) {
      const durationSec = step.durationSec * n;
      acc.durationSec += durationSec;
      const intensityFactor = intensityFactorFor(step, thresholds) ?? DEFAULT_UNTARGETED_IF;
      acc.estimatedTss += intensityFactor ** 2 * (durationSec / 3600) * 100;
    } else if (step.distanceM != null) {
      acc.untimedDistanceM += step.distanceM * n;
    }
    if (step.distanceM != null) {
      acc.distanceM += step.distanceM * n;
    }
  }
}

/** Flattens repeat groups and sums duration/distance/estimated TSS for a whole structured workout. */
export function summarizeSteps(steps: WorkoutStep[], thresholds: AthleteThresholds): StepsSummary {
  const acc: StepsSummary = { durationSec: 0, distanceM: 0, untimedDistanceM: 0, estimatedTss: 0 };
  walkSteps(steps, thresholds, 1, acc);
  return acc;
}
