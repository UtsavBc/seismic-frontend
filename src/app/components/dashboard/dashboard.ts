import {
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, exhaustMap, filter, timer } from 'rxjs';
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
  imports: [DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private seismicService = inject(SeismicService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('waveformChart', { static: true }) chartContainer!: ElementRef<HTMLDivElement>;
  private chart?: echarts.ECharts;
  private lastSeenTimestamp = 0;
  private isResettingZoom = false;
  private zoomStart = 0;
  private zoomEnd = 100;
  private readonly MAX_SAMPLES_IN_MEMORY = 1500;

  // KPI Stats
  stats = signal<DashboardStats>({
    total_readings: 0,
    total_events: 0,
    max_magnitude: 0,
    critical_alerts: 0,
  });

  // Controls
  ingestionEnabled = signal<boolean>(true);
  togglingIngestion = signal<boolean>(false);
  livePolling = signal<boolean>(false); // OFF by default to save Vercel/Neon calls
  isRefreshing = signal<boolean>(false);

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
    this.refreshAll(); // Single initial fetch on load
    this.startLivePollingLoop();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.chart?.dispose();
  }

  // =========================================================================
  // MANUAL REFRESH & LIVE POLLING (AUTO-FETCH NEWER DATA EVERY 3s)
  // =========================================================================
  toggleLivePolling(): void {
    const next = !this.livePolling();
    this.livePolling.set(next);
    if (next) {
      this.isViewingHistory.set(false);
      this.refreshAll();
    }
  }

  refreshAll(): void {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    this.isViewingHistory.set(false);

    this.loadStats();
    this.loadEvents(this.pagination().page, this.pagination().limit);

    this.seismicService
      .getWaveforms(150)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.hasMoreHistory.set(res.hasMore);
          this.samples.set(res.data);
          this.lastSeenTimestamp =
            res.data.length > 0 ? Number(res.data[res.data.length - 1].timestamp) : 0;

          this.renderChart(res.data);

          // Reset zoom without triggering history-load listener
          this.zoomStart = 0;
          this.zoomEnd = 100;
          this.isResettingZoom = true;
          this.chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
          setTimeout(() => (this.isResettingZoom = false), 50);

          this.isRefreshing.set(false);
        },
        error: () => this.isRefreshing.set(false),
      });
  }

  private startLivePollingLoop(): void {
    // Runs every 3 seconds ONLY when Live Poll is ON, tab is visible, DB ingestion is ON, and not in history mode
    timer(3000, 3000)
      .pipe(
        filter(
          () =>
            this.livePolling() &&
            !document.hidden &&
            this.ingestionEnabled() &&
            !this.isViewingHistory()
        ),
        exhaustMap(() =>
          this.seismicService.getWaveforms(150).pipe(catchError(() => EMPTY))
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.hasMoreHistory.set(res.hasMore);

        const latestTs =
          res.data.length > 0 ? Number(res.data[res.data.length - 1].timestamp) : 0;

        // Only update chart, stats, and events when NEW data arrives
        if (latestTs !== this.lastSeenTimestamp) {
          this.lastSeenTimestamp = latestTs;
          this.samples.set(res.data);
          this.renderChart(res.data);

          this.loadStats();
          if (this.pagination().page === 1) {
            this.loadEvents(1, this.pagination().limit);
          }
        }
      });
  }

  // =========================================================================
  // 1. INGESTION ON/OFF SWITCH
  // =========================================================================
  loadIngestionStatus(): void {
    this.seismicService
      .getIngestionSetting()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.ingestionEnabled.set(res.ingestion_enabled),
      });
  }

  toggleIngestion(): void {
    if (this.togglingIngestion()) return;
    const nextState = !this.ingestionEnabled();
    this.togglingIngestion.set(true);

    this.seismicService
      .setIngestionSetting(nextState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
    this.seismicService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
        bottom: 78,
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
        {
          name: 'X-Axis',
          type: 'line',
          showSymbol: false,
          smooth: true,
          lineStyle: { color: '#38bdf8', width: 2 },
          data: [],
        },
        {
          name: 'Y-Axis',
          type: 'line',
          showSymbol: false,
          smooth: true,
          lineStyle: { color: '#22c55e', width: 2 },
          data: [],
        },
        {
          name: 'Z-Axis',
          type: 'line',
          showSymbol: false,
          smooth: true,
          lineStyle: { color: '#f472b6', width: 2 },
          data: [],
        },
      ],
    });

    this.chart.on('datazoom', (params: any) => {
      if (this.isResettingZoom) return;

      const start = params.batch ? params.batch[0]?.start : params.start;
      const end = params.batch ? params.batch[0]?.end : params.end;

      if (typeof start === 'number') this.zoomStart = start;
      if (typeof end === 'number') {
        this.zoomEnd = end;
        this.isViewingHistory.set(end < 98);
      }

      if (typeof start === 'number' && typeof end === 'number' && start <= 5 && end < 98) {
        this.loadOlderWaveforms();
      }
    });

    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = () => this.chart?.resize();

  loadOlderWaveforms(): void {
    const current = this.samples();
    if (
      this.isLoadingHistory() ||
      !this.hasMoreHistory() ||
      current.length === 0 ||
      current.length >= this.MAX_SAMPLES_IN_MEMORY
    ) {
      return;
    }

    this.isViewingHistory.set(true);
    this.isLoadingHistory.set(true);

    const oldestTs = current[0].timestamp;
    this.seismicService
      .getWaveforms(150, oldestTs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.hasMoreHistory.set(res.hasMore);
          if (res.data.length > 0) {
            const oldLen = current.length;
            const added = res.data.length;
            const merged = [...res.data, ...current];
            const newLen = merged.length;

            this.samples.set(merged);
            this.renderChart(merged);

            // Shift the slider right by `added` samples so the new 150 sit cleanly to the left
            const oldStartIdx = (this.zoomStart / 100) * Math.max(oldLen - 1, 1);
            const oldEndIdx = (this.zoomEnd / 100) * Math.max(oldLen - 1, 1);

            const newStart = ((oldStartIdx + added) / Math.max(newLen - 1, 1)) * 100;
            const newEnd = Math.min(
              100,
              ((oldEndIdx + added) / Math.max(newLen - 1, 1)) * 100
            );

            this.zoomStart = newStart;
            this.zoomEnd = newEnd;

            this.isResettingZoom = true;
            this.chart?.dispatchAction({
              type: 'dataZoom',
              start: newStart,
              end: newEnd,
            });
            setTimeout(() => (this.isResettingZoom = false), 50);
          }
          this.isLoadingHistory.set(false);
        },
        error: () => this.isLoadingHistory.set(false),
      });
  }

  jumpToLive(): void {
    this.refreshAll();
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
    this.seismicService
      .getEvents(page, limit)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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

  formatEventTime(value: string | number): string {
    if (!value) return '-';
    return new Date(value).toLocaleString();
  }
}