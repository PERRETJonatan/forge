import { Component, Input } from '@angular/core';
import type { WorkoutStep } from '@forge/shared';
import { formatPace } from '../../shared/pace';

/** What a %-of-threshold target is a percentage of, per unit. */
const PERCENT_OF: Record<string, string> = {
  power: 'FTP',
  pace_sec_per_km: 'threshold pace',
  pace_sec_per_100m: 'CSS',
  hr: 'threshold HR',
};

const PACE_UNITS: Record<string, string> = {
  pace_sec_per_km: '/km',
  pace_sec_per_100m: '/100m',
};

const TARGET_UNIT_LABELS: Record<string, string> = {
  power: 'W',
  hr: 'bpm',
  hr_bpm: 'bpm',
  speed: 'm/s',
  speed_m_s: 'm/s',
  cadence_rpm: 'rpm',
};

@Component({
  selector: 'app-workout-steps',
  standalone: true,
  imports: [WorkoutStepsComponent],
  templateUrl: './workout-steps.component.html',
  styleUrl: './workout-steps.component.css',
})
export class WorkoutStepsComponent {
  @Input() steps: WorkoutStep[] = [];

  formatDuration(seconds: number | undefined): string | null {
    if (seconds == null) return null;
    const minutes = Math.round(seconds / 60);
    return minutes > 0 ? `${minutes} min` : `${seconds}s`;
  }

  formatDistance(meters: number | undefined): string | null {
    if (meters == null) return null;
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  }

  formatTarget(step: WorkoutStep): string | null {
    if (step.targetLow == null && step.targetHigh == null) return null;
    if (step.targetMode === 'percent') {
      const of = step.targetUnit ? PERCENT_OF[step.targetUnit] : undefined;
      return `${this.range(step, (v) => String(v))}%${of ? ` ${of}` : ''}`;
    }
    const paceUnit = step.targetUnit ? PACE_UNITS[step.targetUnit] : undefined;
    if (paceUnit) {
      return `${this.range(step, (v) => formatPace(v))}${paceUnit}`;
    }
    const unit = step.targetUnit ? (TARGET_UNIT_LABELS[step.targetUnit] ?? step.targetUnit) : '';
    if (step.targetLow != null && step.targetHigh != null && step.targetLow !== step.targetHigh) {
      return `${step.targetLow}-${step.targetHigh} ${unit}`.trim();
    }
    return `${step.targetLow ?? step.targetHigh} ${unit}`.trim();
  }

  private range(step: WorkoutStep, format: (v: number) => string): string {
    const low = step.targetLow ?? step.targetHigh!;
    const high = step.targetHigh ?? low;
    return low === high ? format(low) : `${format(low)}-${format(high)}`;
  }
}
