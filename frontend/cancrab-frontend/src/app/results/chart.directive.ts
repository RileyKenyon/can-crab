import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { SignalData } from './results.component';

Chart.register(...registerables);

@Directive({ selector: 'canvas[appChart]' })
export class ChartDirective implements OnChanges, OnDestroy {
  @Input({ required: true }) signals!: SignalData[];
  @Input() signalColors: string[] = [];
  @Input() plotId = '';

  private chart: Chart | null = null;

  constructor(private el: ElementRef<HTMLCanvasElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['signals'] || changes['signalColors']) {
      this.buildChart();
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private buildChart(): void {
    this.chart?.destroy();
    const single = this.signals.length === 1;

    const datasets = this.signals.map((signal, i) => {
      const color = this.signalColors[i] ?? '#3b82f6';
      return {
        label: signal.name,
        data: signal.timestamps.map((t, j) => ({ x: t, y: signal.values[j] })),
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: single,
      };
    });

    this.chart = new Chart(this.el.nativeElement, {
      type: 'line',
      data: { datasets },
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
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
        },
        plugins: {
          legend: { display: !single },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    });
  }

  getChart(): Chart | null {
    return this.chart;
  }
}
