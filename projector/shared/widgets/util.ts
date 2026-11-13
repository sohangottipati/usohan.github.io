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

// ---------- sound ----------
// Browsers only allow audio after a user gesture. On the projector that's the
// first remote button press (which also triggers fullscreen).

let audio: AudioContext | null = null;

function unlockAudio() {
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!audio) audio = new Ctor();
    if (audio!.state === 'suspended') audio!.resume();
  } catch (e) {}
}
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', unlockAudio);
  document.addEventListener('click', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);
}

/** Three soft beeps. Silently does nothing if audio isn't allowed yet. */
export function playChime() {
  unlockAudio();
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 2 ? 1320 : 880;
    const t = t0 + i * 0.35;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let speaking: { stop(): void } | null = null;

/**
 * Plays Jarvis's voice. Uses the AudioContext unlocked by the first remote press;
 * falls back to an <audio> element, then to the browser's own speech synthesis.
 * Calls done(true) once playback starts, done(false) if nothing could play.
 */
export function playSpeech(audioB64: string | null, mime: string, text: string, done?: (played: boolean) => void) {
  const finish = (ok: boolean) => {
    if (done) done(ok);
  };
  if (speaking) speaking.stop(); // newest reply wins
  speaking = null;
  const browserVoice = () => {
    const synth = (window as any).speechSynthesis;
    const Utter = (window as any).SpeechSynthesisUtterance;
    if (!synth || !Utter || !text) return finish(false);
    try {
      synth.cancel();
      synth.speak(new Utter(text));
      speaking = { stop: () => synth.cancel() };
      finish(true);
    } catch (e) {
      finish(false);
    }
  };
  if (!audioB64) return browserVoice();
  unlockAudio();
  const ctx = audio;
  if (ctx && ctx.state === 'running') {
    const onDecoded = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      speaking = { stop: () => { try { src.stop(); } catch (e) {} } };
      finish(true);
    };
    try {
      // Callback form: older WebViews don't return a promise from decodeAudioData.
      const p: any = ctx.decodeAudioData(base64ToBuffer(audioB64), onDecoded, () => browserVoice());
      if (p && p.catch) p.catch(() => {});
      return;
    } catch (e) {}
  }
  try {
    const el = new Audio('data:' + mime + ';base64,' + audioB64);
    const p: any = el.play();
    speaking = { stop: () => el.pause() };
    if (p && p.then) p.then(() => finish(true), () => browserVoice());
    else finish(true);
  } catch (e) {
    browserVoice();
  }
}

/** Shrinks an element's font size until its content fits its box. */
export function fitText(node: HTMLElement, maxPx: number, minPx = 12) {
  let fs = maxPx;
  node.style.fontSize = fs + 'px';
  for (let i = 0; i < 30 && fs > minPx && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1); i++) {
    fs = Math.max(minPx, fs * 0.9);
    node.style.fontSize = fs + 'px';
  }
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
}
