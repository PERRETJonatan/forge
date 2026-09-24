import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { AthleteThresholds, UpdateAthleteThresholdsRequest } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ThresholdsService {
  constructor(private http: HttpClient) {}

  get(): Promise<AthleteThresholds> {
    return firstValueFrom(this.http.get<AthleteThresholds>(`${environment.apiUrl}/me/thresholds`));
  }

  update(request: UpdateAthleteThresholdsRequest): Promise<AthleteThresholds> {
    return firstValueFrom(this.http.patch<AthleteThresholds>(`${environment.apiUrl}/me/thresholds`, request));
  }
}
