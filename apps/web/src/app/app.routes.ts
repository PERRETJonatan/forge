import type { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { authGuard } from './core/auth.guard';
import { DashboardPageComponent } from './dashboard/dashboard-page.component';
import { PlaceholderComponent } from './pages/placeholder/placeholder.component';
import { ProgramBuilderPageComponent } from './program-builder/program-builder-page.component';
import { SettingsPageComponent } from './settings/settings-page.component';
import { ShellComponent } from './shell/shell.component';
import { CalendarPageComponent } from './workouts/calendar-page/calendar-page.component';

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
        component: CalendarPageComponent,
      },
      {
        path: 'builder',
        component: ProgramBuilderPageComponent,
      },
      {
        path: 'dashboard',
        component: DashboardPageComponent,
      },
      {
        path: 'coach',
        component: PlaceholderComponent,
        data: { title: 'Coach', note: 'Virtual coach chat lands in milestone 8.' },
      },
      {
        path: 'settings',
        component: SettingsPageComponent,
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
