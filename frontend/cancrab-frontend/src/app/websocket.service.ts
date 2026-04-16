import { Injectable, OnDestroy } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, Subject, timer } from 'rxjs';
import { catchError, delayWhen, retryWhen, switchMap, takeUntil } from 'rxjs/operators';

export interface WsMessage {
  type?: string;
  payload?: any;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService implements OnDestroy {
  private socket$: WebSocketSubject<unknown> | null = null;
  private messagesSubject$ = new Subject<WsMessage>();
  public messages$ = this.messagesSubject$.asObservable();

  // controlled stop to avoid reconnect when intentionally closed
  private stop$ = new Subject<void>();

  // set this to your server URL; can also come from environment.ts
  private url = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';

  constructor() {
    this.connect();
  }

  private connect() {
    if (this.socket$) {
      return;
    }

    // Create a factory function that returns the WebSocketSubject
    const makeSocket = () =>
      webSocket({
        url: this.url,
        // You can add serialization/deserialization here:
        deserializer: ({ data }) => {
          try {
            return JSON.parse(data);
          } catch (e) {
            return data;
          }
        }
      });

    // Establish connection and handle reconnects
    // We use retryWhen with exponential backoff
    this.socket$ = makeSocket();

    this.socket$
      .pipe(
        retryWhen(errors =>
          errors.pipe(
            // wait progressively longer before reconnecting
            // e.g., 1s, 2s, 4s, 8s... capped at 30s
            delayWhen((_, i) => {
              const attempt = Math.min(30000, 1000 * Math.pow(2, i));
              return timer(attempt);
            }),
            takeUntil(this.stop$)
          )
        ),
        takeUntil(this.stop$)
      )
      .subscribe({
        next: (msg: any) => {
          this.messagesSubject$.next(msg as WsMessage);
        },
        error: (err) => {
          console.error('WebSocket error', err);
          // socket$ will attempt to reconnect via retryWhen
          this.socket$ = null;
        },
        complete: () => {
          console.info('WebSocket closed');
          this.socket$ = null;
        }
      });
  }

  public send(message: WsMessage) {
    if (!this.socket$) {
      console.warn('WebSocket not connected, trying to reconnect before sending');
      this.connect();
      // small delay to allow connection; in production you'd queue messages
      setTimeout(() => this.socket$?.next(message), 200);
      return;
    }
    this.socket$.next(message);
  }

  // optional: manual reconnect
  public reconnect() {
    this.close();
    this.stop$ = new Subject<void>();
    this.connect();
  }

  public close() {
    // Stop reconnect attempts
    this.stop$.next();
    this.stop$.complete();
    if (this.socket$) {
      this.socket$.complete(); // closes the socket
      this.socket$ = null;
    }
  }

  ngOnDestroy(): void {
    this.close();
    this.messagesSubject$.complete();
  }
}