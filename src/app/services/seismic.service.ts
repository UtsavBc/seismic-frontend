import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WaveformSample {
  id?: number;
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

export interface WaveformsResponse {
  data: WaveformSample[];
  hasMore: boolean;
  latestEventId?: number;
}

export interface SeismicEvent {
  id: number;
  event_time: string;
  magnitude: number;
  status: 'Moderate' | 'Strong' | 'Critical' | string;
}

export interface EventsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface EventsResponse {
  data: SeismicEvent[];
  pagination: EventsPagination;
}

export interface DashboardStats {
  total_events: number;
  max_magnitude: number;
  critical_alerts: number;
  total_readings: number;
}

export interface IngestionSetting {
  ingestion_enabled: boolean;
  updated_at: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class SeismicService {
  private http = inject(HttpClient);
  private apiUrl = 'https://sesmic-backend.vercel.app/api';

  getLatestWaveforms(limit = 150, before?: number): Observable<WaveformsResponse> {
    let params = new HttpParams().set('limit', limit);
    if (before !== undefined) {
      params = params.set('before', before);
    }
    return this.http.get<WaveformsResponse>(`${this.apiUrl}/latest-waveforms`, { params });
  }

  getEvents(page = 1, limit = 10, search = ''): Observable<EventsResponse> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<EventsResponse>(`${this.apiUrl}/events`, { params });
  }

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.apiUrl}/stats`);
  }

  getIngestionSetting(): Observable<IngestionSetting> {
    return this.http.get<IngestionSetting>(`${this.apiUrl}/settings/ingestion`);
  }

  setIngestionSetting(enabled: boolean): Observable<IngestionSetting> {
    return this.http.post<IngestionSetting>(`${this.apiUrl}/settings/ingestion`, { enabled });
  }

  bulkInsertWaveforms(
    rows: { timestamp: number; x: number; y: number; z: number }[]
  ): Observable<{ inserted: number; eventsLogged: number }> {
    return this.http.post<{ inserted: number; eventsLogged: number }>(
      `${this.apiUrl}/waveforms/bulk`,
      rows
    );
  }

  updateEvent(
    id: number,
    payload: { magnitude: number; status: string }
  ): Observable<SeismicEvent> {
    return this.http.put<SeismicEvent>(`${this.apiUrl}/events/${id}`, payload);
  }

  deleteEvent(id: number): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.apiUrl}/events/${id}`);
  }

  bulkDeleteEvents(ids: number[]): Observable<{ deletedCount: number }> {
    return this.http.post<{ deletedCount: number }>(`${this.apiUrl}/events/bulk-delete`, {
      ids,
    });
  }

  deleteAllData(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/data/all`);
  }
}