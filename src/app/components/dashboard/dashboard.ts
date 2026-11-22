import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import * as echarts from 'echarts';
import {
  DashboardStats,
  EventsPagination,
  SeismicEvent,
  SeismicService,
  WaveformPoint,
} from '../../services/seismic.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private seismicService = inject(SeismicService);

  @ViewChild('waveformChart', { static: true }) chartContainer!: ElementRef<HTMLDivElement>;
  private chart?: echarts.ECharts;
  private pollTimer?: ReturnType<typeof setInterval>;

  // KPI Stats
  stats = signal<DashboardStats>({
    total_readings: 0,
    total_events: 0,
    max_magnitude: 0,
    critical_alerts: 0,
  });

  // Ingestion ON/OFF switch
  ingestionEnabled = signal<boolean>(true);
  togglingIngestion = signal<boolean>(false);

  // Waveform & History Scroll state
  samples = signal<WaveformPoint[]>([]);
  isViewingHistory = signal<boolean>(false);
  isLoadingHistory = signal<boolean>(false);
  hasMoreHistory = signal<boolean>(true);

  // Server-Side Paginated Events
  events = signal<SeismicEvent[]>([]);
  pagination = signal<EventsPagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  loadingEvents = signal<boolean>(false);

  ngOnInit(): void {
    this.initChart();
    this.loadIngestionStatus();
    this.loadStats();
    this.loadLatestWaveforms();
    this.loadEvents(1, 10);

    // Poll every 2 seconds while in Live mode
    this.pollTimer = setInterval(() => {
      this.loadStats();
      if (!this.isViewingHistory()) {
        this.loadLatestWaveforms();
      }
      if (this.pagination().page === 1) {
        this.loadEvents(1, this.pagination().limit);
      }
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    window.removeEventListener('resize', this.handleResize);
    this.chart?.dispose();
  }

  // =========================================================================
  // 1. INGESTION ON/OFF SWITCH
  // =========================================================================
  loadIngestionStatus(): void {
    this.seismicService.getIngestionSetting().subscribe({
      next: (res) => this.ingestionEnabled.set(res.ingestion_enabled),
    });
  }

  toggleIngestion(): void {
    if (this.togglingIngestion()) return;
    const nextState = !this.ingestionEnabled();
    this.togglingIngestion.set(true);

    this.seismicService.setIngestionSetting(nextState).subscribe({
      next: (res) => {
        this.ingestionEnabled.set(res.ingestion_enabled);
        this.togglingIngestion.set(false);
      },
      error: () => this.togglingIngestion.set(false),
    });
  }

  // =========================================================================
  // 2. STATS
  // =========================================================================
  loadStats(): void {
    this.seismicService.getStats().subscribe({
      next: (res) => this.stats.set(res),
    });
  }

  // =========================================================================
  // 3. WAVEFORM CHART + SCROLLBAR HISTORY LOADING
  // =========================================================================
  private initChart(): void {
    this.chart = echarts.init(this.chartContainer.nativeElement);

    this.chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        top: 0,
        textStyle: { color: '#cbd5e1' },
      },
      grid: {
        top: 42,
        left: 48,
        right: 24,
        bottom: 78, // Leaves clean space for X-axis labels + slider
      },
      xAxis: {
        type: 'category',
        data: [],
        axisLabel: { color: '#94a3b8' },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        {
          type: 'slider',
          xAxisIndex: 0,
          bottom: 10,
          height: 24,
          borderColor: '#334155',
          backgroundColor: '#0f172a',
          fillerColor: 'rgba(56, 189, 248, 0.2)',
          textStyle: { color: '#94a3b8' },
        },
      ],
      series: [
        { name: 'X-Axis', type: 'line', showSymbol: false, smooth: true, lineStyle: { color: '#38bdf8', width: 2 }, data: [] },
        { name: 'Y-Axis', type: 'line', showSymbol: false, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, data: [] },
        { name: 'Z-Axis', type: 'line', showSymbol: false, smooth: true, lineStyle: { color: '#f472b6', width: 2 }, data: [] },
      ],
    });

    // Trigger history fetch when user scrolls/drags to the left edge
    this.chart.on('datazoom', (params: any) => {
      const start = params.batch ? params.batch[0]?.start : params.start;
      const end = params.batch ? params.batch[0]?.end : params.end;

      if (typeof end === 'number' && end < 98) {
        this.isViewingHistory.set(true);
      }

      if (typeof start === 'number' && start <= 5) {
        this.loadOlderWaveforms();
      }
    });

    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = () => this.chart?.resize();

  loadLatestWaveforms(): void {
    this.seismicService.getWaveforms(150).subscribe({
      next: (res) => {
        this.samples.set(res.data);
        this.hasMoreHistory.set(res.hasMore);
        this.renderChart(res.data);
      },
    });
  }

  loadOlderWaveforms(): void {
    const current = this.samples();
    if (this.isLoadingHistory() || !this.hasMoreHistory() || current.length === 0) {
      return;
    }

    this.isViewingHistory.set(true);
    this.isLoadingHistory.set(true);

    const oldestTs = current[0].timestamp;
    this.seismicService.getWaveforms(150, oldestTs).subscribe({
      next: (res) => {
        this.hasMoreHistory.set(res.hasMore);
        if (res.data.length > 0) {
          const merged = [...res.data, ...current];
          this.samples.set(merged);
          this.renderChart(merged);
        }
        this.isLoadingHistory.set(false);
      },
      error: () => this.isLoadingHistory.set(false),
    });
  }

  jumpToLive(): void {
    this.isViewingHistory.set(false);
    this.loadLatestWaveforms();
    this.chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
  }

  private renderChart(points: WaveformPoint[]): void {
    if (!this.chart) return;
    const labels = points.map((p) => new Date(Number(p.timestamp)).toLocaleTimeString());

    this.chart.setOption({
      xAxis: { data: labels },
      series: [
        { data: points.map((p) => p.x) },
        { data: points.map((p) => p.y) },
        { data: points.map((p) => p.z) },
      ],
    });
  }

  // =========================================================================
  // 4. SERVER-SIDE PAGINATED EVENTS TABLE
  // =========================================================================
  loadEvents(page: number, limit: number): void {
    this.loadingEvents.set(true);
    this.seismicService.getEvents(page, limit).subscribe({
      next: (res) => {
        this.events.set(res.data);
        this.pagination.set(res.pagination);
        this.loadingEvents.set(false);
      },
      error: () => this.loadingEvents.set(false),
    });
  }

  goToPage(page: number): void {
    const { totalPages, limit } = this.pagination();
    if (page < 1 || page > totalPages) return;
    this.loadEvents(page, limit);
  }

  onPageSizeChange(event: Event): void {
    const newLimit = Number((event.target as HTMLSelectElement).value);
    this.loadEvents(1, newLimit);
  }
}