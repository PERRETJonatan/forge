import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { Workout } from '@forge/shared';
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../discipline';

@Component({
  selector: 'app-workout-list',
  standalone: true,
  templateUrl: './workout-list.component.html',
  styleUrl: './workout-list.component.css',
})
export class WorkoutListComponent {
  @Input() workouts: Workout[] = [];
  @Output() workoutClick = new EventEmitter<Workout>();

  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly disciplineColors = DISCIPLINE_COLORS;

  formatDate(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  formatDuration(seconds: number | null): string | null {
    if (seconds == null) return null;
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }

  formatDistance(meters: number | null): string | null {
    if (meters == null) return null;
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  }
}
