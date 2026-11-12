// WebSocket client with auto-reconnect and heartbeat. ES2017-safe.

import type { ClientMessage, ServerMessage } from './types';

export const DEFAULT_API = 'https://projector-api.sohan.website';

/** API origin: ?api= override, localhost → local wrangler dev, otherwise production. */
export function apiBase(): string {
  const m = /[?&]api=([^&#]+)/.exec(location.search);
  if (m) return decodeURIComponent(m[1]).replace(/\/$/, '');
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://' + h + ':8787';
  return DEFAULT_API;
}

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface WallSocketOptions {
  url: string;
  onMessage(msg: ServerMessage): void;
  onStatus?(status: SocketStatus, disconnectedForMs: number): void;
}

export class WallSocket {
  private ws: WebSocket | null = null;
  private opts: WallSocketOptions;
  private retry = 0;
  private retryTimer: any = null;
  private heartbeat: any = null;
  private lastMessage = 0;
  private stopped = false;
  status: SocketStatus = 'closed';
  /** When the connection was last lost (0 while connected). */
  disconnectedAt = 0;

  constructor(opts: WallSocketOptions) {
    this.opts = opts;
    this.disconnectedAt = Date.now();
  }

  connect() {
    this.stopped = false;
    this.open();
    // Heartbeat: ping every 20s; if nothing arrives for 45s, assume the link is dead.
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        if (this.status === 'open') {
          this.send({ t: 'ping' });
          if (Date.now() - this.lastMessage > 45000 && this.ws) this.ws.close();
        }
        this.emitStatus();
      }, 20000);
    }
  }

  send(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    clearTimeout(this.retryTimer);
    if (this.ws) this.ws.close();
  }

  /** Reconnect immediately (e.g. when the browser reports it is back online). */
  kick() {
    if (this.status === 'open' || this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retry = 0;
    this.open();
  }

  private open() {
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onmessage = this.ws.onerror = null;
      try {
        this.ws.close();
      } catch (e) {}
    }
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastMessage = Date.now();
      this.disconnectedAt = 0;
      this.setStatus('open');
    };
    ws.onmessage = (ev) => {
      this.lastMessage = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!this.disconnectedAt) this.disconnectedAt = Date.now();
      this.setStatus('closed');
      if (!this.stopped) this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows.
    };
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(10000, 500 * Math.pow(2, this.retry++)) + Math.random() * 500;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private setStatus(s: SocketStatus) {
    this.status = s;
    this.emitStatus();
  }

  private emitStatus() {
    if (this.opts.onStatus) this.opts.onStatus(this.status, this.disconnectedAt ? Date.now() - this.disconnectedAt : 0);
  }
}
