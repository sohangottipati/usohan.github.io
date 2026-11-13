import type { Command, LiveState, Size } from '../types';

/** Show a field only when another setting has one of these values. */
export interface FieldCondition {
  key: string;
  is: any[];
}

interface FieldBase {
  key: string;
  label: string;
  help?: string;
  when?: FieldCondition;
}

export type SettingsField = FieldBase &
  (
    | { type: 'text'; multiline?: boolean; placeholder?: string }
    | { type: 'number'; min?: number; max?: number; step?: number }
    | { type: 'color' }
    | { type: 'select'; options: { value: string; label: string }[] }
    | { type: 'toggle' }
    | { type: 'font' }
    /** URL string. The editor also offers an upload button (images are stored by the wall API). */
    | { type: 'image' }
    /** A LocationValue. The editor offers a place search (Open-Meteo geocoding). */
    | { type: 'location' }
  );

export interface LocationValue {
  name: string;
  lat: number;
  lon: number;
}

export const DEFAULT_LOCATION: LocationValue = { name: 'Riverside, CA', lat: 33.9533, lon: -117.3962 };

/** True if a field's `when` condition passes for these settings. */
export function fieldVisible(f: SettingsField, settings: Record<string, any>): boolean {
  return !f.when || f.when.is.indexOf(settings[f.when.key]) >= 0;
}

export interface Theme {
  fontFamily: string;
  foreground: string;
  accent: string;
}

export interface LiveStateHandle {
  get(): LiveState;
  /** Called whenever live state changes. Returns an unsubscribe function. */
  subscribe(fn: (state: LiveState) => void): () => void;
}

export interface WidgetContext<S = any> {
  settings: S;
  /** Pre-warp content size. */
  size: Size;
  /** Server-corrected current time. */
  now(): Date;
  state: LiveStateHandle;
  sendCommand(cmd: Command): Promise<void>;
  theme: Theme;
  /** 'display' on the projector, 'editor' in the editor preview. */
  mode: 'display' | 'editor';
}

export interface WidgetInstance {
  /** Settings changed in the editor. If omitted the widget is remounted instead. */
  update?(settings: any): void;
  /** Content size changed. If omitted the widget is remounted instead. */
  resize?(size: Size): void;
  onState?(state: LiveState): void;
  onCommand?(cmd: Command): void;
  /** Layer became hidden/visible; pause timers and animations while hidden. */
  setActive?(active: boolean): void;
  destroy(): void;
}

export interface WidgetDefinition<S = any> {
  type: string;
  name: string;
  /** Short description shown in the "Add layer" menu. */
  description?: string;
  defaultSize: Size;
  settingsSchema: SettingsField[];
  defaultSettings: S;
  requires?: ('spotify' | 'google' | 'weather')[];
  mount(el: HTMLElement, ctx: WidgetContext<S>): WidgetInstance;
}

export const DEFAULT_THEME: Theme = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  foreground: '#ffffff',
  accent: '#5ac0f2',
};

export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: 'Sans' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Serif' },
  { value: "'Courier New', Courier, monospace", label: 'Mono' },
  { value: "'Trebuchet MS', Verdana, sans-serif", label: 'Rounded' },
  { value: "Impact, 'Arial Black', sans-serif", label: 'Heavy' },
  { value: "'Avenir Next', Avenir, 'Segoe UI', Roboto, sans-serif", label: 'Geometric' },
  { value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", label: 'Book' },
];
