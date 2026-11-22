import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as echarts from 'echarts';
import { Subscription } from 'rxjs';
import { SeismicStreamService, SeismicData } from '../../services/seismic-stream';


@Component({
  selector: 'app-waveform',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './waveform.html',
  styleUrl: './waveform.scss' 
})
export class WaveformComponent implements OnInit, OnDestroy {
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef;
  
  private chartInstance!: echarts.ECharts;
  private dataSub!: Subscription;
  
  // Rolling buffer configurations
  private readonly MAX_DATA_POINTS = 500; // 500 points at 50Hz = 10 seconds of data on screen
  
  // Data arrays for ECharts
  private times: string[] = [];
  private xData: number[] = [];
  private yData: number[] = [];
  private zData: number[] = [];

  constructor(
    private seismicService: SeismicStreamService,
    private ngZone: NgZone // Critical for rendering performance
  ) {}

  ngOnInit() {
    this.initChart();
    this.startStreaming();
  }

  private initChart() {
    // Initialize chart with a dark theme
    this.chartInstance = echarts.init(this.chartDiv.nativeElement, 'dark');

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { 
        data: ['X-Axis', 'Y-Axis', 'Z-Axis'], 
        textStyle: { color: '#fff' } 
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: this.times,
        boundaryGap: false,
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: -15, // Adjust based on your physical sensor's max/min values
        max: 15,
        splitLine: { lineStyle: { color: '#333' } }
      },
      series: [
        { name: 'X-Axis', type: 'line', data: this.xData, showSymbol: false, color: '#ff4d4d', lineStyle: { width: 1 } },
        { name: 'Y-Axis', type: 'line', data: this.yData, showSymbol: false, color: '#4dff4d', lineStyle: { width: 1 } },
        { name: 'Z-Axis', type: 'line', data: this.zData, showSymbol: false, color: '#4d4dff', lineStyle: { width: 1 } }
      ],
      animation: false // Turn off default animations to prevent lag on rapid updates
    };

    this.chartInstance.setOption(option);
  }

  private startStreaming() {
    // Run outside Angular's change detection zone. 
    // This prevents Angular from re-rendering the whole app 50 times a second.
    this.ngZone.runOutsideAngular(() => {
      this.dataSub = this.seismicService.dataStream$.subscribe((data: SeismicData) => {
        
        // Format timestamp to HH:MM:SS.ms for the X-axis
        const date = new Date(data.timestamp);
        const timeString = `${date.getSeconds()}.${date.getMilliseconds()}`;

        // Push new data into our arrays
        this.times.push(timeString);
        this.xData.push(data.x);
        this.yData.push(data.y);
        this.zData.push(data.z);

        // Shift arrays to maintain fixed buffer size (creates the rolling effect)
        if (this.times.length > this.MAX_DATA_POINTS) {
          this.times.shift();
          this.xData.shift();
          this.yData.shift();
          this.zData.shift();
        }

        // Throttle chart updates slightly for rendering performance
        if (this.times.length % 2 === 0) { 
          this.chartInstance.setOption({
            xAxis: { data: this.times },
            series: [
              { data: this.xData },
              { data: this.yData },
              { data: this.zData }
            ]
          });
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.dataSub) {
      this.dataSub.unsubscribe();
    }
    if (this.chartInstance) {
      this.chartInstance.dispose();
    }
  }
}