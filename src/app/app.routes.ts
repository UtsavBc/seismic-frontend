import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard';
import { DataManagerComponent } from './components/data-manager/data-manager';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'manage', component: DataManagerComponent },
  { path: '**', redirectTo: 'dashboard' },
];