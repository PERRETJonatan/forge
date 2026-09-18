import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { Workout } from '@forge/shared';
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../discipline';
import { toDateKey } from '../date-utils';

@Component({
  selector: 'app-month-view',
  standalone: true,
  templateUrl: './month-view.component.html',
  styleUrl: './month-view.component.css',
})
export class MonthViewComponent {
  @Input() month = new Date();
  @Input() days: Date[] = [];
  @Input() workoutsByDate = new Map<string, Workout[]>();
  @Output() dayClick = new EventEmitter<string>();
  @Output() workoutClick = new EventEmitter<Workout>();

  readonly weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly disciplineColors = DISCIPLINE_COLORS;
  readonly today = toDateKey(new Date());

  dateKey(date: Date): string {
    return toDateKey(date);
  }

  isCurrentMonth(date: Date): boolean {
    return date.getMonth() === this.month.getMonth();
  }

  workoutsFor(date: Date): Workout[] {
    return this.workoutsByDate.get(this.dateKey(date)) ?? [];
  }

  onDayClick(date: Date): void {
    this.dayClick.emit(this.dateKey(date));
  }

  onWorkoutClick(event: MouseEvent, workout: Workout): void {
    event.stopPropagation();
    this.workoutClick.emit(workout);
  }
}
