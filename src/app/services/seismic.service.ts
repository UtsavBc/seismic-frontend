import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WaveformPoint {
  id: number;
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

export interface WaveformsResponse {
  data: WaveformPoint[];
  hasMore: boolean;
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
  total_readings: number;
  total_events: number;
  max_magnitude: number;
  critical_alerts: number;
}

export interface IngestionSetting {
  ingestion_enabled: boolean;
  updated_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class SeismicService {
  private http = inject(HttpClient);
  private readonly apiUrl = 'https://sesmic-backend.vercel.app/api';

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.apiUrl}/stats`);
  }

  getWaveforms(limit = 150, before?: number): Observable<WaveformsResponse> {
    let params = new HttpParams().set('limit', limit);
    if (before !== undefined) {
      params = params.set('before', before);
    }
    return this.http.get<WaveformsResponse>(`${this.apiUrl}/latest-waveforms`, { params });
  }

  getEvents(page = 1, limit = 10): Observable<EventsResponse> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http.get<EventsResponse>(`${this.apiUrl}/events`, { params });
  }

  getIngestionSetting(): Observable<IngestionSetting> {
    return this.http.get<IngestionSetting>(`${this.apiUrl}/settings/ingestion`);
  }

  setIngestionSetting(enabled: boolean): Observable<IngestionSetting> {
    return this.http.post<IngestionSetting>(`${this.apiUrl}/settings/ingestion`, { enabled });
  }
}