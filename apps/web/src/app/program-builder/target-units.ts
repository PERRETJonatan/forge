import type { Discipline, WorkoutStepTargetUnit } from '@forge/shared';

export interface TargetUnitConfig {
  value: WorkoutStepTargetUnit;
  label: string;
  unit: string;
  /** Entered/displayed as mm:ss rather than a plain number. */
  isPace: boolean;
  /** RPE is already a 1-10 effort scale, not something a %-of-threshold makes sense for. */
  supportsPercent: boolean;
}

const POWER: TargetUnitConfig = { value: 'power', label: 'Power', unit: 'W', isPace: false, supportsPercent: true };
const HR: TargetUnitConfig = { value: 'hr', label: 'Heart rate', unit: 'bpm', isPace: false, supportsPercent: true };
const RPE: TargetUnitConfig = { value: 'rpe', label: 'RPE', unit: '/10', isPace: false, supportsPercent: false };
const RUN_PACE: TargetUnitConfig = {
  value: 'pace_sec_per_km',
  label: 'Pace',
  unit: '/km',
  isPace: true,
  supportsPercent: true,
};
const SWIM_PACE: TargetUnitConfig = {
  value: 'pace_sec_per_100m',
  label: 'Pace',
  unit: '/100m',
  isPace: true,
  supportsPercent: true,
};

/** Target kinds offered per discipline -- what a step in that discipline's builder can target. */
export const TARGET_UNITS_BY_DISCIPLINE: Record<Discipline, TargetUnitConfig[]> = {
  BIKE: [POWER, HR, RPE],
  RUN: [RUN_PACE, HR, RPE],
  SWIM: [SWIM_PACE, HR, RPE],
  STRENGTH: [RPE],
  OTHER: [RPE, HR],
};

export function targetUnitConfig(discipline: Discipline, unit: WorkoutStepTargetUnit | undefined): TargetUnitConfig | null {
  return TARGET_UNITS_BY_DISCIPLINE[discipline].find((u) => u.value === unit) ?? null;
}
