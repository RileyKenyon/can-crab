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

  renamingPlotId = signal<string | null>(null);
  renamingLabel = signal('');

  // Map from signal name → all plot ids it belongs to
  signalPlotMap = computed<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    for (const plot of this.plots()) {
      for (const name of plot.signalNames) {
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push(plot.id);
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

  startRename(plotId: string, currentLabel: string): void {
    this.renamingLabel.set(currentLabel);
    this.renamingPlotId.set(plotId);
    setTimeout(() => {
      document.querySelector<HTMLInputElement>('.plot-title-input')?.select();
    }, 0);
  }

  finishRename(plotId: string): void {
    if (this.renamingPlotId() !== plotId) return;
    const trimmed = this.renamingLabel().trim();
    if (trimmed) {
      this.plots.update((ps) => ps.map((p) => (p.id === plotId ? { ...p, label: trimmed } : p)));
    }
    this.renamingPlotId.set(null);
  }

  // ── Signal assignment ────────────────────────────────────────────────────

  // Checkbox reflects membership in the *active* plot.
  // Toggling adds to / removes from the active plot only,
  // so the same signal can appear in multiple plots simultaneously.
  toggleSignal(signalName: string): void {
    const activeId = this.activePlotId();
    const inActive = this.plots().find((p) => p.id === activeId)?.signalNames.includes(signalName);
    this.plots.update((ps) =>
      ps.map((p) => {
        if (p.id !== activeId) return p;
        return inActive
          ? { ...p, signalNames: p.signalNames.filter((n) => n !== signalName) }
          : { ...p, signalNames: [...p.signalNames, signalName] };
      }),
    );
  }

  isSignalSelected(name: string): boolean {
    const activeId = this.activePlotId();
    return this.plots().find((p) => p.id === activeId)?.signalNames.includes(name) ?? false;
  }

  signalPlotLabels(name: string): string[] {
    const plotIds = this.signalPlotMap().get(name) ?? [];
    return plotIds
      .map((id) => this.plots().find((p) => p.id === id)?.label ?? '')
      .filter(Boolean);
  }

  colorForSignal(name: string): string {
    const idx = this.signals().findIndex((s) => s.name === name);
    return CHART_COLORS[idx % CHART_COLORS.length];
  }

  // ── Downloads ────────────────────────────────────────────────────────────

  downloadPlotCSV(plotId: string): void {
    const plotData = this.visiblePlotData().find((p) => p.id === plotId);
    if (!plotData?.signalDataList.length) return;

    const sigs = plotData.signalDataList;

    // Collect all unique timestamps across all signals, sorted
    const allTimestamps = Array.from(
      new Set(sigs.flatMap((s) => s.timestamps)),
    ).sort((a, b) => a - b);

    // Per-signal value lookup by timestamp
    const valueMaps = sigs.map((sig) => {
      const m = new Map<number, number>();
      sig.timestamps.forEach((t, i) => m.set(t, sig.values[i]));
      return m;
    });

    const header = `time,${sigs.map((s) => s.name).join(',')}`;
    const rows = allTimestamps.map((t) => {
      const vals = valueMaps.map((m) => (m.has(t) ? m.get(t) : ''));
      return `${t},${vals.join(',')}`;
    });

    const label = this.plots().find((p) => p.id === plotId)?.label ?? 'plot';
    const csv = `${header}\n${rows.join('\n')}`;
    this.triggerDownload(new Blob([csv], { type: 'text/csv' }), `${label}.csv`);
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
