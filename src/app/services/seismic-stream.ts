import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';

export interface SeismicData {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

@Injectable({
  providedIn: 'root'
})
export class SeismicStreamService implements OnDestroy {
  private socket: Socket;
  private dataSubject = new Subject<SeismicData>();
  
  // Expose as observable for components to subscribe
  public dataStream$: Observable<SeismicData> = this.dataSubject.asObservable();

  constructor() {
    // Connect to the Node.js backend we created earlier
    this.socket = io('http://localhost:3000');

    this.socket.on('connect', () => {
      console.log('Connected to Seismic WebSocket Server');
    });

    this.socket.on('seismic-stream', (data: SeismicData) => {
      this.dataSubject.next(data);
    });

    this.socket.on('disconnect', () => {
      console.warn('Disconnected from Seismic WebSocket Server');
    });
  }

  ngOnDestroy() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}