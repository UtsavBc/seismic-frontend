// import { Component, signal } from '@angular/core';
// import { RouterOutlet } from '@angular/router';
// import { WaveformComponent } from './components/waveform/waveform';
// import { AnalyticalDashboardComponent } from './components/analytical-dashboard/analytical-dashboard';
// import { CommonModule } from '@angular/common';

// @Component({
//   imports: [RouterOutlet, WaveformComponent, AnalyticalDashboardComponent, CommonModule],
//   selector: 'app-root',
//   styleUrl: './app.scss',
//   templateUrl: './app.html',
// })
// export class App {
//   protected readonly title = signal('seismic-dashboard');
//   currentView: 'realtime' | 'analytics' = 'realtime';
// }



import { Component } from '@angular/core';
import { DashboardComponent } from './components/dashboard/dashboard';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DashboardComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}