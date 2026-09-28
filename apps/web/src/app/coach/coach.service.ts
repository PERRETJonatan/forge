import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type {
  CoachDraftRequest,
  CoachDraftResponse,
  CoachMessage,
  CoachStatus,
  SendCoachMessageRequest,
  SendCoachMessageResponse,
} from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CoachService {
  constructor(private http: HttpClient) {}

  status(): Promise<CoachStatus> {
    return firstValueFrom(this.http.get<CoachStatus>(`${environment.apiUrl}/coach/status`));
  }

  messages(): Promise<CoachMessage[]> {
    return firstValueFrom(this.http.get<CoachMessage[]>(`${environment.apiUrl}/coach/messages`));
  }

  send(request: SendCoachMessageRequest): Promise<SendCoachMessageResponse> {
    return firstValueFrom(this.http.post<SendCoachMessageResponse>(`${environment.apiUrl}/coach/messages`, request));
  }

  clear(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/coach/messages`));
  }

  draft(request: CoachDraftRequest): Promise<CoachDraftResponse> {
    return firstValueFrom(this.http.post<CoachDraftResponse>(`${environment.apiUrl}/coach/draft`, request));
  }
}
