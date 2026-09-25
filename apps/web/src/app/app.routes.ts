import type { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { authGuard } from './core/auth.guard';
import { PlaceholderComponent } from './pages/placeholder/placeholder.component';
import { ShellComponent } from './shell/shell.component';

// Feature pages load on first visit rather than in the initial bundle.
export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'signup', component: SignupComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'calendar' },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./workouts/calendar-page/calendar-page.component').then((m) => m.CalendarPageComponent),
      },
      {
        path: 'builder',
        loadComponent: () =>
          import('./program-builder/program-builder-page.component').then((m) => m.ProgramBuilderPageComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent),
      },
      {
        path: 'coach',
        component: PlaceholderComponent,
        data: { title: 'Coach', note: 'Virtual coach chat lands in milestone 8.' },
      },
      {
        path: 'glossary',
        loadComponent: () => import('./glossary/glossary-page.component').then((m) => m.GlossaryPageComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings-page.component').then((m) => m.SettingsPageComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
