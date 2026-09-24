import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { CalendarFeedStatus } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CalendarFeedService {
  constructor(private http: HttpClient) {}

  status(): Promise<CalendarFeedStatus> {
    return firstValueFrom(this.http.get<CalendarFeedStatus>(`${environment.apiUrl}/calendar-feed`));
  }

  /** Enables sync, or rotates the token if it's already enabled (invalidates the old URL). */
  generate(): Promise<CalendarFeedStatus> {
    return firstValueFrom(this.http.post<CalendarFeedStatus>(`${environment.apiUrl}/calendar-feed`, {}));
  }

  revoke(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/calendar-feed`));
  }
}
