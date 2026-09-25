import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AthleteThresholds, FitnessDashboard, RaceTarget } from '@forge/shared';
import { RaceTargetService } from '../race-target/race-target.service';
import { DISCIPLINES, DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../workouts/discipline';
import { toDateKey } from '../workouts/date-utils';
import { ColumnChartComponent, type ColumnRow, type ColumnSeries } from './charts/column-chart.component';
import { shortDate } from './charts/chart-utils';
import { LoadChartComponent } from './charts/load-chart.component';
import { FitnessService } from './fitness.service';

interface RangePreset {
  label: string;
  days: number;
}

const RANGE_PRESETS: RangePreset[] = [
  { label: '6 weeks', days: 42 },
  { label: '12 weeks', days: 84 },
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 },
];

const LOOKAHEAD_DAYS = 14;
/** A race this close gets the projection extended all the way to race day, to show the taper. */
const RACE_PROJECTION_DAYS = 120;

const THRESHOLD_LABELS: Record<keyof AthleteThresholds, string> = {
  ftpWatts: 'FTP',
  runThresholdPaceSecPerKm: 'run threshold pace',
  swimThresholdPaceSec100m: 'swim CSS',
  thresholdHr: 'threshold HR',
};

function addDaysKey(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysUntil(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function trimNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Rough reading of TSB, per the usual Performance Management Chart guidance. */
function formDescription(tsb: number): string {
  if (tsb > 25) return 'Very fresh — fitness fades if this lasts';
  if (tsb > 5) return 'Fresh — ready to race or go hard';
  if (tsb >= -10) return 'Neutral — maintaining';
  if (tsb >= -30) return 'Productive training load';
  return 'Heavy load — watch for overreaching';
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [DecimalPipe, RouterLink, LoadChartComponent, ColumnChartComponent],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css',
})
export class DashboardPageComponent {
  private fitnessService = inject(FitnessService);
  private raceTargetService = inject(RaceTargetService);

  /** Fetched once up front: a near race date widens the charted range (see load()). */
  private readonly raceTarget: Promise<RaceTarget | null> = this.raceTargetService.get().catch(() => null);

  readonly presets = RANGE_PRESETS;
  readonly rangeDays = signal(84);
  readonly volumeUnit = signal<'hours' | 'distance'>('hours');

  readonly today = toDateKey(new Date());
  readonly dashboard = signal<FitnessDashboard | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly raceCountdown = computed(() => {
    const race = this.dashboard()?.race;
    if (!race?.raceDate) return null;
    const days = daysUntil(this.today, race.raceDate);
    return days < 0 ? null : { days, name: race.raceName, date: race.raceDate };
  });

  /** Current values plus the change over the last 7 days, read off the series. */
  readonly tiles = computed(() => {
    const dash = this.dashboard();
    if (!dash) return null;
    const todayIndex = dash.series.findIndex((d) => d.date === dash.today);
    const weekAgo = todayIndex >= 7 ? dash.series[todayIndex - 7] : null;
    const delta = (current: number, key: 'ctl' | 'atl' | 'tsb') =>
      weekAgo ? Math.round((current - weekAgo[key]) * 10) / 10 : null;
    return {
      ctl: { value: dash.current.ctl, delta: delta(dash.current.ctl, 'ctl') },
      atl: { value: dash.current.atl, delta: delta(dash.current.atl, 'atl') },
      tsb: { value: dash.current.tsb, delta: delta(dash.current.tsb, 'tsb'), description: formDescription(dash.current.tsb) },
    };
  });

  readonly missingThresholdsText = computed(() => {
    const missing = this.dashboard()?.missingThresholds ?? [];
    return missing.length ? missing.map((k) => THRESHOLD_LABELS[k]).join(', ') : null;
  });

  readonly disciplineSeries: ColumnSeries[] = DISCIPLINES.map((d) => ({
    key: d,
    label: DISCIPLINE_LABELS[d],
    color: DISCIPLINE_COLORS[d],
  }));

  readonly loadSeries: ColumnSeries[] = [
    { key: 'planned', label: 'Planned', color: '#2a78d6' },
    { key: 'actual', label: 'Actual', color: '#eb6834' },
  ];

  /** Weeks entirely in the future have no volume or actual load yet -- leave them out. */
  private readonly pastWeeks = computed(() => {
    const dash = this.dashboard();
    return dash ? dash.weeks.filter((w) => w.weekStart <= dash.today) : [];
  });

  readonly volumeRows = computed<ColumnRow[]>(() => {
    const hours = this.volumeUnit() === 'hours';
    return this.pastWeeks().map((w) => ({
      label: shortDate(w.weekStart),
      values: Object.fromEntries(
        DISCIPLINES.map((d) => [d, hours ? w.volume[d].durationSec / 3600 : w.volume[d].distanceM / 1000]),
      ),
    }));
  });

  readonly loadRows = computed<ColumnRow[]>(() =>
    this.pastWeeks().map((w) => ({
      label: shortDate(w.weekStart),
      values: { planned: w.plannedTss, actual: w.actualTss },
    })),
  );

  readonly formatVolume = computed(() =>
    this.volumeUnit() === 'hours' ? (v: number) => `${trimNumber(v)} h` : (v: number) => `${trimNumber(v)} km`,
  );
  readonly formatTss = (v: number) => String(Math.round(v));

  constructor() {
    void this.load();
  }

  setRange(days: number): void {
    this.rangeDays.set(days);
    void this.load();
  }

  /** Only the latest request may set state -- quick range clicks can resolve out of order. */
  private loadSeq = 0;

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const raceDate = (await this.raceTarget)?.raceDate ?? null;
      let to = addDaysKey(this.today, LOOKAHEAD_DAYS);
      if (raceDate && raceDate > to && daysUntil(this.today, raceDate) <= RACE_PROJECTION_DAYS) {
        to = raceDate;
      }
      const from = addDaysKey(this.today, -this.rangeDays());
      const dash = await this.fitnessService.dashboard({ from, to, today: this.today });
      if (seq === this.loadSeq) this.dashboard.set(dash);
    } catch {
      if (seq === this.loadSeq) this.error.set('Could not load your dashboard. Try again.');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }
}
