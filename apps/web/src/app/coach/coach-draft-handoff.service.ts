import { Injectable } from '@angular/core';
import type { CoachWorkoutDraft } from '@forge/shared';

/**
 * Carries a coach draft from the chat to the program builder ("Open in builder"). The builder
 * takes it once on load and pre-fills itself; nothing is saved until the athlete reviews it
 * there and adds it to the calendar -- the coach never writes to the calendar itself.
 */
@Injectable({ providedIn: 'root' })
export class CoachDraftHandoffService {
  private pending: CoachWorkoutDraft | null = null;

  offer(draft: CoachWorkoutDraft): void {
    this.pending = draft;
  }

  take(): CoachWorkoutDraft | null {
    const draft = this.pending;
    this.pending = null;
    return draft;
  }
}
