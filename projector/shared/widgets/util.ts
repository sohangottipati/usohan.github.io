// Small helpers shared by widgets. ES2017-safe (runs on old projector WebViews).

type Tick = () => void;
const tickers: Tick[] = [];
let tickTimer: any = null;

function scheduleTick() {
  // Align to the next wall-clock second so clocks flip together.
  const delay = 1000 - (Date.now() % 1000) + 5;
  tickTimer = setTimeout(() => {
    const list = tickers.slice();
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (e) {
        console.error(e);
      }
    }
    if (tickers.length) scheduleTick();
    else tickTimer = null;
  }, delay);
}

/** Run fn once per second (aligned to the second). Returns unsubscribe. */
export function everySecond(fn: Tick): () => void {
  tickers.push(fn);
  if (tickTimer === null) scheduleTick();
  return () => {
    const i = tickers.indexOf(fn);
    if (i >= 0) tickers.splice(i, 1);
  };
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatTime(d: Date, h24: boolean, seconds: boolean): string {
  let h = d.getHours();
  let suffix = '';
  if (!h24) {
    suffix = h >= 12 ? ' PM' : ' AM';
    h = h % 12 || 12;
  }
  let s = (h24 ? pad2(h) : '' + h) + ':' + pad2(d.getMinutes());
  if (seconds) s += ':' + pad2(d.getSeconds());
  return s + suffix;
}

export function formatDate(d: Date): string {
  return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (parent) parent.appendChild(e);
  return e;
}
