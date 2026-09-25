import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import type { Athlete, AuthTokens, LoginRequest } from '@forge/shared';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const REFRESH_TOKEN_KEY = 'forge_refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private accessToken: string | null = null;

  readonly athlete = signal<Athlete | null>(null);
  readonly resolved = signal(false);

  constructor(private http: HttpClient) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    return this.athlete() !== null;
  }

  async login(request: LoginRequest): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ athlete: Athlete } & AuthTokens>(`${environment.apiUrl}/auth/login`, request),
    );
    this.applySession(res.athlete, res.accessToken, res.refreshToken);
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken }).pipe(catchError(() => of(null))),
      );
    }
    this.clearSession();
  }

  /** Called once at app startup to restore a session from a persisted refresh token. */
  async restoreSession(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      this.resolved.set(true);
      return;
    }
    try {
      const tokens = await firstValueFrom(
        this.http.post<AuthTokens>(`${environment.apiUrl}/auth/refresh`, { refreshToken }),
      );
      this.accessToken = tokens.accessToken;
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
      const athlete = await firstValueFrom(this.http.get<Athlete>(`${environment.apiUrl}/auth/me`));
      this.athlete.set(athlete);
    } catch {
      this.clearSession();
    } finally {
      this.resolved.set(true);
    }
  }

  /** Used by the auth interceptor to silently refresh on a 401. */
  async refreshAccessToken(): Promise<string> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    const tokens = await firstValueFrom(
      this.http.post<AuthTokens>(`${environment.apiUrl}/auth/refresh`, { refreshToken }),
    );
    this.accessToken = tokens.accessToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return tokens.accessToken;
  }

  private applySession(athlete: Athlete, accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    this.athlete.set(athlete);
    this.resolved.set(true);
  }

  private clearSession(): void {
    this.accessToken = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.athlete.set(null);
  }
}
