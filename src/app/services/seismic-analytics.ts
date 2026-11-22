import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface SeismicEvent {
  id: string;
  date: Date;
  magnitude: number;
  depth: number;
  location: string;
  status: 'Micro' | 'Minor' | 'Light' | 'Moderate' | 'Strong';
}

@Injectable({
  providedIn: 'root'
})
export class SeismicAnalyticsService {
  
  getHistoricalData(): Observable<SeismicEvent[]> {
    const events: SeismicEvent[] = [];
    const locations = ['Pokhara, Nepal', 'Kathmandu, Nepal', 'Gorkha, Nepal', 'Lamjung, Nepal'];
    
    let now = new Date();
    for (let i = 0; i < 100; i++) {
      const mag = (Math.random() * 5) + 1.5; // Magnitude between 1.5 and 6.5
      let status: SeismicEvent['status'] = 'Micro';
      if (mag >= 6.0) status = 'Strong';
      else if (mag >= 5.0) status = 'Moderate';
      else if (mag >= 4.0) status = 'Light';
      else if (mag >= 3.0) status = 'Minor';

      events.push({
        id: `EV-${Math.floor(Math.random() * 10000)}`,
        date: new Date(now.getTime() - (Math.random() * 30 * 24 * 60 * 60 * 1000)), // Random time in last 30 days
        magnitude: parseFloat(mag.toFixed(2)),
        depth: parseFloat((Math.random() * 50 + 5).toFixed(1)), // Depth 5km - 55km
        location: locations[Math.floor(Math.random() * locations.length)],
        status: status
      });
    }
    
    // Sort by date descending (newest first)
    return of(events.sort((a, b) => b.date.getTime() - a.date.getTime()));
  }
}