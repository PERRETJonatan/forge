import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { RunnaStatus, RunnaSyncResult } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RunnaService {
  constructor(private http: HttpClient) {}

  status(): Promise<RunnaStatus> {
    return firstValueFrom(this.http.get<RunnaStatus>(`${environment.apiUrl}/runna`));
  }

  /** Saves the calendar link and runs the first sync; rejected if the link doesn't work. */
  connect(feedUrl: string): Promise<RunnaSyncResult> {
    return firstValueFrom(this.http.put<RunnaSyncResult>(`${environment.apiUrl}/runna`, { feedUrl }));
  }

  sync(): Promise<RunnaSyncResult> {
    return firstValueFrom(this.http.post<RunnaSyncResult>(`${environment.apiUrl}/runna/sync`, {}));
  }

  disconnect(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/runna`));
  }
}
