import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { CoachMessage, CoachStatus, CoachWorkoutDraft } from '@forge/shared';
import { DISCIPLINE_COLORS, DISCIPLINE_LABELS } from '../workouts/discipline';
import { toDateKey } from '../workouts/date-utils';
import { TermComponent } from '../glossary/term.component';
import { CoachDraftHandoffService } from './coach-draft-handoff.service';
import { CoachService } from './coach.service';
import { describeSteps, formatMinutes } from './draft-format';

const SUGGESTIONS = [
  "How's my form this week?",
  'Am I ramping up too fast?',
  'How should I taper for my race?',
  'Give me a 90-minute sweet-spot ride for tomorrow',
];

@Component({
  selector: 'app-coach-page',
  standalone: true,
  imports: [DatePipe, RouterLink, TermComponent],
  templateUrl: './coach-page.component.html',
  styleUrl: './coach-page.component.css',
})
export class CoachPageComponent {
  private coachService = inject(CoachService);
  private handoff = inject(CoachDraftHandoffService);
  private router = inject(Router);

  readonly suggestions = SUGGESTIONS;
  readonly disciplineLabels = DISCIPLINE_LABELS;
  readonly disciplineColors = DISCIPLINE_COLORS;
  readonly describeSteps = describeSteps;
  readonly formatMinutes = formatMinutes;

  readonly messages = signal<CoachMessage[]>([]);
  readonly status = signal<CoachStatus | null>(null);
  readonly loading = signal(true);
  readonly draftText = signal('');
  /** The question being answered, shown in the thread until the reply comes back. */
  readonly pending = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  private thread = viewChild<ElementRef<HTMLElement>>('thread');
  private input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    void this.load();
    // Keep the newest message in view as the conversation grows.
    effect(() => {
      this.messages();
      this.pending();
      const el = this.thread()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  private async load(): Promise<void> {
    try {
      const [messages, status] = await Promise.all([this.coachService.messages(), this.coachService.status()]);
      this.messages.set(messages);
      this.status.set(status);
    } catch {
      this.error.set('Could not load your conversation. Try reloading the page.');
    } finally {
      this.loading.set(false);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter sends, Shift+Enter is a new line -- the usual chat convention.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  async send(text = this.draftText()): Promise<void> {
    const content = text.trim();
    if (!content || this.pending()) return;

    this.pending.set(content);
    this.draftText.set('');
    this.error.set(null);
    try {
      const { message, reply } = await this.coachService.send({ content, today: toDateKey(new Date()) });
      this.messages.set([...this.messages(), message, reply]);
      if (this.status()?.available === false) this.status.set({ ...this.status()!, available: true, error: null });
    } catch (err) {
      // Nothing was stored server-side: put the question back so it can be resent as is.
      this.draftText.set(content);
      this.error.set(this.serverError(err) ?? 'The coach could not answer. Try again.');
    } finally {
      this.pending.set(null);
      this.input()?.nativeElement.focus();
    }
  }

  async clear(): Promise<void> {
    if (!confirm('Clear the whole conversation with your coach? This can\'t be undone.')) return;
    try {
      await this.coachService.clear();
      this.messages.set([]);
    } catch {
      this.error.set('Could not clear the conversation. Try again.');
    }
  }

  openInBuilder(draft: CoachWorkoutDraft): void {
    this.handoff.offer(draft);
    void this.router.navigate(['/builder']);
  }

  private serverError(err: unknown): string | null {
    return err instanceof HttpErrorResponse && typeof err.error?.error === 'string' ? err.error.error : null;
  }
}
