import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

function loginErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401) return 'Invalid email or password.';
    // Rate limited: the API's message says what was limited and for how long.
    if (err.status === 429) return typeof err.error?.error === 'string' ? err.error.error : 'Too many attempts. Try again later.';
    if (err.status === 0) return 'Could not reach the Forge server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: '../auth.css',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.authService.login(this.form.getRawValue() as { email: string; password: string });
      await this.router.navigateByUrl('/calendar');
    } catch (err) {
      this.error.set(loginErrorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
