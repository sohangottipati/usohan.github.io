// Shared data model for the projector wall. Used by the display, the editor
// and the Cloudflare Worker. Keep this file dependency-free.

export type Point = [number, number];
/** Corners in display (canvas) pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface Size {
  w: number;
  h: number;
}

export interface Layer {
  id: string;
  name: string;
  widget: string;
  settings: Record<string, any>;
  quad: Quad;
  /** Pre-warp size the widget renders at; the quad warps this rectangle. */
  contentSize: Size;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Per-layer override of the global ratio lock. undefined = use global. */
  ratioLock?: boolean;
}

export interface Scene {
  id: string;
  name: string;
  layers: Layer[];
}

export interface Project {
  canvas: Size;
  /** Global keystone: where the canvas corners land on the output. */
  masterQuad: Quad;
  scenes: Scene[];
  activeSceneId: string;
  ratioLock: boolean;
  snap: boolean;
}

/** Calibration aids toggled in the editor and mirrored onto the projector. */
export interface CalibrationState {
  grid: boolean;
  highlight: boolean;
  /** Layer currently selected in the editor; outlined on the projector while calibrating. */
  selectedLayerId: string | null;
}

export interface PomodoroState {
  phase: 'focus' | 'break';
  /** Completed focus sessions so far. */
  round: number;
  focusMinutes: number;
  breakMinutes: number;
}

/**
 * Timer state. Running timers store a server timestamp (endsAt), never a
 * counter, so every screen agrees and a reconnect can't drift.
 */
export interface TimerState {
  status: 'idle' | 'running' | 'paused';
  label: string;
  /** Length of the current countdown, for the ring. */
  durationMs: number;
  /** Server epoch ms when a running timer hits zero. */
  endsAt: number;
  /** Time left while paused. */
  remainingMs: number;
  pomodoro: PomodoroState | null;
}

/** Temporary message from text.say. */
export interface MessageState {
  id: string;
  text: string;
  /** Server epoch ms when it disappears. */
  until: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string;
  album: string;
  /** ~300px album art URL, or '' */
  art: string;
  durationMs: number;
  kind: 'track' | 'episode';
}

/**
 * Spotify now-playing, pushed by the server. Clients interpolate progress
 * from (progressMs, at) while playing instead of receiving every tick.
 */
export interface SpotifyState {
  connected: boolean;
  track: SpotifyTrack | null;
  isPlaying: boolean;
  progressMs: number;
  /** Server time progressMs was sampled at. */
  at: number;
  volume: number | null;
  device: string;
  /** Last problem talking to Spotify, for the editor. */
  error: string | null;
}

/** Playback position at server time `now`. */
export function spotifyProgress(s: SpotifyState, now: number): number {
  if (!s.track) return 0;
  const p = s.isPlaying ? s.progressMs + (now - s.at) : s.progressMs;
  return Math.max(0, Math.min(s.track.durationMs, p));
}

/**
 * Shared live state, synced from the server to every client. Integrations
 * (Spotify, to-dos...) add their own keys in later milestones.
 */
export interface LiveState {
  calibration: CalibrationState;
  blackout: boolean;
  timer: TimerState;
  message: MessageState | null;
  /** null when Spotify isn't connected. */
  spotify?: SpotifyState | null;
  [key: string]: any;
}

export interface Command {
  type: string;
  payload?: Record<string, any>;
}

export interface CommandResult {
  ok: boolean;
  /** Short, spoken-friendly reply for Siri/Alexa. */
  reply: string;
  /** The structured command that ran (after parsing plain text). */
  command?: Command;
}

export interface CommandLogEntry {
  at: number;
  /** 'api' (token), 'editor' */
  source: string;
  /** What was sent: the dictated text, or the command type. */
  input: string;
  type: string | null;
  ok: boolean;
  reply: string;
}

// ---------- WebSocket protocol ----------

export type ServerMessage =
  | { t: 'snapshot'; project: Project; live: LiveState; rev: number; serverTime: number; role: 'editor' | 'display' }
  | { t: 'project'; project: Project; rev: number; serverTime: number }
  | { t: 'live'; live: LiveState; serverTime: number }
  | { t: 'pong'; serverTime: number }
  /** Editors only: the recent command log (newest first). */
  | { t: 'commandLog'; entries: CommandLogEntry[] }
  /** Reply to an editor's own 'command' message. */
  | { t: 'commandResult'; id: string; result: CommandResult }
  /** A command that ran, forwarded so widgets can react in onCommand(). */
  | { t: 'command'; command: Command }
  | { t: 'error'; message: string };

export type ClientMessage =
  | { t: 'setProject'; project: Project }
  | { t: 'setCalibration'; calibration: CalibrationState }
  | { t: 'command'; id: string; text?: string; command?: Command }
  | { t: 'ping' };

// ---------- defaults ----------

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function defaultLiveState(): LiveState {
  return {
    calibration: { grid: false, highlight: false, selectedLayerId: null },
    blackout: false,
    timer: idleTimer(),
    message: null,
  };
}

export function idleTimer(): TimerState {
  return { status: 'idle', label: '', durationMs: 0, endsAt: 0, remainingMs: 0, pomodoro: null };
}

/** Milliseconds left on a timer at server time `now`. */
export function timerRemaining(t: TimerState, now: number): number {
  if (t.status === 'running') return Math.max(0, t.endsAt - now);
  if (t.status === 'paused') return t.remainingMs;
  return 0;
}

export function defaultProject(): Project {
  return {
    canvas: { w: 1920, h: 1080 },
    masterQuad: rectQuad(0, 0, 1920, 1080),
    scenes: [{ id: 'default', name: 'Default', layers: [] }],
    activeSceneId: 'default',
    ratioLock: true,
    snap: true,
  };
}

export function activeScene(p: Project): Scene {
  for (let i = 0; i < p.scenes.length; i++) {
    if (p.scenes[i].id === p.activeSceneId) return p.scenes[i];
  }
  return p.scenes[0];
}
