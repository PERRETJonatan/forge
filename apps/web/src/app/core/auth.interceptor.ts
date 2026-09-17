import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const UNAUTHENTICATED_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const accessToken = authService.getAccessToken();

  const authedReq = accessToken ? req.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      const isUnauthorized = err instanceof HttpErrorResponse && err.status === 401;
      const isAuthEndpoint = UNAUTHENTICATED_PATHS.some((path) => req.url.includes(path));
      if (!isUnauthorized || isAuthEndpoint) {
        return throwError(() => err);
      }
      return from(authService.refreshAccessToken()).pipe(
        switchMap((newAccessToken) => {
          const retriedReq = req.clone({ setHeaders: { Authorization: `Bearer ${newAccessToken}` } });
          return next(retriedReq);
        }),
        catchError((refreshErr: unknown) => {
          void authService.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
