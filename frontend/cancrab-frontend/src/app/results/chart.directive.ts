import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { SignalData } from './results.component';

Chart.register(...registerables);

const CHART_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

@Directive({ selector: 'canvas[appChart]' })
export class ChartDirective implements OnChanges, OnDestroy {
  @Input({ required: true }) signal!: SignalData;
  @Input() colorIndex = 0;

  private chart: Chart | null = null;

  constructor(private el: ElementRef<HTMLCanvasElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['signal'] || changes['colorIndex']) {
      this.buildChart();
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private buildChart(): void {
    this.chart?.destroy();
    const color = CHART_COLORS[this.colorIndex % CHART_COLORS.length];

    this.chart = new Chart(this.el.nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            label: this.signal.name,
            data: this.signal.timestamps.map((t, i) => ({ x: t, y: this.signal.values[i] })),
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Time (s)' },
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
          y: {
            title: { display: true, text: this.signal.name },
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    });
  }

  getChart(): Chart | null {
    return this.chart;
  }
}
