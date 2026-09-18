import { Component, Input } from '@angular/core';
import type { WorkoutStep } from '@forge/shared';

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
    const unit = step.targetUnit ? (TARGET_UNIT_LABELS[step.targetUnit] ?? step.targetUnit) : '';
    if (step.targetLow != null && step.targetHigh != null && step.targetLow !== step.targetHigh) {
      return `${step.targetLow}-${step.targetHigh} ${unit}`.trim();
    }
    return `${step.targetLow ?? step.targetHigh} ${unit}`.trim();
  }
}
