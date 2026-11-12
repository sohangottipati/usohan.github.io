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

/**
 * Shared live state, synced from the server to every client. Integrations and
 * commands (timer, Spotify, to-dos...) add their own keys in later milestones.
 */
export interface LiveState {
  calibration: CalibrationState;
  blackout: boolean;
  [key: string]: any;
}

export interface Command {
  type: string;
  payload?: Record<string, any>;
}

// ---------- WebSocket protocol ----------

export type ServerMessage =
  | { t: 'snapshot'; project: Project; live: LiveState; rev: number; serverTime: number; role: 'editor' | 'display' }
  | { t: 'project'; project: Project; rev: number; serverTime: number }
  | { t: 'live'; live: LiveState; serverTime: number }
  | { t: 'pong'; serverTime: number }
  | { t: 'error'; message: string };

export type ClientMessage =
  | { t: 'setProject'; project: Project }
  | { t: 'setCalibration'; calibration: CalibrationState }
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
  };
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
