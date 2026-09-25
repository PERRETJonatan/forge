import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { StravaStatus, StravaSyncResult } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class StravaService {
  constructor(private http: HttpClient) {}

  status(): Promise<StravaStatus> {
    return firstValueFrom(this.http.get<StravaStatus>(`${environment.apiUrl}/strava/status`));
  }

  connectUrl(): Promise<string> {
    return firstValueFrom(this.http.get<{ url: string }>(`${environment.apiUrl}/strava/connect-url`)).then((r) => r.url);
  }

  sync(): Promise<StravaSyncResult> {
    return firstValueFrom(this.http.post<StravaSyncResult>(`${environment.apiUrl}/strava/sync`, {}));
  }

  disconnect(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/strava/connection`));
  }
}
