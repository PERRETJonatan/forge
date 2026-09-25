import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { RaceTarget, UpdateRaceTargetRequest } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RaceTargetService {
  constructor(private http: HttpClient) {}

  get(): Promise<RaceTarget> {
    return firstValueFrom(this.http.get<RaceTarget>(`${environment.apiUrl}/me/race-target`));
  }

  update(request: UpdateRaceTargetRequest): Promise<RaceTarget> {
    return firstValueFrom(this.http.patch<RaceTarget>(`${environment.apiUrl}/me/race-target`, request));
  }
}
