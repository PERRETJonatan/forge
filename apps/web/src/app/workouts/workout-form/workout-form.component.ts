import { LowerCasePipe } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { CreateWorkoutRequest, Discipline, Workout } from '@forge/shared';
import { DISCIPLINES, DISCIPLINE_LABELS } from '../discipline';
import { WorkoutStepsComponent } from '../workout-steps/workout-steps.component';

@Component({
  selector: 'app-workout-form',
  standalone: true,
  imports: [ReactiveFormsModule, WorkoutStepsComponent, LowerCasePipe],
  templateUrl: './workout-form.component.html',
  styleUrl: './workout-form.component.css',
})
export class WorkoutFormComponent implements OnChanges {
  @Input() workout: Workout | null = null;
  @Input() defaultDate: string | null = null;
  @Output() save = new EventEmitter<CreateWorkoutRequest>();
  @Output() delete = new EventEmitter<void>();
  @Output() unmatchStrava = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  private fb = inject(FormBuilder);

  readonly disciplines = DISCIPLINES;
  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly submitting = signal(false);

  readonly form = this.fb.group({
    discipline: ['RUN' as Discipline, Validators.required],
    date: ['', Validators.required],
    title: [''],
    notes: [''],
    targetDurationMin: [null as number | null],
    targetDistanceM: [null as number | null],
    targetIntensity: [''],
    actualDurationMin: [null as number | null],
    actualDistanceM: [null as number | null],
    actualIntensity: [''],
    completed: [false],
  });

  ngOnChanges(): void {
    if (this.workout) {
      this.form.reset({
        discipline: this.workout.discipline,
        date: this.workout.date,
        title: this.workout.title ?? '',
        notes: this.workout.notes ?? '',
        targetDurationMin:
          this.workout.targetDurationSec != null ? Math.round(this.workout.targetDurationSec / 60) : null,
        targetDistanceM: this.workout.targetDistanceM,
        targetIntensity: this.workout.targetIntensity ?? '',
        actualDurationMin:
          this.workout.actualDurationSec != null ? Math.round(this.workout.actualDurationSec / 60) : null,
        actualDistanceM: this.workout.actualDistanceM,
        actualIntensity: this.workout.actualIntensity ?? '',
        completed: this.workout.completed,
      });
    } else {
      this.form.reset({
        discipline: 'RUN',
        date: this.defaultDate ?? '',
        title: '',
        notes: '',
        targetDurationMin: null,
        targetDistanceM: null,
        targetIntensity: '',
        actualDurationMin: null,
        actualDistanceM: null,
        actualIntensity: '',
        completed: false,
      });
    }
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.save.emit({
      discipline: v.discipline!,
      date: v.date!,
      title: v.title || null,
      notes: v.notes || null,
      targetDurationSec: v.targetDurationMin != null ? v.targetDurationMin * 60 : null,
      targetDistanceM: v.targetDistanceM,
      targetIntensity: v.targetIntensity || null,
      actualDurationSec: v.actualDurationMin != null ? v.actualDurationMin * 60 : null,
      actualDistanceM: v.actualDistanceM,
      actualIntensity: v.actualIntensity || null,
      completed: v.completed ?? false,
    });
  }
}
