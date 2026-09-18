import type { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { authGuard } from './core/auth.guard';
import { PlaceholderComponent } from './pages/placeholder/placeholder.component';
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
        component: PlaceholderComponent,
        data: { title: 'Program builder', note: 'Structured workout builder lands in milestone 4.' },
      },
      {
        path: 'dashboard',
        component: PlaceholderComponent,
        data: { title: 'Fitness dashboard', note: 'CTL/ATL/TSB dashboard lands in milestone 6.' },
      },
      {
        path: 'coach',
        component: PlaceholderComponent,
        data: { title: 'Coach', note: 'Virtual coach chat lands in milestone 7.' },
      },
      {
        path: 'settings',
        component: SettingsPageComponent,
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
