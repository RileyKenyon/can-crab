import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { SessionService } from '../session.service';

interface AuthResponse {
  access_token: string;
  token_type: string;
}

const TOKEN_KEY = 'cancrab_jwt';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private sessions = inject(SessionService);
  readonly isLoggedIn = signal(!!localStorage.getItem(TOKEN_KEY));

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          this.isLoggedIn.set(true);
          this.sessions.loadFromServer();
        }),
      );
  }

  register(
    email: string,
    password: string,
    displayName: string,
  ): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/register', {
        email,
        password,
        display_name: displayName,
      })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          this.isLoggedIn.set(true);
          this.sessions.loadFromServer();
        }),
      );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.isLoggedIn.set(false);
    this.sessions.clearSessions();
    this.router.navigate(['/login']);
  }
}
