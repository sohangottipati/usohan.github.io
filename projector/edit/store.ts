'use client';

import { create } from 'zustand';
import { defaultLiveState, activeScene, type CalibrationState, type Command, type CommandLogEntry, type CommandResult, type Layer, type LiveState, type Project } from '../shared/types';
import type { SocketStatus } from '../shared/client';
import type { Guide } from './geometry';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

type Sender = (p: Project) => void;
let projectSender: Sender | null = null;
let calibrationSender: ((c: CalibrationState) => void) | null = null;

type CommandSender = (input: { text?: string; command?: Command }) => Promise<CommandResult>;
let commandSender: CommandSender | null = null;

export function setSenders(p: Sender | null, c: ((c: CalibrationState) => void) | null, cmd: CommandSender | null = null) {
  projectSender = p;
  calibrationSender = c;
  commandSender = cmd;
}

/** Run a command (text or structured) through the server, as the editor. */
export function sendCommand(input: { text?: string; command?: Command }): Promise<CommandResult> {
  if (!commandSender) return Promise.resolve({ ok: false, reply: 'Not connected' });
  return commandSender(input);
}

export interface CommitOptions {
  /** false: no undo entry (used mid-drag). Default true. */
  history?: boolean;
  /** Consecutive commits with the same key inside ~1s share one undo entry (typing, nudging). */
  coalesce?: string;
}

interface EditorState {
  authed: 'unknown' | 'yes' | 'no';
  status: SocketStatus;
  project: Project | null;
  live: LiveState;
  selectedId: string | null;
  selectedCorner: number | null;
  mode: 'layers' | 'keystone';
  /** Right-hand panel: layer/canvas properties, or the command tools. */
  panel: 'props' | 'commands' | 'integrations';
  commandLog: CommandLogEntry[];
  guides: Guide[];
  past: Project[];
  future: Project[];
  lastKey: string | null;
  lastAt: number;
  gestureStart: Project | null;
  error: string | null;

  set(partial: Partial<EditorState>): void;
  /** Replace the project from the server (no history, no echo). */
  receive(p: Project): void;
  commit(next: Project, opts?: CommitOptions): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  select(id: string | null, corner?: number | null): void;
  setCalibration(patch: Partial<CalibrationState>): void;
  updateLayer(id: string, patch: Partial<Layer>, opts?: CommitOptions): void;
  updateLayers(fn: (layers: Layer[]) => Layer[], opts?: CommitOptions): void;
}

export const useEditor = create<EditorState>((set, get) => ({
  authed: 'unknown',
  status: 'closed',
  project: null,
  live: defaultLiveState(),
  selectedId: null,
  selectedCorner: null,
  mode: 'layers',
  panel: 'props',
  commandLog: [],
  guides: [],
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  gestureStart: null,
  error: null,

  set: (partial) => set(partial),

  receive(p) {
    const { selectedId } = get();
    const stillThere = selectedId && activeScene(p).layers.some((l) => l.id === selectedId);
    set({ project: p, selectedId: stillThere ? selectedId : null });
  },

  commit(next, opts = {}) {
    const s = get();
    if (!s.project) return;
    const history = opts.history !== false && !s.gestureStart;
    if (history) {
      const now = Date.now();
      const coalesced = opts.coalesce && opts.coalesce === s.lastKey && now - s.lastAt < COALESCE_MS;
      set({
        past: coalesced ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: opts.coalesce || null,
        lastAt: now,
      });
    }
    set({ project: next });
    if (projectSender) projectSender(next);
  },

  beginGesture() {
    set({ gestureStart: get().project, lastKey: null });
  },

  endGesture() {
    const { gestureStart, project, past } = get();
    if (gestureStart && project && gestureStart !== project) {
      set({ past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [] });
    }
    set({ gestureStart: null, guides: [] });
  },

  undo() {
    const { past, future, project } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    set({ past: past.slice(0, -1), future: [project, ...future], lastKey: null });
    get().receive(prev);
    if (projectSender) projectSender(prev);
  },

  redo() {
    const { past, future, project } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({ past: [...past, project], future: future.slice(1), lastKey: null });
    get().receive(next);
    if (projectSender) projectSender(next);
  },

  select(id, corner = null) {
    set({ selectedId: id, selectedCorner: corner });
    const cal = get().live.calibration;
    if (cal.selectedLayerId !== id) get().setCalibration({ selectedLayerId: id });
  },

  setCalibration(patch) {
    const live = get().live;
    const calibration = { ...live.calibration, ...patch };
    set({ live: { ...live, calibration } });
    if (calibrationSender) calibrationSender(calibration);
  },

  updateLayers(fn, opts) {
    const p = get().project;
    if (!p) return;
    const scene = activeScene(p);
    const layers = fn(scene.layers);
    const next: Project = { ...p, scenes: p.scenes.map((s) => (s.id === scene.id ? { ...s, layers } : s)) };
    get().commit(next, opts);
  },

  updateLayer(id, patch, opts) {
    get().updateLayers((layers) => layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), opts);
  },
}));

export function selectedLayer(s: { project: Project | null; selectedId: string | null }): Layer | null {
  if (!s.project || !s.selectedId) return null;
  return activeScene(s.project).layers.find((l) => l.id === s.selectedId) || null;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
