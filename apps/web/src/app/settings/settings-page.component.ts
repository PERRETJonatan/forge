import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import type { CalendarFeedStatus, PlanImport, RunnaStatus, RunnaSyncResult, StravaStatus } from '@forge/shared';
import { CalendarFeedService } from '../calendar-feed/calendar-feed.service';
import { PlanImportService } from '../plan-import/plan-import.service';
import { RaceTargetService } from '../race-target/race-target.service';
import { RunnaService } from '../runna/runna.service';
import { TermComponent } from '../glossary/term.component';
import { formatPace, parsePace } from '../shared/pace';
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../workouts/discipline';
import { StravaService } from '../strava/strava.service';
import { ThresholdsService } from '../thresholds/thresholds.service';

/** The API's own message for a refused link or failed sync (Runna, Strava), which says what to fix. */
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Could not reach the Forge server. Check it\'s running and try again.';
    if (typeof err.error?.error === 'string') return err.error.error;
  }
  return fallback;
}

function runnaSyncSummary(result: RunnaSyncResult): string {
  const changes = [
    result.created ? `${result.created} added` : null,
    result.updated ? `${result.updated} updated` : null,
    result.removed ? `${result.removed} removed` : null,
  ].filter(Boolean);
  const plan = `${result.inFeed} upcoming workout${result.inFeed === 1 ? '' : 's'} in your Runna plan`;
  return changes.length ? `${plan}: ${changes.join(', ')}.` : `${plan}, already up to date.`;
}

/** Says why a save failed, so a network or server problem isn't mistaken for bad input. */
function saveErrorMessage(err: unknown, what: string): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return `Could not reach the Forge server to save your ${what}. Check it's running and try again.`;
    if (err.status === 401) return 'Your session has expired. Log in again, then save.';
    if (err.status === 400) return `The server rejected your ${what}. Check the values and try again.`;
    return `Could not save your ${what} (server error ${err.status}). Try again.`;
  }
  return `Could not save your ${what}. Try again.`;
}

const DATELESS_EXTENSIONS = new Set(['fit', 'tcx']);

function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TermComponent],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.css',
})
export class SettingsPageComponent {
  private planImportService = inject(PlanImportService);
  private calendarFeedService = inject(CalendarFeedService);
  private thresholdsService = inject(ThresholdsService);
  private stravaService = inject(StravaService);
  private raceTargetService = inject(RaceTargetService);
  private runnaService = inject(RunnaService);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);

  readonly stravaStatus = signal<StravaStatus | null>(null);
  readonly stravaBusy = signal(false);
  readonly stravaError = signal<string | null>(null);
  readonly stravaSyncMessage = signal<string | null>(null);

  readonly runnaStatus = signal<RunnaStatus | null>(null);
  readonly runnaLink = signal('');
  readonly runnaBusy = signal(false);
  readonly runnaError = signal<string | null>(null);
  readonly runnaMessage = signal<string | null>(null);

  readonly thresholdsForm = this.fb.group({
    ftpWatts: [null as number | null],
    runThresholdPace: [''],
    swimThresholdPace: [''],
    thresholdHr: [null as number | null],
  });
  readonly thresholdsSaving = signal(false);
  readonly thresholdsSaved = signal(false);
  readonly thresholdsError = signal<string | null>(null);

  readonly raceForm = this.fb.group({
    raceName: [''],
    raceDate: [''],
  });
  readonly raceSaving = signal(false);
  readonly raceSaved = signal(false);
  readonly raceError = signal<string | null>(null);

  readonly feedUrl = signal<string | null>(null);
  readonly feedSports = signal<CalendarFeedStatus['sports']>([]);
  readonly feedBusy = signal(false);
  readonly feedError = signal<string | null>(null);
  /** The feed link just copied, to flip its button to "Copied!" for a moment. */
  readonly copiedUrl = signal<string | null>(null);
  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly disciplineColors = DISCIPLINE_COLORS;

  readonly selectedFile = signal<File | null>(null);
  readonly importDate = signal(new Date().toISOString().slice(0, 10));
  readonly needsDate = computed(() => {
    const file = this.selectedFile();
    return file ? DATELESS_EXTENSIONS.has(extensionOf(file.name)) : false;
  });

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastResult = signal<PlanImport | null>(null);
  readonly history = signal<PlanImport[]>([]);

  constructor() {
    void this.loadHistory();
    void this.loadFeedStatus();
    void this.loadThresholds();
    void this.loadRaceTarget();
    void this.loadStravaStatus();
    void this.loadRunnaStatus();

    const stravaParam = this.route.snapshot.queryParamMap.get('strava');
    if (stravaParam === 'connected') {
      this.stravaSyncMessage.set('Connected to Strava.');
    } else if (stravaParam === 'error') {
      this.stravaError.set('Could not connect to Strava. Try again.');
    }
  }

  private async loadStravaStatus(): Promise<void> {
    try {
      this.stravaStatus.set(await this.stravaService.status());
    } catch {
      // The connect/sync buttons will surface any real error.
    }
  }

  async connectStrava(): Promise<void> {
    this.stravaBusy.set(true);
    this.stravaError.set(null);
    try {
      window.location.href = await this.stravaService.connectUrl();
    } catch {
      this.stravaError.set('Could not start the Strava connection. Try again.');
      this.stravaBusy.set(false);
    }
  }

  async syncStrava(): Promise<void> {
    this.stravaBusy.set(true);
    this.stravaError.set(null);
    this.stravaSyncMessage.set(null);
    try {
      const result = await this.stravaService.sync();
      // Each sync re-checks the last few days, so "fetched" includes activities already in Forge.
      this.stravaSyncMessage.set(
        result.matchedExisting + result.createdNew === 0
          ? 'Up to date: no new activities on Strava.'
          : `${result.matchedExisting} activit${result.matchedExisting === 1 ? 'y' : 'ies'} matched to planned workouts, ${result.createdNew} added new.`,
      );
    } catch (err) {
      this.stravaError.set(apiErrorMessage(err, 'Could not sync with Strava. Try again.'));
    } finally {
      await this.loadStravaStatus();
      this.stravaBusy.set(false);
    }
  }

  async disconnectStrava(): Promise<void> {
    if (!confirm("Disconnect Strava? Already-synced workouts stay on your calendar, but syncing won't run again until you reconnect.")) {
      return;
    }
    this.stravaBusy.set(true);
    this.stravaError.set(null);
    try {
      await this.stravaService.disconnect();
      this.stravaStatus.set({ connected: false, stravaAthleteId: null, lastSyncAt: null, lastSyncError: null });
    } catch {
      this.stravaError.set('Could not disconnect Strava. Try again.');
    } finally {
      this.stravaBusy.set(false);
    }
  }

  private async loadRunnaStatus(): Promise<void> {
    try {
      this.runnaStatus.set(await this.runnaService.status());
    } catch {
      // The connect/sync buttons will surface any real error.
    }
  }

  private async runRunna(action: () => Promise<RunnaSyncResult>, fallback: string): Promise<void> {
    this.runnaBusy.set(true);
    this.runnaError.set(null);
    this.runnaMessage.set(null);
    try {
      this.runnaMessage.set(runnaSyncSummary(await action()));
      this.runnaLink.set('');
    } catch (err) {
      this.runnaError.set(apiErrorMessage(err, fallback));
    } finally {
      await this.loadRunnaStatus();
      this.runnaBusy.set(false);
    }
  }

  connectRunna(): Promise<void> {
    return this.runRunna(() => this.runnaService.connect(this.runnaLink()), 'Could not connect Runna. Try again.');
  }

  syncRunna(): Promise<void> {
    return this.runRunna(() => this.runnaService.sync(), 'Could not sync with Runna. Try again.');
  }

  async disconnectRunna(): Promise<void> {
    if (!confirm('Disconnect Runna? Your upcoming Runna workouts are removed from Forge; past and completed ones stay.')) {
      return;
    }
    this.runnaBusy.set(true);
    this.runnaError.set(null);
    this.runnaMessage.set(null);
    try {
      await this.runnaService.disconnect();
      this.runnaStatus.set({ feedUrl: null, lastSyncAt: null, lastSyncError: null });
    } catch (err) {
      this.runnaError.set(apiErrorMessage(err, 'Could not disconnect Runna. Try again.'));
    } finally {
      this.runnaBusy.set(false);
    }
  }

  private async loadRaceTarget(): Promise<void> {
    try {
      const race = await this.raceTargetService.get();
      this.raceForm.reset({ raceName: race.raceName ?? '', raceDate: race.raceDate ?? '' });
    } catch {
      // The save button will surface any real error; a failed initial load just leaves blanks.
    }
  }

  async saveRaceTarget(): Promise<void> {
    this.raceSaving.set(true);
    this.raceError.set(null);
    this.raceSaved.set(false);
    try {
      const v = this.raceForm.getRawValue();
      const updated = await this.raceTargetService.update({
        raceName: v.raceName?.trim() || null,
        raceDate: v.raceDate || null,
      });
      this.raceForm.reset({ raceName: updated.raceName ?? '', raceDate: updated.raceDate ?? '' });
      this.raceSaved.set(true);
      setTimeout(() => this.raceSaved.set(false), 2000);
    } catch (err) {
      this.raceError.set(saveErrorMessage(err, 'target race'));
    } finally {
      this.raceSaving.set(false);
    }
  }

  private async loadThresholds(): Promise<void> {
    try {
      const t = await this.thresholdsService.get();
      this.thresholdsForm.reset({
        ftpWatts: t.ftpWatts,
        runThresholdPace: formatPace(t.runThresholdPaceSecPerKm),
        swimThresholdPace: formatPace(t.swimThresholdPaceSec100m),
        thresholdHr: t.thresholdHr,
      });
    } catch {
      // The save button will surface any real error; a failed initial load just leaves blanks.
    }
  }

  async saveThresholds(): Promise<void> {
    const v = this.thresholdsForm.getRawValue();
    // A blank pace clears that threshold; anything else must parse, or a typo would silently
    // clear the saved value instead of flagging it.
    const runPace = parsePace(v.runThresholdPace ?? '');
    const swimPace = parsePace(v.swimThresholdPace ?? '');
    const invalid = [
      v.runThresholdPace?.trim() && runPace == null ? 'run threshold pace' : null,
      v.swimThresholdPace?.trim() && swimPace == null ? 'swim CSS' : null,
    ].filter((f): f is string => f != null);
    if (invalid.length) {
      this.thresholdsError.set(`Enter the ${invalid.join(' and ')} as mm:ss, e.g. 5:45.`);
      return;
    }

    this.thresholdsSaving.set(true);
    this.thresholdsError.set(null);
    this.thresholdsSaved.set(false);
    try {
      const updated = await this.thresholdsService.update({
        ftpWatts: v.ftpWatts,
        runThresholdPaceSecPerKm: runPace,
        swimThresholdPaceSec100m: swimPace,
        thresholdHr: v.thresholdHr,
      });
      this.thresholdsForm.reset({
        ftpWatts: updated.ftpWatts,
        runThresholdPace: formatPace(updated.runThresholdPaceSecPerKm),
        swimThresholdPace: formatPace(updated.swimThresholdPaceSec100m),
        thresholdHr: updated.thresholdHr,
      });
      this.thresholdsSaved.set(true);
      setTimeout(() => this.thresholdsSaved.set(false), 2000);
    } catch (err) {
      this.thresholdsError.set(saveErrorMessage(err, 'thresholds'));
    } finally {
      this.thresholdsSaving.set(false);
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.planImportService.list());
    } catch {
      // History is a convenience view; a failed load isn't worth surfacing an error banner for.
    }
  }

  private setFeed(status: CalendarFeedStatus): void {
    this.feedUrl.set(status.url);
    this.feedSports.set(status.sports);
  }

  private async loadFeedStatus(): Promise<void> {
    try {
      this.setFeed(await this.calendarFeedService.status());
    } catch {
      // Non-critical on load; the enable/regenerate button will surface any real error.
    }
  }

  webcalUrl(url: string): string {
    return url.replace(/^https?:\/\//, 'webcal://');
  }

  async enableFeed(): Promise<void> {
    this.feedBusy.set(true);
    this.feedError.set(null);
    try {
      this.setFeed(await this.calendarFeedService.generate());
    } catch {
      this.feedError.set('Could not set up the calendar feed. Try again.');
    } finally {
      this.feedBusy.set(false);
    }
  }

  async regenerateFeed(): Promise<void> {
    if (!confirm('Regenerating invalidates the current feed links, the per-sport ones included — any calendar already subscribed will stop updating until you re-subscribe with the new links. Continue?')) {
      return;
    }
    await this.enableFeed();
  }

  async disableFeed(): Promise<void> {
    this.feedBusy.set(true);
    this.feedError.set(null);
    try {
      await this.calendarFeedService.revoke();
      this.setFeed({ url: null, sports: [] });
    } catch {
      this.feedError.set('Could not disable the calendar feed. Try again.');
    } finally {
      this.feedBusy.set(false);
    }
  }

  async copyFeedUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedUrl.set(url);
      setTimeout(() => this.copiedUrl.update((current) => (current === url ? null : current)), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); the URL is still selectable text.
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
    this.error.set(null);
    this.lastResult.set(null);
  }

  async submit(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.submitting.set(true);
    this.error.set(null);
    try {
      const result = await this.planImportService.import(file, this.needsDate() ? this.importDate() : null);
      this.lastResult.set(result);
      this.history.set([result, ...this.history()]);
      this.selectedFile.set(null);
    } catch (err) {
      const serverMessage =
        err instanceof HttpErrorResponse && typeof err.error?.error === 'string' ? err.error.error : null;
      this.error.set(serverMessage ?? 'Could not import that file. Check the format and try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
