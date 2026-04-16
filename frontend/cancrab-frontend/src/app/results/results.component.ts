import {
  Component,
  OnInit,
  QueryList,
  ViewChildren,
  signal,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ChartDirective } from './chart.directive';
import { SessionService } from '../session.service';

export interface SignalData {
  name: string;
  timestamps: number[];
  values: number[];
}

interface DatasetSignalInfo {
  signal_name: string;
  sample_count: number;
}

const CHART_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

@Component({
  selector: 'app-results',
  imports: [ChartDirective],
  templateUrl: './results.component.html',
  styleUrl: './results.component.css',
})
export class ResultsComponent implements OnInit {
  @ViewChildren(ChartDirective) chartDirectives!: QueryList<ChartDirective>;

  private sessions = inject(SessionService);

  signals = signal<SignalData[]>([]);
  selectedSignals = signal<Set<string>>(new Set());
  loading = signal(true);
  error = signal<string | null>(null);

  metrics = computed(() => {
    const sigs = this.signals();
    if (!sigs.length) return null;
    const allTs = sigs.flatMap((s) => s.timestamps);
    const minT = Math.min(...allTs);
    const maxT = Math.max(...allTs);
    const duration = allTs.length ? maxT - minT : 0;
    const totalPoints = sigs.reduce((sum, s) => sum + s.timestamps.length, 0);
    const sampleRate =
      duration > 0 ? (totalPoints / sigs.length / duration).toFixed(1) : '—';
    return {
      duration: duration.toFixed(1),
      signalCount: sigs.length,
      dataPoints: totalPoints,
      sampleRate,
    };
  });

  visibleSignals = computed(() => {
    const sel = this.selectedSignals();
    return this.signals().filter((s) => sel.has(s.name));
  });

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const datasetId = this.sessions.activeDatasetId;

    if (!datasetId) {
      // Anonymous: load from localStorage cache written at upload time.
      const sessionId = this.sessions.activeSession?.id;
      const raw = sessionId ? localStorage.getItem(`cancrab_data_${sessionId}`) : null;
      const data: SignalData[] = raw ? JSON.parse(raw) : [];
      this.signals.set(data);
      this.selectedSignals.set(new Set(data.map((s) => s.name)));
      this.loading.set(false);
      if (!data.length) {
        this.error.set('No data found for this session. Please re-upload the file.');
      }
      return;
    }

    // Authenticated: fetch signal list then each signal's time-series.
    const data$ = this.http
      .get<DatasetSignalInfo[]>(`/api/datasets/${datasetId}/signals`)
      .pipe(
        switchMap((list) => {
          if (!list.length) return of([]);
          return forkJoin(
            list.map((s) =>
              this.http.get<SignalData>(
                `/api/datasets/${datasetId}/signals/${encodeURIComponent(s.signal_name)}`,
              ),
            ),
          );
        }),
      );

    data$.subscribe({
      next: (data) => {
        this.signals.set(data);
        this.selectedSignals.set(new Set(data.map((s) => s.name)));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(
          'Could not load signal data. Is the backend running on port 8081?',
        );
      },
    });
  }

  toggleSignal(name: string): void {
    this.selectedSignals.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  isSelected(name: string): boolean {
    return this.selectedSignals().has(name);
  }

  colorFor(index: number): string {
    return CHART_COLORS[index % CHART_COLORS.length];
  }

  signalIndex(name: string): number {
    return this.signals().findIndex((s) => s.name === name);
  }

  downloadCSV(signal: SignalData): void {
    const rows = signal.timestamps.map((t, i) => `${t},${signal.values[i]}`);
    const csv = `time,${signal.name}\n${rows.join('\n')}`;
    this.triggerDownload(new Blob([csv], { type: 'text/csv' }), `${signal.name}.csv`);
  }

  downloadPNG(signalName: string): void {
    const dir = this.chartDirectives.find(
      (d) => d.signal.name === signalName,
    );
    const chart = dir?.getChart();
    if (!chart) return;
    chart.canvas.toBlob((blob) => {
      if (blob) this.triggerDownload(blob, `${signalName}.png`);
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
