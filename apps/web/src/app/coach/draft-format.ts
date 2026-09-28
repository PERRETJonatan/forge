import type { WorkoutStep } from '@forge/shared';

const PERCENT_OF: Record<string, string> = {
  power: 'FTP',
  pace_sec_per_km: 'threshold pace',
  pace_sec_per_100m: 'CSS',
  hr: 'threshold HR',
};

export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h${rest ? String(rest).padStart(2, '0') : ''}`;
}

function describeTarget(step: WorkoutStep): string | null {
  if (step.targetLow == null || !step.targetUnit) return null;
  if (step.targetUnit === 'rpe') return `RPE ${step.targetLow}`;
  if (step.targetMode === 'percent') return `${step.targetLow}% ${PERCENT_OF[step.targetUnit] ?? ''}`.trim();
  return null;
}

function describeLeaf(step: WorkoutStep): string {
  const size = [
    step.durationSec ? formatMinutes(step.durationSec) : null,
    step.distanceM ? `${step.distanceM} m` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  const target = describeTarget(step);
  return [size, target ? `@ ${target}` : null].filter(Boolean).join(' ');
}

/** One line per block of a coach draft, e.g. "3 × (12 min @ 90% FTP, 4 min @ 55% FTP)". */
export function describeSteps(steps: WorkoutStep[]): { label: string; detail: string }[] {
  return steps.map((step) => {
    if (step.repeat != null && step.steps) {
      return {
        label: step.steps.map((s) => s.label).filter(Boolean).join(' / ') || 'Set',
        detail: `${step.repeat} × (${step.steps.map(describeLeaf).join(', ')})`,
      };
    }
    return { label: step.label || 'Step', detail: describeLeaf(step) };
  });
}
