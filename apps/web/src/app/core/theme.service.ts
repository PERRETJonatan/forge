import { Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Same key the inline script in index.html reads to apply the theme before first paint. */
const STORAGE_KEY = 'forge.theme';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Light/dark theme. "system" leaves `data-theme` off <html> so styles.css follows the OS via
 * prefers-color-scheme; "light"/"dark" force one. Stored per browser -- it's a display
 * preference for this device, not account data.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(readStored());

  constructor() {
    this.apply(this.preference());
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this visit.
    }
    this.apply(preference);
  }

  private apply(preference: ThemePreference): void {
    const root = document.documentElement;
    if (preference === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = preference;
  }
}
