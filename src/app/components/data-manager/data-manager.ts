import { Component, DestroyRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import ExcelJS from 'exceljs';
import {
  EventsPagination,
  SeismicEvent,
  SeismicService,
  WaveformSample,
} from '../../services/seismic.service';

@Component({
  selector: 'app-data-manager',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './data-manager.html',
  styleUrl: './data-manager.scss',
})
export class DataManagerComponent implements OnInit, OnDestroy {
  private seismicService = inject(SeismicService);
  private destroyRef = inject(DestroyRef);

  // Events & Pagination
  events = signal<SeismicEvent[]>([]);
  pagination = signal<EventsPagination>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  loadingEvents = signal<boolean>(false);

  // Search & Bulk Selection
  searchQuery = signal<string>('');
  selectedEventIds = signal<number[]>([]);

  // Import / Export & Status Banner
  isImporting = signal<boolean>(false);
  statusMessage = signal<string>('');
  statusType = signal<'info' | 'success' | 'danger'>('info');

  // Manual Insert Form
  newReading = { x: 0, y: 0, z: 0 };
  isSubmitting = signal<boolean>(false);

  // Inline Edit
  editingEventId = signal<number | null>(null);
  editForm = { magnitude: 0, status: 'Moderate' };

  ngOnInit(): void {
    this.loadEvents(1, 10);
  }

  private showStatus(msg: string, type: 'info' | 'success' | 'danger' = 'info'): void {
    this.statusMessage.set(msg);
    this.statusType.set(type);
  }

  // =========================================================================
  // READ + SEARCH + PAGINATION
  // =========================================================================
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
        error: () => {
          this.loadingEvents.set(false);
          this.showStatus('Failed to load seismic events.', 'danger');
        },
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.loadEvents(1, this.pagination().limit);
  }

  changePage(newPage: number): void {
    if (newPage < 1 || newPage > this.pagination().totalPages) return;
    this.loadEvents(newPage, this.pagination().limit);
  }

  // =========================================================================
  // CREATE: MANUAL READING
  // =========================================================================
  submitManualReading(): void {
    this.isSubmitting.set(true);
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
        next: (res) => {
          this.isSubmitting.set(false);
          this.newReading = { x: 0, y: 0, z: 0 };
          this.showStatus(
            `Saved reading (${res.eventsLogged} seismic event logged).`,
            'success'
          );
          this.loadEvents(1, this.pagination().limit);
        },
        error: () => {
          this.isSubmitting.set(false);
          this.showStatus('Failed to insert reading.', 'danger');
        },
      });
  }

  // =========================================================================
  // CREATE: CSV / XLSX IMPORT (EXCELJS)
  // =========================================================================
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isImporting.set(true);
    this.showStatus('Reading file...', 'info');

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
        this.showStatus('No valid rows found. Expected columns: timestamp, x, y, z', 'danger');
        this.isImporting.set(false);
        return;
      }

      this.seismicService
        .bulkInsertWaveforms(rows)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.isImporting.set(false);
            this.showStatus(
              `Imported ${res.inserted} readings (${res.eventsLogged} events logged).`,
              'success'
            );
            this.loadEvents(1, this.pagination().limit);
          },
          error: () => {
            this.isImporting.set(false);
            this.showStatus('Database import failed.', 'danger');
          },
        });
    } catch {
      this.isImporting.set(false);
      this.showStatus('Failed to parse file.', 'danger');
    } finally {
      input.value = '';
    }
  }

  // =========================================================================
  // EXPORT WAVEFORMS (CSV / XLSX)
  // =========================================================================
  exportWaveforms(format: 'csv' | 'xlsx'): void {
    this.showStatus(`Preparing ${format.toUpperCase()} export...`, 'info');
    this.seismicService
      .getLatestWaveforms(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (res) => {
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet('Seismic Waveforms');
          sheet.columns = [
            { header: 'timestamp', key: 'timestamp', width: 18 },
            { header: 'x', key: 'x', width: 12 },
            { header: 'y', key: 'y', width: 12 },
            { header: 'z', key: 'z', width: 12 },
          ];
          res.data.forEach((s: WaveformSample) => {
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
          this.showStatus(`Exported ${res.data.length} waveforms.`, 'success');
        },
        error: () => this.showStatus('Export failed.', 'danger'),
      });
  }

  // =========================================================================
  // UPDATE & DELETE (SINGLE, BULK, RESET ALL)
  // =========================================================================
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
          this.showStatus(`Updated event #${id}.`, 'success');
          this.loadEvents(this.pagination().page, this.pagination().limit);
        },
        error: () => this.showStatus('Update failed.', 'danger'),
      });
  }

  deleteSingleEvent(id: number): void {
    if (!confirm(`Delete event #${id}?`)) return;
    this.seismicService
      .deleteEvent(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showStatus(`Deleted event #${id}.`, 'success');
          this.loadEvents(this.pagination().page, this.pagination().limit);
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
        next: (res) => {
          this.selectedEventIds.set([]);
          this.showStatus(`Deleted ${res.deletedCount} event(s).`, 'success');
          this.loadEvents(1, this.pagination().limit);
        },
      });
  }

  resetAllData(): void {
    if (!confirm('WARNING: Permanently delete ALL waveforms and events?')) return;
    this.seismicService
      .deleteAllData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showStatus('All waveforms and events cleared.', 'success');
          this.loadEvents(1, this.pagination().limit);
        },
      });
  }

  formatEventTime(raw: string): string {
    if (!raw) return '-';
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toLocaleString();
  }

  ngOnDestroy(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  
}