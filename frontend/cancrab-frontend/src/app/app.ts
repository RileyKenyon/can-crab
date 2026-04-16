import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { SessionService } from './session.service';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  isDark = signal(false);

  constructor(
    public sessions: SessionService,
    public auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      this.isDark.set(true);
      document.body.classList.add('dark');
    }

    if (this.auth.isLoggedIn()) {
      this.sessions.loadFromServer();
    }
  }

  toggleTheme(): void {
    this.isDark.update((v) => !v);
    if (this.isDark()) {
      document.body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }

  navigateToSession(id: string): void {
    this.sessions.setActive(id);
    this.router.navigate(['/results']);
  }
}
