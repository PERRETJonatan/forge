import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import type { AthleteThresholds, Discipline, WorkoutStep, WorkoutTemplate } from '@forge/shared';
import { summarizeSteps } from '@forge/shared';
import { DISCIPLINES, DISCIPLINE_LABELS } from '../workouts/discipline';
import { WorkoutService } from '../workouts/workout.service';
import { ThresholdsService } from '../thresholds/thresholds.service';
import { WorkoutTemplateService } from '../workout-templates/workout-template.service';
import { formatPace, parsePace } from '../shared/pace';
import { PlanGeneratorComponent } from './plan-generator/plan-generator.component';
import { TARGET_UNITS_BY_DISCIPLINE, targetUnitConfig } from './target-units';

/** A repeat group is one level deep -- e.g. "6x (4min on, 2min off)" -- matching what every
 * plan-import parser actually produces (see fit.parser.ts) and the SPEC's own example. */
type Group = { repeat: number; steps: WorkoutStep[] };

function isGroup(block: WorkoutStep | Group): block is Group {
  return 'repeat' in block && block.repeat != null;
}

function blankLeaf(): WorkoutStep {
  return { label: '', durationSec: 300 };
}

const EMPTY_THRESHOLDS: AthleteThresholds = {
  ftpWatts: null,
  runThresholdPaceSecPerKm: null,
  swimThresholdPaceSec100m: null,
  thresholdHr: null,
};

@Component({
  selector: 'app-program-builder-page',
  standalone: true,
  imports: [NgTemplateOutlet, DecimalPipe, PlanGeneratorComponent],
  templateUrl: './program-builder-page.component.html',
  styleUrl: './program-builder-page.component.css',
})
export class ProgramBuilderPageComponent {
  private workoutService = inject(WorkoutService);
  private thresholdsService = inject(ThresholdsService);
  private templateService = inject(WorkoutTemplateService);

  readonly mode = signal<'plan' | 'workout'>('plan');

  readonly disciplines = DISCIPLINES;
  readonly disciplineLabels = DISCIPLINE_LABELS;

  readonly discipline = signal<Discipline>('BIKE');
  readonly blocks = signal<(WorkoutStep | Group)[]>([]);
  readonly thresholds = signal<AthleteThresholds>(EMPTY_THRESHOLDS);
  readonly targetUnits = computed(() => TARGET_UNITS_BY_DISCIPLINE[this.discipline()]);

  readonly summary = computed(() => summarizeSteps(this.blocks() as WorkoutStep[], this.thresholds()));

  readonly templates = signal<WorkoutTemplate[]>([]);
  readonly templateId = signal<string | null>(null);

  readonly workoutTitle = signal('');
  readonly workoutDate = signal(new Date().toISOString().slice(0, 10));
  readonly saving = signal(false);
  readonly savedMessage = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly applyDates = signal<Record<string, string>>({});
  readonly applyWeeks = signal<Record<string, number>>({});

  constructor() {
    void this.loadThresholds();
    void this.loadTemplates();
  }

  private async loadThresholds(): Promise<void> {
    try {
      this.thresholds.set(await this.thresholdsService.get());
    } catch {
      // Builder still works without thresholds -- percent targets just fall back to a default estimate.
    }
  }

  private async loadTemplates(): Promise<void> {
    try {
      this.templates.set(await this.templateService.list());
    } catch {
      // Non-critical: the template list is a convenience, not required to build/add a workout.
    }
  }

  isGroup = isGroup;

  formatPace = formatPace;

  onDisciplineChange(discipline: Discipline): void {
    this.discipline.set(discipline);
    // A target unit valid for the old discipline (e.g. power) may be meaningless for the new
    // one (e.g. run) -- clear per-step targets rather than silently misinterpret them.
    this.blocks.set(
      this.blocks().map((block) =>
        isGroup(block)
          ? { ...block, steps: block.steps.map((s) => ({ ...s, targetLow: undefined, targetHigh: undefined, targetUnit: undefined })) }
          : { ...block, targetLow: undefined, targetHigh: undefined, targetUnit: undefined },
      ),
    );
  }

  addLeaf(): void {
    this.blocks.set([...this.blocks(), blankLeaf()]);
  }

  addGroup(): void {
    this.blocks.set([...this.blocks(), { repeat: 4, steps: [blankLeaf()] }]);
  }

  removeBlock(index: number): void {
    this.blocks.set(this.blocks().filter((_, i) => i !== index));
  }

  moveBlock(index: number, delta: number): void {
    const blocks = [...this.blocks()];
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    this.blocks.set(blocks);
  }

  updateLeaf(index: number, patch: Partial<WorkoutStep>): void {
    this.blocks.set(this.blocks().map((b, i) => (i === index ? { ...(b as WorkoutStep), ...patch } : b)));
  }

  updateGroupRepeat(index: number, repeat: number): void {
    this.blocks.set(this.blocks().map((b, i) => (i === index && isGroup(b) ? { ...b, repeat } : b)));
  }

  addStepToGroup(index: number): void {
    this.blocks.set(
      this.blocks().map((b, i) => (i === index && isGroup(b) ? { ...b, steps: [...b.steps, blankLeaf()] } : b)),
    );
  }

  removeStepFromGroup(groupIndex: number, stepIndex: number): void {
    this.blocks.set(
      this.blocks().map((b, i) =>
        i === groupIndex && isGroup(b) ? { ...b, steps: b.steps.filter((_, j) => j !== stepIndex) } : b,
      ),
    );
  }

  updateGroupStep(groupIndex: number, stepIndex: number, patch: Partial<WorkoutStep>): void {
    this.blocks.set(
      this.blocks().map((b, i) =>
        i === groupIndex && isGroup(b)
          ? { ...b, steps: b.steps.map((s, j) => (j === stepIndex ? { ...s, ...patch } : s)) }
          : b,
      ),
    );
  }

  /** Absolute equivalent shown next to a %-of-threshold target, e.g. "90% -> 225 W". Null if unconvertible. */
  absoluteFromPercent(step: WorkoutStep): string | null {
    if (step.targetMode !== 'percent' || step.targetLow == null) return null;
    const config = targetUnitConfig(this.discipline(), step.targetUnit);
    if (!config) return null;
    const pct = step.targetLow / 100;
    const t = this.thresholds();
    switch (step.targetUnit) {
      case 'power':
        return t.ftpWatts ? `${Math.round(t.ftpWatts * pct)} W` : null;
      case 'hr':
        return t.thresholdHr ? `${Math.round(t.thresholdHr * pct)} bpm` : null;
      case 'pace_sec_per_km':
        return t.runThresholdPaceSecPerKm ? `${formatPace(t.runThresholdPaceSecPerKm / pct)}/km` : null;
      case 'pace_sec_per_100m':
        return t.swimThresholdPaceSec100m ? `${formatPace(t.swimThresholdPaceSec100m / pct)}/100m` : null;
      default:
        return null;
    }
  }

  targetUnitFor(step: WorkoutStep) {
    return targetUnitConfig(this.discipline(), step.targetUnit);
  }

  targetLowText(step: WorkoutStep): string {
    const config = targetUnitConfig(this.discipline(), step.targetUnit);
    if (config?.isPace && step.targetMode !== 'percent') return formatPace(step.targetLow ?? null);
    return step.targetLow != null ? String(step.targetLow) : '';
  }

  private parseTargetLow(step: WorkoutStep, value: string): number | undefined {
    const config = targetUnitConfig(this.discipline(), step.targetUnit);
    if (config?.isPace && step.targetMode !== 'percent') return parsePace(value) ?? undefined;
    return value === '' ? undefined : Number(value);
  }

  setLeafTargetLow(index: number, step: WorkoutStep, value: string): void {
    this.updateLeaf(index, { targetLow: this.parseTargetLow(step, value) });
  }

  setGroupStepTargetLow(groupIndex: number, stepIndex: number, step: WorkoutStep, value: string): void {
    this.updateGroupStep(groupIndex, stepIndex, { targetLow: this.parseTargetLow(step, value) });
  }

  durationMinutes(step: WorkoutStep): number | null {
    return step.durationSec != null ? Math.round(step.durationSec / 60) : null;
  }

  formatDuration(seconds: number): string {
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
  }

  formatDistance(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
  }

  private buildableSteps(): WorkoutStep[] {
    return this.blocks() as WorkoutStep[];
  }

  private resetAfterSave(): void {
    this.blocks.set([]);
    this.workoutTitle.set('');
    this.templateId.set(null);
  }

  async addToCalendar(): Promise<void> {
    if (this.blocks().length === 0) return;
    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);
    try {
      const summary = this.summary();
      await this.workoutService.create({
        discipline: this.discipline(),
        date: this.workoutDate(),
        title: this.workoutTitle() || null,
        structuredIntervals: this.buildableSteps(),
        targetDurationSec: summary.durationSec || null,
        targetDistanceM: summary.distanceM || null,
      });
      this.savedMessage.set(`Added to your calendar on ${this.workoutDate()}.`);
      this.resetAfterSave();
    } catch (err) {
      this.error.set(this.serverError(err) ?? 'Could not add this workout to the calendar. Try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async saveAsTemplate(): Promise<void> {
    if (this.blocks().length === 0) return;
    const name = prompt('Template name', this.workoutTitle() || '');
    if (!name) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const existingId = this.templateId();
      const saved = existingId
        ? await this.templateService.update(existingId, { name, discipline: this.discipline(), steps: this.buildableSteps() })
        : await this.templateService.create({ name, discipline: this.discipline(), steps: this.buildableSteps() });
      this.templateId.set(saved.id);
      this.savedMessage.set(`Saved "${saved.name}" as a template.`);
      await this.loadTemplates();
    } catch (err) {
      this.error.set(this.serverError(err) ?? 'Could not save this template. Try again.');
    } finally {
      this.saving.set(false);
    }
  }

  loadTemplate(template: WorkoutTemplate): void {
    this.discipline.set(template.discipline);
    this.blocks.set(template.steps as (WorkoutStep | Group)[]);
    this.workoutTitle.set(template.name);
    this.templateId.set(template.id);
    this.savedMessage.set(null);
    this.error.set(null);
  }

  async deleteTemplate(template: WorkoutTemplate): Promise<void> {
    if (!confirm(`Delete template "${template.name}"? This can't be undone.`)) return;
    try {
      await this.templateService.delete(template.id);
      this.templates.set(this.templates().filter((t) => t.id !== template.id));
      if (this.templateId() === template.id) this.templateId.set(null);
    } catch {
      this.error.set('Could not delete this template. Try again.');
    }
  }

  applyDateFor(template: WorkoutTemplate): string {
    return this.applyDates()[template.id] ?? new Date().toISOString().slice(0, 10);
  }

  setApplyDate(template: WorkoutTemplate, date: string): void {
    this.applyDates.set({ ...this.applyDates(), [template.id]: date });
  }

  weeksFor(template: WorkoutTemplate): number {
    return this.applyWeeks()[template.id] ?? 1;
  }

  setWeeksFor(template: WorkoutTemplate, weeks: number): void {
    this.applyWeeks.set({ ...this.applyWeeks(), [template.id]: weeks });
  }

  /** Applies the template to its picked date, then weekly for (weeks - 1) more occurrences. */
  async applyTemplate(template: WorkoutTemplate): Promise<void> {
    const baseDate = this.applyDateFor(template);
    const weeks = Math.max(1, this.weeksFor(template));
    this.saving.set(true);
    this.error.set(null);
    try {
      for (let i = 0; i < weeks; i++) {
        const date = new Date(`${baseDate}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + i * 7);
        await this.templateService.apply(template.id, date.toISOString().slice(0, 10));
      }
      this.savedMessage.set(
        weeks === 1
          ? `Added "${template.name}" to your calendar on ${baseDate}.`
          : `Added "${template.name}" to your calendar weekly, ${weeks} times starting ${baseDate}.`,
      );
    } catch (err) {
      this.error.set(this.serverError(err) ?? 'Could not add this template to the calendar. Try again.');
    } finally {
      this.saving.set(false);
    }
  }

  private serverError(err: unknown): string | null {
    return err instanceof HttpErrorResponse && typeof err.error?.error === 'string' ? err.error.error : null;
  }
}
