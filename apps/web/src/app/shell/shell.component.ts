import { Component, HostListener, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ThemeService, type ThemePreference } from '../core/theme.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent {
  readonly themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /** The phone-width nav drawer; the sidebar is always shown on wider screens. */
  readonly menuOpen = signal(false);

  constructor(
    protected authService: AuthService,
    protected themeService: ThemeService,
    private router: Router,
  ) {}

  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigateByUrl('/login');
  }
}
