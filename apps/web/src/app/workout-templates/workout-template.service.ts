import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { CreateWorkoutTemplateRequest, UpdateWorkoutTemplateRequest, Workout, WorkoutTemplate } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WorkoutTemplateService {
  constructor(private http: HttpClient) {}

  list(): Promise<WorkoutTemplate[]> {
    return firstValueFrom(this.http.get<WorkoutTemplate[]>(`${environment.apiUrl}/workout-templates`));
  }

  create(request: CreateWorkoutTemplateRequest): Promise<WorkoutTemplate> {
    return firstValueFrom(this.http.post<WorkoutTemplate>(`${environment.apiUrl}/workout-templates`, request));
  }

  update(id: string, request: UpdateWorkoutTemplateRequest): Promise<WorkoutTemplate> {
    return firstValueFrom(this.http.patch<WorkoutTemplate>(`${environment.apiUrl}/workout-templates/${id}`, request));
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${environment.apiUrl}/workout-templates/${id}`));
  }

  /** Creates a manual workout from the template's steps on `date`. */
  apply(id: string, date: string): Promise<Workout> {
    return firstValueFrom(this.http.post<Workout>(`${environment.apiUrl}/workout-templates/${id}/apply`, { date }));
  }
}
