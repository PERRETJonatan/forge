import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import type { PlanImport } from '@forge/shared';
import { CalendarFeedService } from '../calendar-feed/calendar-feed.service';
import { PlanImportService } from '../plan-import/plan-import.service';

const DATELESS_EXTENSIONS = new Set(['fit', 'tcx']);

function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.css',
})
export class SettingsPageComponent {
  private planImportService = inject(PlanImportService);
  private calendarFeedService = inject(CalendarFeedService);

  readonly feedUrl = signal<string | null>(null);
  readonly feedBusy = signal(false);
  readonly feedError = signal<string | null>(null);
  readonly feedCopied = signal(false);

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
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.planImportService.list());
    } catch {
      // History is a convenience view; a failed load isn't worth surfacing an error banner for.
    }
  }

  private async loadFeedStatus(): Promise<void> {
    try {
      this.feedUrl.set((await this.calendarFeedService.status()).url);
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
      this.feedUrl.set((await this.calendarFeedService.generate()).url);
    } catch {
      this.feedError.set('Could not set up the calendar feed. Try again.');
    } finally {
      this.feedBusy.set(false);
    }
  }

  async regenerateFeed(): Promise<void> {
    if (!confirm('Regenerating invalidates the current feed URL — any calendar already subscribed to it will stop updating until you re-subscribe with the new link. Continue?')) {
      return;
    }
    await this.enableFeed();
  }

  async disableFeed(): Promise<void> {
    this.feedBusy.set(true);
    this.feedError.set(null);
    try {
      await this.calendarFeedService.revoke();
      this.feedUrl.set(null);
    } catch {
      this.feedError.set('Could not disable the calendar feed. Try again.');
    } finally {
      this.feedBusy.set(false);
    }
  }

  async copyFeedUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.feedCopied.set(true);
      setTimeout(() => this.feedCopied.set(false), 2000);
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
