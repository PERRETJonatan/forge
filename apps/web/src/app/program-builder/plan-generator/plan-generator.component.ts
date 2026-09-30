import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TYPICAL_PEAK_HOURS } from '@forge/shared';
import type {
  GeneratedWorkout,
  PlanGeneratorDefaults,
  PlanGenerationRequest,
  PlanPreview,
  RaceDistance,
  RaceTarget,
  TrainingPhase,
  Weekday,
} from '@forge/shared';
import { ColumnChartComponent, type ColumnRow, type ColumnSeries } from '../../dashboard/charts/column-chart.component';
import { shortDate } from '../../dashboard/charts/chart-utils';
import { RaceTargetService } from '../../race-target/race-target.service';
import { RunnaService } from '../../runna/runna.service';
import { toDateKey } from '../../workouts/date-utils';
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../../workouts/discipline';
import { WorkoutStepsComponent } from '../../workouts/workout-steps/workout-steps.component';
import { TermComponent } from '../../glossary/term.component';
import { PlanGeneratorService } from './plan-generator.service';

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 0, label: 'Mon' },
  { value: 1, label: 'Tue' },
  { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' },
  { value: 4, label: 'Fri' },
  { value: 5, label: 'Sat' },
  { value: 6, label: 'Sun' },
];

const DISTANCES: { value: RaceDistance; label: string }[] = [
  { value: 'FULL', label: 'Ironman' },
  { value: 'HALF', label: '70.3' },
  { value: 'OLYMPIC', label: 'Olympic' },
  { value: 'SPRINT', label: 'Sprint' },
];

const PHASE_LABELS: Record<TrainingPhase, string> = {
  BASE: 'Base',
  BUILD: 'Build',
  PEAK: 'Peak',
  TAPER: 'Taper',
  RACE: 'Race week',
};

/** Next Monday (or today, if it is one) -- plans read best starting on a fresh week. */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  return toDateKey(d);
}

function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Monday of the week `date` is in (weeks run Monday to Sunday, as in the generator). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weekdayOf(date));
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-plan-generator',
  standalone: true,
  imports: [RouterLink, ColumnChartComponent, WorkoutStepsComponent, TermComponent],
  templateUrl: './plan-generator.component.html',
  styleUrl: './plan-generator.component.css',
})
export class PlanGeneratorComponent {
  private planService = inject(PlanGeneratorService);
  private raceTargetService = inject(RaceTargetService);
  private runnaService = inject(RunnaService);

  readonly weekdays = WEEKDAYS;
  readonly distances = DISTANCES;
  readonly phaseLabels = PHASE_LABELS;
  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly disciplineColors = DISCIPLINE_COLORS;
  readonly shortDate = shortDate;

  readonly race = signal<RaceTarget | null>(null);
  readonly raceLoaded = signal(false);

  readonly raceDistance = signal<RaceDistance>('FULL');
  readonly startDate = signal(nextMonday());
  readonly maxWeeklyHours = signal(10);
  /** Pre-fills from the server; "Peak week" follows its suggestion until the athlete types one. */
  readonly defaults = signal<PlanGeneratorDefaults | null>(null);
  readonly peakEdited = signal(false);
  readonly typicalPeak = computed(() => TYPICAL_PEAK_HOURS[this.raceDistance()]);
  /** " (about 6 h a week, from your recent workouts)", or a plain note when there's little to go on. */
  readonly currentTrainingNote = computed(() => {
    const hours = this.defaults()?.currentWeeklyHours;
    if (hours == null) return '';
    return hours < 1 ? ' (little recent training on record yet)' : ` (about ${hours} h a week, from your recent workouts)`;
  });
  readonly distanceLabel = computed(() => DISTANCES.find((d) => d.value === this.raceDistance())!.label);
  readonly trainingDays = signal<Weekday[]>([1, 2, 3, 4, 5, 6]);
  readonly longRideDay = signal<Weekday>(5);
  readonly longRunDay = signal<Weekday>(6);
  readonly strengthSessions = signal<0 | 1 | 2>(2);
  readonly strengthOptions = [0, 1, 2] as const;
  /** Only offered once Runna is connected in Settings; on by default then. */
  readonly runnaConnected = signal(false);
  readonly runningFromRunna = signal(false);

  readonly preview = signal<PlanPreview | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly applied = signal<string | null>(null);

  /**
   * Whether Runna's plan reaches the race week: then every week's running and gym work is
   * Runna's, and the long-run and strength settings would change nothing.
   */
  readonly runnaCoversRace = computed(() => {
    const end = this.defaults()?.runnaPlanEnd;
    const raceDate = this.race()?.raceDate;
    if (!end || !raceDate) return false;
    const dayBeforeRace = new Date(Date.parse(`${raceDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return mondayOf(end) >= mondayOf(dayBeforeRace);
  });

  /** The long-run and strength settings apply to the weeks Forge plans running for. */
  readonly showRunSettings = computed(() => !this.runningFromRunna() || !this.runnaCoversRace());

  readonly workoutCount = computed(() => this.preview()?.weeks.reduce((n, w) => n + w.workouts.length, 0) ?? 0);
  readonly peakHours = computed(() =>
    Math.round(Math.max(0, ...(this.preview()?.weeks.map((w) => w.plannedHours + w.runnaHours) ?? [])) * 10) / 10,
  );

  /** Whether the preview counts Runna workouts -- they're charted and totalled alongside. */
  readonly withRunna = computed(() => this.preview()?.weeks.some((w) => w.runnaHours > 0) ?? false);

  readonly hoursSeries = computed<ColumnSeries[]>(() => [
    ...(['SWIM', 'BIKE', 'RUN', 'STRENGTH'] as const)
      .filter((d) => !this.withRunna() || d === 'SWIM' || d === 'BIKE')
      .map((d) => ({ key: d, label: DISCIPLINE_LABELS[d], color: DISCIPLINE_COLORS[d] })),
    ...(this.withRunna() ? [{ key: 'RUNNA', label: 'Runna (run & gym)', color: DISCIPLINE_COLORS.RUN }] : []),
  ]);

  readonly hoursRows = computed<ColumnRow[]>(() =>
    (this.preview()?.weeks ?? []).map((w) => {
      const values: Record<string, number> = { SWIM: 0, BIKE: 0, RUN: 0, STRENGTH: 0, RUNNA: w.runnaHours };
      for (const workout of w.workouts) values[workout.discipline] += workout.targetDurationSec / 3600;
      return { label: shortDate(w.weekStart), values };
    }),
  );

  readonly formatHours = (v: number) => `${Math.round(v * 10) / 10} h`;

  constructor() {
    void this.loadRace();
    void this.loadRunna();
    void this.loadDefaults();
  }

  private async loadDefaults(): Promise<void> {
    try {
      this.defaults.set(await this.planService.defaults(toDateKey(new Date())));
      this.applySuggestedPeak();
    } catch {
      // Without them the form keeps its plain defaults; nothing else depends on them.
    }
  }

  /** The suggested peak for the current distance and mode, or null before defaults load. */
  suggestedPeak(): number | null {
    const suggestion = this.defaults()?.suggestedPeakHours[this.raceDistance()];
    if (!suggestion) return null;
    return this.runningFromRunna() ? (suggestion.withRunna ?? suggestion.planned) : suggestion.planned;
  }

  private applySuggestedPeak(): void {
    const peak = this.suggestedPeak();
    if (peak != null && !this.peakEdited()) this.maxWeeklyHours.set(peak);
  }

  useSuggestedPeak(): void {
    this.peakEdited.set(false);
    this.applySuggestedPeak();
    this.edited();
  }

  private async loadRunna(): Promise<void> {
    try {
      const connected = (await this.runnaService.status()).feedUrl != null;
      this.runnaConnected.set(connected);
      this.runningFromRunna.set(connected);
      this.applySuggestedPeak();
    } catch {
      // Without the status the option just isn't offered; the plan works as before.
    }
  }

  private async loadRace(): Promise<void> {
    try {
      this.race.set(await this.raceTargetService.get());
    } catch {
      // Preview will surface a missing-race or connection error with its own message.
    } finally {
      this.raceLoaded.set(true);
    }
  }

  /** Any input change invalidates the preview, so "Add to calendar" always adds what's shown. */
  private edited(): void {
    this.preview.set(null);
    this.applied.set(null);
    this.error.set(null);
  }

  setDistance(value: RaceDistance): void {
    this.raceDistance.set(value);
    this.applySuggestedPeak();
    this.edited();
  }

  setStartDate(value: string): void {
    this.startDate.set(value);
    this.edited();
  }

  setMaxHours(value: number): void {
    this.maxWeeklyHours.set(value);
    this.peakEdited.set(true);
    this.edited();
  }

  toggleDay(day: Weekday): void {
    const days = this.trainingDays();
    this.trainingDays.set(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b));
    this.edited();
  }

  /** Select values arrive as plain numbers; they're always one of WEEKDAYS. */
  setLongRideDay(day: number): void {
    this.longRideDay.set(day as Weekday);
    this.edited();
  }

  setLongRunDay(day: number): void {
    this.longRunDay.set(day as Weekday);
    this.edited();
  }

  setRunningFromRunna(value: boolean): void {
    this.runningFromRunna.set(value);
    this.applySuggestedPeak();
    this.edited();
  }

  setStrengthSessions(value: 0 | 1 | 2): void {
    this.strengthSessions.set(value);
    this.edited();
  }

  /** Client-side check for the mistakes the form makes easy; the server re-validates. */
  readonly formError = computed(() => {
    const days = this.trainingDays();
    if (days.length < 3) return 'Pick at least 3 training days.';
    if (this.runningFromRunna()) {
      // The long run is Runna's; only the long ride's day matters here.
      if (!days.includes(this.longRideDay())) return 'The long ride day must be a training day.';
    } else {
      if (!days.includes(this.longRideDay()) || !days.includes(this.longRunDay())) {
        return 'The long ride and long run days must be training days.';
      }
      if (this.longRideDay() === this.longRunDay()) return 'Put the long ride and long run on different days.';
    }
    if (!(this.maxWeeklyHours() >= 3 && this.maxWeeklyHours() <= 30)) return 'Peak weekly hours must be between 3 and 30.';
    return null;
  });

  private request(): PlanGenerationRequest & { today: string } {
    return {
      startDate: this.startDate(),
      raceDistance: this.raceDistance(),
      maxWeeklyHours: this.maxWeeklyHours(),
      trainingDays: this.trainingDays(),
      longRideDay: this.longRideDay(),
      longRunDay: this.longRunDay(),
      strengthSessionsPerWeek: this.strengthSessions(),
      runningFromRunna: this.runningFromRunna(),
      today: toDateKey(new Date()),
    };
  }

  async generatePreview(): Promise<void> {
    if (this.formError()) return;
    this.busy.set(true);
    this.error.set(null);
    this.applied.set(null);
    try {
      this.preview.set(await this.planService.preview(this.request()));
    } catch (err) {
      this.error.set(this.errorMessage(err, 'generate a plan'));
    } finally {
      this.busy.set(false);
    }
  }

  async applyPlan(): Promise<void> {
    const preview = this.preview();
    if (!preview) return;
    if (
      preview.replacesCount > 0 &&
      !confirm(`This replaces ${preview.replacesCount} upcoming workouts from your previous generated plan. Continue?`)
    ) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.planService.apply(this.request());
      this.applied.set(
        `Added ${result.created} workouts to your calendar` +
          (result.deleted ? `, replacing ${result.deleted} from your previous generated plan.` : '.'),
      );
      this.preview.set(null);
    } catch (err) {
      this.error.set(this.errorMessage(err, 'add the plan to your calendar'));
    } finally {
      this.busy.set(false);
    }
  }

  private errorMessage(err: unknown, action: string): string {
    if (err instanceof HttpErrorResponse) {
      if (typeof err.error?.error === 'string') return err.error.error;
      if (err.status === 0) return `Could not reach the Forge server to ${action}. Check it's running and try again.`;
    }
    return `Could not ${action}. Try again.`;
  }

  dayLabel(date: string): string {
    return WEEKDAYS[weekdayOf(date)].label;
  }

  formatDuration(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
  }

  trackWorkout(workout: GeneratedWorkout): string {
    return `${workout.date}-${workout.discipline}`;
  }
}
