import { Component, computed, inject, signal } from '@angular/core';
import type { CreateWorkoutRequest, Discipline, Workout } from '@forge/shared';
import { DISCIPLINES, DISCIPLINE_LABELS } from '../discipline';
import { addMonths, buildMonthGrid, startOfMonth, toDateKey } from '../date-utils';
import { WorkoutService } from '../workout.service';
import { MonthViewComponent } from '../month-view/month-view.component';
import { WorkoutListComponent } from '../workout-list/workout-list.component';
import { WorkoutFormComponent } from '../workout-form/workout-form.component';

type ViewMode = 'calendar' | 'list';
type CompletedFilter = 'all' | 'completed' | 'planned';

@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [MonthViewComponent, WorkoutListComponent, WorkoutFormComponent],
  templateUrl: './calendar-page.component.html',
  styleUrl: './calendar-page.component.css',
})
export class CalendarPageComponent {
  private workoutService = inject(WorkoutService);

  readonly disciplines = DISCIPLINES;
  readonly disciplineLabels = DISCIPLINE_LABELS;

  readonly viewMode = signal<ViewMode>('calendar');
  readonly month = signal(startOfMonth(new Date()));
  readonly days = computed(() => buildMonthGrid(this.month()));
  readonly monthLabel = computed(() =>
    this.month().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  readonly workouts = signal<Workout[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly disciplineFilter = signal<Discipline | 'all'>('all');
  readonly completedFilter = signal<CompletedFilter>('all');

  readonly filteredWorkouts = computed(() => {
    const discipline = this.disciplineFilter();
    const completed = this.completedFilter();
    return this.workouts().filter((w) => {
      if (discipline !== 'all' && w.discipline !== discipline) return false;
      if (completed === 'completed' && !w.completed) return false;
      if (completed === 'planned' && w.completed) return false;
      return true;
    });
  });

  readonly workoutsByDate = computed(() => {
    const map = new Map<string, Workout[]>();
    for (const workout of this.filteredWorkouts()) {
      const list = map.get(workout.date) ?? [];
      list.push(workout);
      map.set(workout.date, list);
    }
    return map;
  });

  readonly formOpen = signal(false);
  readonly editingWorkout = signal<Workout | null>(null);
  readonly formDefaultDate = signal<string | null>(null);

  constructor() {
    this.loadMonth();
  }

  private async loadMonth(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const gridDays = buildMonthGrid(this.month());
    const from = toDateKey(gridDays[0]);
    const to = toDateKey(gridDays[gridDays.length - 1]);
    try {
      const workouts = await this.workoutService.list({ from, to });
      this.workouts.set(workouts);
    } catch {
      this.error.set('Could not load workouts.');
    } finally {
      this.loading.set(false);
    }
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  prevMonth(): void {
    this.month.set(addMonths(this.month(), -1));
    void this.loadMonth();
  }

  nextMonth(): void {
    this.month.set(addMonths(this.month(), 1));
    void this.loadMonth();
  }

  today(): void {
    this.month.set(startOfMonth(new Date()));
    void this.loadMonth();
  }

  openCreate(defaultDate?: string): void {
    this.editingWorkout.set(null);
    this.formDefaultDate.set(defaultDate ?? toDateKey(new Date()));
    this.formOpen.set(true);
  }

  openEdit(workout: Workout): void {
    this.editingWorkout.set(workout);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingWorkout.set(null);
  }

  async saveWorkout(request: CreateWorkoutRequest): Promise<void> {
    const editing = this.editingWorkout();
    try {
      if (editing) {
        await this.workoutService.update(editing.id, request);
      } else {
        await this.workoutService.create(request);
      }
      this.closeForm();
      await this.loadMonth();
    } catch {
      this.error.set('Could not save the workout.');
    }
  }

  async deleteWorkout(): Promise<void> {
    const editing = this.editingWorkout();
    if (!editing) return;
    try {
      await this.workoutService.delete(editing.id);
      this.closeForm();
      await this.loadMonth();
    } catch {
      this.error.set('Could not delete the workout.');
    }
  }
}
