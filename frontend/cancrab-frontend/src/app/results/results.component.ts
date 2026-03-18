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
import { map, switchMap } from 'rxjs/operators';
import { ChartDirective } from './chart.directive';
import { SessionService } from '../session.service';

export interface SignalData {
  name: string;
  message_name: string;
  timestamps: number[];
  values: number[];
}

interface DatasetSignalInfo {
  signal_name: string;
  message_name: string;
  sample_count: number;
}

interface MessageGroup {
  name: string;
  signals: SignalData[];
}

interface Plot {
  id: string;
  label: string;
  signalNames: string[];
}

interface PlotViewData {
  id: string;
  label: string;
  signalDataList: SignalData[];
  signalColors: string[];
}

export const CHART_COLORS = [
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
  plots = signal<Plot[]>([{ id: 'plot-1', label: 'Plot 1', signalNames: [] }]);
  activePlotId = signal<string>('plot-1');
  loading = signal(true);
  error = signal<string | null>(null);

  readonly CHART_COLORS = CHART_COLORS;

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

  messageGroups = computed<MessageGroup[]>(() => {
    const groups = new Map<string, SignalData[]>();
    for (const sig of this.signals()) {
      const key = sig.message_name || 'Ungrouped';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sig);
    }
    return Array.from(groups.entries()).map(([name, signals]) => ({ name, signals }));
  });

  // Map from signal name → plot id (for fast lookup)
  signalPlotMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const plot of this.plots()) {
      for (const name of plot.signalNames) {
        map.set(name, plot.id);
      }
    }
    return map;
  });

  // Plots with their resolved signal data (for chart rendering)
  visiblePlotData = computed<PlotViewData[]>(() => {
    const sigMap = new Map(this.signals().map((s) => [s.name, s]));
    const allSignals = this.signals();
    return this.plots()
      .filter((p) => p.signalNames.length > 0)
      .map((p) => ({
        id: p.id,
        label: p.label,
        signalDataList: p.signalNames
          .map((n) => sigMap.get(n))
          .filter((s): s is SignalData => s !== undefined),
        signalColors: p.signalNames.map(
          (n) => CHART_COLORS[allSignals.findIndex((s) => s.name === n) % CHART_COLORS.length],
        ),
      }));
  });

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const datasetId = this.sessions.activeDatasetId;

    if (!datasetId) {
      const sessionId = this.sessions.activeSession?.id;
      const raw = sessionId ? localStorage.getItem(`cancrab_data_${sessionId}`) : null;
      const data: SignalData[] = raw ? JSON.parse(raw) : [];
      this.signals.set(data);
      this.loading.set(false);
      if (!data.length) {
        this.error.set('No data found for this session. Please re-upload the file.');
      }
      return;
    }

    const data$ = this.http
      .get<DatasetSignalInfo[]>(`/api/datasets/${datasetId}/signals`)
      .pipe(
        switchMap((list) => {
          if (!list.length) return of([]);
          return forkJoin(
            list.map((info) =>
              this.http
                .get<{ name: string; timestamps: number[]; values: number[] }>(
                  `/api/datasets/${datasetId}/signals/${encodeURIComponent(info.signal_name)}`,
                )
                .pipe(
                  map((ts) => ({
                    name: ts.name,
                    message_name: info.message_name ?? '',
                    timestamps: ts.timestamps,
                    values: ts.values,
                  })),
                ),
            ),
          );
        }),
      );

    data$.subscribe({
      next: (data) => {
        this.signals.set(data);
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

  // ── Plot management ──────────────────────────────────────────────────────

  setActivePlot(plotId: string): void {
    this.activePlotId.set(plotId);
  }

  addPlot(): void {
    const id = `plot-${Date.now()}`;
    const n = this.plots().length + 1;
    this.plots.update((ps) => [...ps, { id, label: `Plot ${n}`, signalNames: [] }]);
    this.activePlotId.set(id);
  }

  removePlot(plotId: string): void {
    if (this.plots().length <= 1) return;
    this.plots.update((ps) => ps.filter((p) => p.id !== plotId));
    if (this.activePlotId() === plotId) {
      this.activePlotId.set(this.plots()[0].id);
    }
  }

  // ── Signal assignment ────────────────────────────────────────────────────

  toggleSignal(signalName: string): void {
    const currentPlotId = this.signalPlotMap().get(signalName);
    if (currentPlotId) {
      this.plots.update((ps) =>
        ps.map((p) =>
          p.id === currentPlotId
            ? { ...p, signalNames: p.signalNames.filter((n) => n !== signalName) }
            : p,
        ),
      );
    } else {
      const activeId = this.activePlotId();
      this.plots.update((ps) =>
        ps.map((p) =>
          p.id === activeId ? { ...p, signalNames: [...p.signalNames, signalName] } : p,
        ),
      );
    }
  }

  isSignalSelected(name: string): boolean {
    return this.signalPlotMap().has(name);
  }

  signalPlotLabel(name: string): string | null {
    const plotId = this.signalPlotMap().get(name);
    if (!plotId) return null;
    return this.plots().find((p) => p.id === plotId)?.label ?? null;
  }

  colorForSignal(name: string): string {
    const idx = this.signals().findIndex((s) => s.name === name);
    return CHART_COLORS[idx % CHART_COLORS.length];
  }

  // ── Downloads ────────────────────────────────────────────────────────────

  downloadCSV(signal: SignalData): void {
    const rows = signal.timestamps.map((t, i) => `${t},${signal.values[i]}`);
    const csv = `time,${signal.name}\n${rows.join('\n')}`;
    this.triggerDownload(new Blob([csv], { type: 'text/csv' }), `${signal.name}.csv`);
  }

  downloadPNG(plotId: string): void {
    const dir = this.chartDirectives.find((d) => d.plotId === plotId);
    const chart = dir?.getChart();
    if (!chart) return;
    const label = this.plots().find((p) => p.id === plotId)?.label ?? 'plot';
    chart.canvas.toBlob((blob) => {
      if (blob) this.triggerDownload(blob, `${label}.png`);
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
