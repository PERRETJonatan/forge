import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard', () => {
  function runGuard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as boolean | UrlTree;
  }

  it('redirects to /login when there is no authenticated athlete', () => {
    const authServiceStub = { isAuthenticated: () => false };
    const createUrlTreeSpy = jasmine.createSpy('createUrlTree').and.returnValue('login-tree');

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceStub },
        { provide: Router, useValue: { createUrlTree: createUrlTreeSpy } },
      ],
    });

    const result = runGuard();

    expect(createUrlTreeSpy).toHaveBeenCalledWith(['/login']);
    expect(result).toBe('login-tree' as unknown as UrlTree);
  });

  it('allows navigation when the athlete is authenticated', () => {
    const authServiceStub = { isAuthenticated: () => true };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceStub },
        { provide: Router, useValue: {} },
      ],
    });

    expect(runGuard()).toBe(true);
  });
});
