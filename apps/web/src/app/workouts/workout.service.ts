import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { CreateWorkoutRequest, Discipline, UpdateWorkoutRequest, Workout } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WorkoutFilter {
  from?: string;
  to?: string;
  discipline?: Discipline;
  completed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkoutService {
  constructor(private http: HttpClient) {}

  list(filter: WorkoutFilter = {}): Promise<Workout[]> {
    let params = new HttpParams();
    if (filter.from) params = params.set('from', filter.from);
    if (filter.to) params = params.set('to', filter.to);
    if (filter.discipline) params = params.set('discipline', filter.discipline);
    if (filter.completed !== undefined) params = params.set('completed', String(filter.completed));
    return firstValueFrom(this.http.get<Workout[]>(`${environment.apiUrl}/workouts`, { params }));
  }

  create(request: CreateWorkoutRequest): Promise<Workout> {
    return firstValueFrom(this.http.post<Workout>(`${environment.apiUrl}/workouts`, request));
  }

  update(id: string, request: UpdateWorkoutRequest): Promise<Workout> {
    return firstValueFrom(this.http.patch<Workout>(`${environment.apiUrl}/workouts/${id}`, request));
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/workouts/${id}`));
  }
}
