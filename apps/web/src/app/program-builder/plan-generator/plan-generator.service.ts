import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { PlanApplyResult, PlanGenerationRequest, PlanPreview } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** `today` is the client's calendar day, so "can't start in the past" follows the athlete's timezone. */
type GeneratorRequest = PlanGenerationRequest & { today: string };

@Injectable({ providedIn: 'root' })
export class PlanGeneratorService {
  constructor(private http: HttpClient) {}

  preview(request: GeneratorRequest): Promise<PlanPreview> {
    return firstValueFrom(this.http.post<PlanPreview>(`${environment.apiUrl}/plan-generator/preview`, request));
  }

  apply(request: GeneratorRequest): Promise<PlanApplyResult> {
    return firstValueFrom(this.http.post<PlanApplyResult>(`${environment.apiUrl}/plan-generator/apply`, request));
  }
}
