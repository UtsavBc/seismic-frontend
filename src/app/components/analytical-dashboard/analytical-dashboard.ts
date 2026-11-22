import { Component, ElementRef, OnInit, OnDestroy, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as echarts from 'echarts';
import { SeismicEvent, SeismicAnalyticsService } from '../../services/seismic-analytics';

@Component({
  selector: 'app-analytical-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard-grid">
      <!-- KPI Cards -->
      <div class="kpi-card">
        <h3>Total Events (30 Days)</h3>
        <div class="kpi-value">{{ totalEvents }}</div>
      </div>
      <div class="kpi-card">
        <h3>Max Magnitude</h3>
        <div class="kpi-value warning">{{ maxMagnitude }}</div>
      </div>
      <div class="kpi-card">
        <h3>Average Depth</h3>
        <div class="kpi-value">{{ avgDepth }} km</div>
      </div>
      <div class="kpi-card">
        <h3>Most Active Region</h3>
        <div class="kpi-value text-small">{{ mostActiveRegion }}</div>
      </div>

      <!-- Charts -->
      <div class="chart-panel span-2">
        <h3>Seismic Frequency (Last 30 Days)</h3>
        <div #barChart class="echarts-container"></div>
      </div>
      <div class="chart-panel">
        <h3>Magnitude Distribution</h3>
        <div #pieChart class="echarts-container"></div>
      </div>

      <!-- Data Table -->
      <div class="table-panel span-3">
        <h3>Recent Seismic Events Log</h3>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Location</th>
                <th>Magnitude</th>
                <th>Depth</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let event of events">
                <td>{{ event.date | date:'medium' }}</td>
                <td>{{ event.location }}</td>
                <td><strong [ngClass]="getMagnitudeClass(event.magnitude)">{{ event.magnitude }}</strong></td>
                <td>{{ event.depth }} km</td>
                <td>
                  <span class="badge" [ngClass]="getMagnitudeClass(event.magnitude)">{{ event.status }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      padding: 20px;
      color: #fff;
    }
    .span-2 { grid-column: span 2; }
    .span-3 { grid-column: span 3; }
    .kpi-card, .chart-panel, .table-panel {
      background: #1e1e1e;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    h3 { margin-top: 0; color: #a0a0a0; font-size: 1rem; font-weight: 500; }
    .kpi-value { font-size: 2.5rem; font-weight: bold; margin-top: 10px; }
    .kpi-value.warning { color: #ff4d4d; }
    .kpi-value.text-small { font-size: 1.5rem; margin-top: 15px; }
    .echarts-container { width: 100%; height: 300px; }
    
    /* Table Styles */
    .table-responsive { max-height: 400px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: #2a2a2a; padding: 12px; position: sticky; top: 0; }
    td { padding: 12px; border-bottom: 1px solid #333; }
    .mag-low { color: #4dff4d; }
    .mag-med { color: #ffd11a; }
    .mag-high { color: #ff4d4d; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; background: #333; }
  `]
})
export class AnalyticalDashboardComponent implements OnInit, OnDestroy {
  @ViewChild('barChart', { static: true }) barChartRef!: ElementRef;
  @ViewChild('pieChart', { static: true }) pieChartRef!: ElementRef;

  private barChart!: echarts.ECharts;
  private pieChart!: echarts.ECharts;

  events: SeismicEvent[] = [];
  
  // KPIs
  totalEvents = 0;
  maxMagnitude = 0;
  avgDepth = 0;
  mostActiveRegion = '';

  constructor(private analyticsService: SeismicAnalyticsService) {}

  ngOnInit() {
    this.analyticsService.getHistoricalData().subscribe(data => {
      this.events = data;
      this.calculateKPIs();
      this.initCharts();
    });
  }

  calculateKPIs() {
    this.totalEvents = this.events.length;
    this.maxMagnitude = Math.max(...this.events.map(e => e.magnitude));
    this.avgDepth = parseFloat((this.events.reduce((acc, e) => acc + e.depth, 0) / this.events.length).toFixed(1));
    
    // Calculate most active region
    const regionCounts = this.events.reduce((acc, e) => {
      acc[e.location] = (acc[e.location] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    this.mostActiveRegion = Object.keys(regionCounts).reduce((a, b) => regionCounts[a] > regionCounts[b] ? a : b);
  }

  initCharts() {
    this.barChart = echarts.init(this.barChartRef.nativeElement, 'dark');
    this.pieChart = echarts.init(this.pieChartRef.nativeElement, 'dark');

    // Prepare Pie Chart Data
    const statusCounts = this.events.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const pieData = Object.keys(statusCounts).map(key => ({ name: key, value: statusCounts[key] }));

    this.barChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: this.events.slice(0, 15).map(e => new Date(e.date).toLocaleDateString()) },
      yAxis: { type: 'value', name: 'Magnitude' },
      series: [{ data: this.events.slice(0, 15).map(e => e.magnitude), type: 'bar', itemStyle: { color: '#4d4dff' } }]
    });

    this.pieChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        data: pieData,
        itemStyle: { borderRadius: 10, borderColor: '#1e1e1e', borderWidth: 2 }
      }]
    });
  }

  getMagnitudeClass(mag: number): string {
    if (mag >= 5.0) return 'mag-high';
    if (mag >= 3.0) return 'mag-med';
    return 'mag-low';
  }

  @HostListener('window:resize')
  onResize() {
    if (this.barChart) this.barChart.resize();
    if (this.pieChart) this.pieChart.resize();
  }

  ngOnDestroy() {
    if (this.barChart) this.barChart.dispose();
    if (this.pieChart) this.pieChart.dispose();
  }
}