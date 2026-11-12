import { defaultLiveState, type LiveState } from './types';

/** Tiny observable for the synced live state. */
export class LiveStore {
  private state: LiveState = defaultLiveState();
  private subs: ((s: LiveState) => void)[] = [];

  get(): LiveState {
    return this.state;
  }

  set(next: LiveState) {
    this.state = next;
    const list = this.subs.slice();
    for (let i = 0; i < list.length; i++) list[i](next);
  }

  subscribe(fn: (s: LiveState) => void): () => void {
    this.subs.push(fn);
    return () => {
      const i = this.subs.indexOf(fn);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }
}

/** Server clock offset so timers computed from server timestamps stay correct. */
let serverOffset = 0;
export function setServerTime(serverTime: number) {
  serverOffset = serverTime - Date.now();
}
export function serverNow(): number {
  return Date.now() + serverOffset;
}
