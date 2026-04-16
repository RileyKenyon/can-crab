import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { WebsocketService, WsMessage } from '../websocket.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-ws-demo',
  imports: [CommonModule, FormsModule],
  templateUrl: './ws-demo.component.html'
})
export class WsDemoComponent implements OnInit, OnDestroy {
  message?: WsMessage;
  private sub?: Subscription;
  inputText = '';

  constructor(private ws: WebsocketService) { }

  ngOnInit() {
    this.sub = this.ws.messages$.subscribe(m => {
      this.message = m;
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }
}