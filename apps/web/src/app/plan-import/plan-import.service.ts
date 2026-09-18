import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { PlanImport } from '@forge/shared';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PlanImportService {
  constructor(private http: HttpClient) {}

  list(): Promise<PlanImport[]> {
    return firstValueFrom(this.http.get<PlanImport[]>(`${environment.apiUrl}/plan-imports`));
  }

  import(file: File, date: string | null): Promise<PlanImport> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (date) {
      formData.append('date', date);
    }
    return firstValueFrom(this.http.post<PlanImport>(`${environment.apiUrl}/plan-imports`, formData));
  }
}
