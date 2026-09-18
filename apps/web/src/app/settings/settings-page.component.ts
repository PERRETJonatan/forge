import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import type { PlanImport } from '@forge/shared';
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
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.planImportService.list());
    } catch {
      // History is a convenience view; a failed load isn't worth surfacing an error banner for.
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
