import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { FitnessDashboard, FitnessDashboardQuery } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FitnessService {
  constructor(private http: HttpClient) {}

  dashboard(query: FitnessDashboardQuery): Promise<FitnessDashboard> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.today) params = params.set('today', query.today);
    return firstValueFrom(this.http.get<FitnessDashboard>(`${environment.apiUrl}/fitness/dashboard`, { params }));
  }
}
