import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, exhaustMap, filter, of, timer } from 'rxjs';
import * as echarts from 'echarts';
import * as ExcelJS from 'exceljs';
import {
  DashboardStats,
  EventsPagination,
  SeismicEvent,
  SeismicService,
  WaveformSample,
} from './../../services/seismic.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent implements OnInit {
  private seismicService = inject(SeismicService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('waveformChart', { static: true })
  chartContainer!: ElementRef<HTMLDivElement>;

  private chartInstance: echarts.ECharts | null = null;
  private lastSeenTimestamp = 0;
  private lastSeenEventId = 0;

  // Core Data Signals
  samples = signal<WaveformSample[]>([]);
  events = signal<SeismicEvent[]>([]);
  stats = signal<DashboardStats>({
    total_events: 0,
    max_magnitude: 0,
    critical_alerts: 0,
    total_readings: 0,
  });
  pagination = signal<EventsPagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  // Controls & Status
  ingestionEnabled = signal<boolean>(true);
  livePolling = signal<boolean>(false);
  isViewingHistory = signal<boolean>(false);
  hasMoreHistory = signal<boolean>(false);
  loadingWaveforms = signal<boolean>(false);
  loadingEvents = signal<boolean>(false);

  // Search, Selection, Import, Manual Entry & Edit State
  searchQuery = signal<string>('');
  selectedEventIds = signal<number[]>([]);
  isImporting = signal<boolean>(false);
  importMessage = signal<string>('');
  showAddForm = signal<boolean>(false);
  newReading = { x: 0, y: 0, z: 0 };

  editingEventId = signal<number | null>(null);
  editForm = { magnitude: 0, status: 'Moderate' };

  ngOnInit(): void {
    this.initChart();
    this.loadIngestionSetting();
    this.refreshAll();
    this.startLivePollingLoop();
  }

  // =========================================================================
  // CHART SETUP & RENDERING
  // =========================================================================
  private initChart(): void {
    this.chartInstance = echarts.init(this.chartContainer.nativeElement);
    window.addEventListener('resize', () => this.chartInstance?.resize());
  }

  private renderChart(data: WaveformSample[], preserveZoom = false): void {
    if (!this.chartInstance) return;

    const timestamps = data.map((d) => this.formatShortTime(d.timestamp));
    const xData = data.map((d) => d.x);
    const yData = data.map((d) => d.y);
    const zData = data.map((d) => d.z);

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['X-Axis', 'Y-Axis', 'Z-Axis'],
        textStyle: { color: '#cbd5e1' },
      },
      grid: { left: 45, right: 20, top: 35, bottom: 65 },
      xAxis: {
        type: 'category',
        data: timestamps,
        axisLabel: { color: '#94a3b8' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      },
      dataZoom: preserveZoom
        ? undefined
        : [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 22, bottom: 10 },
          ],
      series: [
        { name: 'X-Axis', type: 'line', showSymbol: false, data: xData, lineStyle: { width: 1.5 } },
        { name: 'Y-Axis', type: 'line', showSymbol: false, data: yData, lineStyle: { width: 1.5 } },
        { name: 'Z-Axis', type: 'line', showSymbol: false, data: zData, lineStyle: { width: 1.5 } },
      ],
    };

    this.chartInstance.setOption(option, !preserveZoom);
  }

  // =========================================================================
  // LIVE POLLING & DATA LOADING
  // =========================================================================
  private startLivePollingLoop(): void {
    timer(3000, 3000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(
          () =>
            this.livePolling() &&
            !document.hidden &&
            this.ingestionEnabled() &&
            !this.isViewingHistory()
        ),
        exhaustMap(() =>
          this.seismicService.getLatestWaveforms(150).pipe(catchError(() => of(null)))
        )
      )
      .subscribe((res) => {
        if (!res) return;
        this.hasMoreHistory.set(res.hasMore);

        const latestTs =
          res.data.length > 0 ? Number(res.data[res.data.length - 1].timestamp) : 0;

        if (latestTs !== this.lastSeenTimestamp) {
          this.lastSeenTimestamp = latestTs;
          this.samples.set(res.data);
          this.renderChart(res.data);
          this.loadStats();
        }

        if (res.latestEventId && res.latestEventId !== this.lastSeenEventId) {
          this.lastSeenEventId = res.latestEventId;
          if (this.pagination().page === 1) {
            this.loadEvents(1, this.pagination().limit);
          }
        }
      });
  }

  refreshAll(): void {
    this.isViewingHistory.set(false);
    this.loadLatestWaveforms();
    this.loadStats();
    this.loadEvents(1, this.pagination().limit);
  }

  loadLatestWaveforms(): void {
    this.loadingWaveforms.set(true);
    this.seismicService
      .getLatestWaveforms(150)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.samples.set(res.data);
          this.hasMoreHistory.set(res.hasMore);
          this.lastSeenTimestamp =
            res.data.length > 0 ? Number(res.data[res.data.length - 1].timestamp) : 0;
          if (res.latestEventId !== undefined) {
            this.lastSeenEventId = res.latestEventId;
          }
          this.renderChart(res.data);
          this.loadingWaveforms.set(false);
        },
        error: () => this.loadingWaveforms.set(false),
      });
  }

  loadOlderHistory(): void {
    const current = this.samples();
    if (current.length === 0 || !this.hasMoreHistory()) return;

    this.isViewingHistory.set(true);
    const oldestTs = current[0].timestamp;

    this.seismicService
      .getLatestWaveforms(150, oldestTs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        const merged = [...res.data, ...current];
        this.samples.set(merged);
        this.hasMoreHistory.set(res.hasMore);
        this.renderChart(merged, true);
      });
  }

  jumpToLive(): void {
    this.isViewingHistory.set(false);
    this.loadLatestWaveforms();
  }

  loadStats(): void {
    this.seismicService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.stats.set(res));
  }

  loadEvents(page: number, limit: number): void {
    this.loadingEvents.set(true);
    this.seismicService
      .getEvents(page, limit, this.searchQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.events.set(res.data);
          this.pagination.set(res.pagination);
          this.selectedEventIds.set([]);
          this.loadingEvents.set(false);
        },
        error: () => this.loadingEvents.set(false),
      });
  }

  loadIngestionSetting(): void {
    this.seismicService
      .getIngestionSetting()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.ingestionEnabled.set(res.ingestion_enabled));
  }

  toggleIngestion(): void {
    const nextState = !this.ingestionEnabled();
    this.seismicService
      .setIngestionSetting(nextState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.ingestionEnabled.set(res.ingestion_enabled));
  }

  toggleLivePolling(): void {
    this.livePolling.set(!this.livePolling());
  }

  // =========================================================================
  // SEARCH & PAGINATION
  // =========================================================================
  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.loadEvents(1, this.pagination().limit);
  }

  changePage(newPage: number): void {
    if (newPage < 1 || newPage > this.pagination().totalPages) return;
    this.loadEvents(newPage, this.pagination().limit);
  }

  // =========================================================================
  // EXCELJS IMPORT (CSV & XLSX -> DATABASE)
  // =========================================================================
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isImporting.set(true);
    this.importMessage.set('Reading file...');

    try {
      const rows: { timestamp: number; x: number; y: number; z: number }[] = [];
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const ts = Number(row.getCell(1).value) || Date.now() + rowNumber * 100;
          const x = Number(row.getCell(2).value);
          const y = Number(row.getCell(3).value);
          const z = Number(row.getCell(4).value);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            rows.push({ timestamp: Math.trunc(ts), x, y, z });
          }
        });
      } else {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim());
          const ts = Number(cols[0]) || Date.now() + i * 100;
          const x = Number(cols[1]);
          const y = Number(cols[2]);
          const z = Number(cols[3]);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            rows.push({ timestamp: Math.trunc(ts), x, y, z });
          }
        }
      }

      if (rows.length === 0) {
        this.importMessage.set('No valid rows found. Expected columns: timestamp, x, y, z');
        this.isImporting.set(false);
        return;
      }

      this.seismicService
        .bulkInsertWaveforms(rows)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.importMessage.set(
              `Imported ${res.inserted} readings (${res.eventsLogged} events logged).`
            );
            this.isImporting.set(false);
            this.refreshAll();
          },
          error: () => {
            this.importMessage.set('Upload failed. Check CSV/XLSX format.');
            this.isImporting.set(false);
          },
        });
    } catch {
      this.importMessage.set('Failed to parse file.');
      this.isImporting.set(false);
    } finally {
      input.value = '';
    }
  }

  // =========================================================================
  // EXCELJS EXPORT (CSV & XLSX)
  // =========================================================================
  async exportData(format: 'xlsx' | 'csv'): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Seismic Waveforms');

    sheet.columns = [
      { header: 'timestamp', key: 'timestamp', width: 18 },
      { header: 'x', key: 'x', width: 12 },
      { header: 'y', key: 'y', width: 12 },
      { header: 'z', key: 'z', width: 12 },
    ];

    this.samples().forEach((s) => {
      sheet.addRow({ timestamp: s.timestamp, x: s.x, y: s.y, z: s.z });
    });

    const buffer =
      format === 'xlsx'
        ? await workbook.xlsx.writeBuffer()
        : await workbook.csv.writeBuffer();

    const mime =
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv;charset=utf-8;';

    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seismic-waveforms-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // MANUAL INSERT, EDIT, DELETE, BULK DELETE & RESET ALL
  // =========================================================================
  submitManualReading(): void {
    const payload = [
      {
        timestamp: Date.now(),
        x: Number(this.newReading.x),
        y: Number(this.newReading.y),
        z: Number(this.newReading.z),
      },
    ];

    this.seismicService
      .bulkInsertWaveforms(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.newReading = { x: 0, y: 0, z: 0 };
          this.showAddForm.set(false);
          this.refreshAll();
        },
      });
  }

  startEdit(ev: SeismicEvent): void {
    this.editingEventId.set(ev.id);
    this.editForm = { magnitude: ev.magnitude, status: ev.status };
  }

  cancelEdit(): void {
    this.editingEventId.set(null);
  }

  saveEdit(id: number): void {
    this.seismicService
      .updateEvent(id, this.editForm)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editingEventId.set(null);
          this.loadEvents(this.pagination().page, this.pagination().limit);
          this.loadStats();
        },
      });
  }

  deleteSingleEvent(id: number): void {
    if (!confirm('Delete this seismic event?')) return;
    this.seismicService
      .deleteEvent(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadEvents(this.pagination().page, this.pagination().limit);
          this.loadStats();
        },
      });
  }

  toggleSelectEvent(id: number): void {
    const current = this.selectedEventIds();
    this.selectedEventIds.set(
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedEventIds.set(checked ? this.events().map((e) => e.id) : []);
  }

  bulkDeleteSelected(): void {
    const ids = this.selectedEventIds();
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected event(s)?`)) return;

    this.seismicService
      .bulkDeleteEvents(ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.selectedEventIds.set([]);
          this.loadEvents(1, this.pagination().limit);
          this.loadStats();
        },
      });
  }

  resetAllData(): void {
    if (!confirm('WARNING: Permanently delete ALL waveforms and events?')) return;
    this.seismicService
      .deleteAllData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.refreshAll(),
      });
  }

  // =========================================================================
  // DATE FORMATTING HELPERS
  // =========================================================================
  formatEventTime(raw: string): string {
    if (!raw) return '-';
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toLocaleString();
  }

  private formatShortTime(ts: number): string {
    const d = new Date(Number(ts));
    return isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString();
  }
}