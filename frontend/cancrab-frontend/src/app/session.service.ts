import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Session {
  id: string;
  datasetId: string | null; // null for anonymous (localStorage-only) sessions
  name: string;
  timestamp: Date;
}

interface ServerDataset {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const STORAGE_KEY = 'cancrab_sessions';
const TOKEN_KEY = 'cancrab_jwt';

function loadLocal(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      id: string; datasetId: string | null; name: string; timestamp: string;
    }>;
    return parsed.map((s) => ({ ...s, timestamp: new Date(s.timestamp) }));
  } catch {
    return [];
  }
}

function saveLocal(sessions: Session[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private http = inject(HttpClient);

  readonly sessions = signal<Session[]>(loadLocal());
  readonly activeSessionId = signal<string | null>(loadLocal()[0]?.id ?? null);

  // loadFromServer() is called from App.ngOnInit() once all services are fully
  // constructed, avoiding a circular DI issue with AuthService.

  get activeSession(): Session | undefined {
    return this.sessions().find((s) => s.id === this.activeSessionId());
  }

  /** null means anonymous session — use in-memory /api/data endpoint. */
  get activeDatasetId(): string | null {
    return this.activeSession?.datasetId ?? null;
  }

  loadFromServer(): void {
    this.http.get<ServerDataset[]>('/api/datasets').subscribe({
      next: (datasets) => {
        const serverSessions: Session[] = datasets
          .filter((d) => d.status === 'ready')
          .map((d) => ({
            id: d.id,
            datasetId: d.id,
            name: d.name,
            timestamp: new Date(d.created_at),
          }));
        this.sessions.set(serverSessions);
        saveLocal(serverSessions);
        const currentId = this.activeSessionId();
        if (!serverSessions.find((s) => s.id === currentId)) {
          this.activeSessionId.set(serverSessions[0]?.id ?? null);
        }
      },
    });
  }

  clearSessions(): void {
    this.sessions.set([]);
    this.activeSessionId.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Add a session.
   * @param datasetId  Server UUID (authenticated) or null (anonymous).
   * @param name       Display name derived from the log filename.
   */
  addSession(datasetId: string | null, name: string): Session {
    const id = datasetId ?? crypto.randomUUID();
    const session: Session = { id, datasetId, name, timestamp: new Date() };
    this.sessions.update((s) => {
      const next = [session, ...s];
      saveLocal(next);
      return next;
    });
    this.activeSessionId.set(id);
    return session;
  }

  setActive(id: string): void {
    this.activeSessionId.set(id);
  }
}
