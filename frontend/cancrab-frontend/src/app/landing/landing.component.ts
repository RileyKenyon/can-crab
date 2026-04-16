import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { SessionService } from '../session.service';
import { AuthService } from '../auth/auth.service';

interface CreateDatasetResponse {
  dataset_id: string;
  status: string;
}

interface DatasetStatus {
  status: string;
  error_message: string | null;
}

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent {
  private router = inject(Router);
  private http = inject(HttpClient);
  private sessions = inject(SessionService);
  private auth = inject(AuthService);

  canFile = signal<File | null>(null);
  dbcFile = signal<File | null>(null);
  uploading = signal(false);
  processing = signal(false);
  error = signal<string | null>(null);

  onCanFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.canFile.set(input.files[0]);
      this.error.set(null);
    }
  }

  onDbcFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      this.dbcFile.set(input.files[0]);
      this.error.set(null);
    }
  }

  canSubmit(): boolean {
    return !!(this.canFile() && this.dbcFile()) && !this.uploading() && !this.processing();
  }

  submit(): void {
    const can = this.canFile();
    const dbc = this.dbcFile();
    if (!can || !dbc) return;

    const formData = new FormData();
    formData.append('dbc', dbc);
    formData.append('log', can);

    this.uploading.set(true);
    this.error.set(null);

    if (this.auth.isLoggedIn()) {
      this.submitAuthenticated(formData, can.name);
    } else {
      this.submitAnonymous(formData, can.name);
    }
  }

  /** Authenticated: POST to /api/datasets, then poll for completion. */
  private submitAuthenticated(formData: FormData, canFileName: string): void {
    this.http.post<CreateDatasetResponse>('/api/datasets', formData).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.processing.set(true);
        this.pollStatus(res.dataset_id, canFileName.replace(/\.[^/.]+$/, ''));
      },
      error: (err) => {
        this.uploading.set(false);
        this.error.set(
          err?.error?.error ?? 'Upload failed. Is the backend running on port 8081?',
        );
      },
    });
  }

  /** Anonymous: POST to /api/upload, fetch decoded data, cache in localStorage. */
  private submitAnonymous(formData: FormData, canFileName: string): void {
    this.http.post('/api/upload', formData).subscribe({
      next: () => {
        // Fetch signal data immediately while it is in the server's memory,
        // then persist it to localStorage so prior sessions remain accessible.
        this.http.get<unknown[]>('/api/data').subscribe({
          next: (data) => {
            this.uploading.set(false);
            const session = this.sessions.addSession(null, canFileName.replace(/\.[^/.]+$/, ''));
            localStorage.setItem(`cancrab_data_${session.id}`, JSON.stringify(data));
            this.router.navigate(['/results']);
          },
          error: () => {
            this.uploading.set(false);
            this.error.set('Upload succeeded but failed to retrieve decoded data.');
          },
        });
      },
      error: (err) => {
        this.uploading.set(false);
        this.error.set(
          err?.error?.message ?? 'Upload failed. Is the backend running on port 8081?',
        );
      },
    });
  }

  private pollStatus(datasetId: string, name: string): void {
    timer(500, 1000)
      .pipe(
        switchMap(() =>
          this.http.get<DatasetStatus>(`/api/datasets/${datasetId}/status`),
        ),
        takeWhile(
          (r) => r.status !== 'ready' && r.status !== 'failed',
          true,
        ),
      )
      .subscribe({
        next: (res) => {
          if (res.status === 'ready') {
            this.processing.set(false);
            this.sessions.addSession(datasetId, name);
            this.router.navigate(['/results']);
          } else if (res.status === 'failed') {
            this.processing.set(false);
            this.error.set(res.error_message ?? 'Processing failed');
          }
        },
        error: () => {
          this.processing.set(false);
          this.error.set('Status check failed. Is the backend running?');
        },
      });
  }
}
