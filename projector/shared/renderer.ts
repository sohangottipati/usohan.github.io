// Renders a Project's active scene into a container using CSS matrix3d warps.
// Shared by the projector display (with the master keystone applied) and the
// editor preview (without it). Plain DOM, ES2017-safe.

import { IDENTITY, multiply, rectToQuad, scaleTranslate, toMatrix3d, type Mat3 } from './homography';
import { LiveStore, serverNow } from './live';
import { activeScene, type Command, type Layer, type LiveState, type Project } from './types';
import { getWidget, withDefaults } from './widgets/registry';
import { DEFAULT_THEME, type WidgetInstance } from './widgets/types';

export const HIGHLIGHT_COLORS = ['#ff2d55', '#34c759', '#0a84ff', '#ffd60a', '#bf5af2', '#ff9f0a', '#64d2ff', '#ffffff'];

interface Entry {
  id: string;
  el: HTMLDivElement;
  host: HTMLDivElement;
  hl: HTMLDivElement | null;
  widget: string;
  settingsKey: string;
  sizeKey: string;
  transform: string;
  size: { w: number; h: number };
  instance: WidgetInstance | null;
  active: boolean;
}

export interface RendererOptions {
  mode: 'display' | 'editor';
  /** Apply the project's master keystone quad (display only). */
  applyMaster: boolean;
  live: LiveStore;
  /** Empty margin (container px) kept around the canvas, so editor handles stay grabbable. */
  padding?: number;
  sendCommand?: (cmd: Command) => Promise<void>;
}

export class SceneRenderer {
  private root: HTMLElement;
  private opts: RendererOptions;
  private entries: { [id: string]: Entry } = {};
  private grid: HTMLDivElement;
  private gridKey = '';
  private blackout: HTMLDivElement;
  private vw = 0;
  private vh = 0;
  private project: Project | null = null;
  private unsub: () => void;
  /** Canvas → container pixels (without master). Exposed for the editor overlay. */
  view: Mat3 = IDENTITY;
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  constructor(root: HTMLElement, opts: RendererOptions) {
    this.root = root;
    this.opts = opts;
    if (window.getComputedStyle(root).position === 'static') root.style.position = 'relative';
    root.style.overflow = 'hidden';
    root.style.background = '#000';
    this.grid = document.createElement('div');
    this.grid.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:100000;display:none;';
    root.appendChild(this.grid);
    this.blackout = document.createElement('div');
    this.blackout.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;background:#000;z-index:100001;display:none;';
    root.appendChild(this.blackout);
    this.unsub = opts.live.subscribe((s) => this.onLive(s));
  }

  setViewport(w: number, h: number) {
    if (w === this.vw && h === this.vh) return;
    this.vw = w;
    this.vh = h;
    if (this.project) this.render(this.project);
  }

  render(project: Project) {
    this.project = project;
    const live = this.opts.live.get();
    const cw = project.canvas.w;
    const ch = project.canvas.h;
    const fit = fitCanvas(this.vw, this.vh, cw, ch, this.opts.padding || 0);
    const s = fit.scale;
    this.scale = s;
    this.offsetX = fit.x;
    this.offsetY = fit.y;
    this.view = scaleTranslate(s, this.offsetX, this.offsetY);
    let base = this.view;
    if (this.opts.applyMaster) {
      const m = rectToQuad(cw, ch, project.masterQuad);
      if (m) base = multiply(this.view, m);
    }

    const scene = activeScene(project);
    const seen: { [id: string]: boolean } = {};
    const cal = live.calibration;
    for (let i = 0; i < scene.layers.length; i++) {
      const layer = scene.layers[i];
      seen[layer.id] = true;
      let e = this.entries[layer.id];
      if (!e) e = this.entries[layer.id] = this.createEntry(layer);
      this.syncEntry(e, layer, base, i, cal.highlight, cal.selectedLayerId === layer.id && (cal.highlight || cal.grid));
    }
    for (const id in this.entries) {
      if (!seen[id]) {
        this.destroyEntry(this.entries[id]);
        delete this.entries[id];
      }
    }
    this.syncGrid(cw, ch, base, cal.grid);
    this.blackout.style.display = live.blackout && this.opts.mode === 'display' ? 'block' : 'none';
  }

  destroy() {
    this.unsub();
    for (const id in this.entries) this.destroyEntry(this.entries[id]);
    this.entries = {};
    this.root.innerHTML = '';
  }

  private onLive(s: LiveState) {
    for (const id in this.entries) {
      const inst = this.entries[id].instance;
      if (inst && inst.onState) inst.onState(s);
    }
    if (this.project) this.render(this.project);
  }

  private createEntry(layer: Layer): Entry {
    const el = document.createElement('div');
    // No overflow clipping here, so a shape's outer glow can spill past its quad.
    el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;';
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    el.appendChild(host);
    this.root.insertBefore(el, this.grid);
    return {
      id: layer.id,
      el,
      host,
      hl: null,
      widget: '',
      settingsKey: '',
      sizeKey: '',
      transform: '',
      size: { w: layer.contentSize.w, h: layer.contentSize.h },
      instance: null,
      active: true,
    };
  }

  private syncEntry(e: Entry, layer: Layer, base: Mat3, index: number, highlight: boolean, selected: boolean) {
    const settings = withDefaults(layer.widget, layer.settings);
    const settingsKey = JSON.stringify(settings);
    const sizeKey = layer.contentSize.w + 'x' + layer.contentSize.h;

    if (sizeKey !== e.sizeKey) {
      e.el.style.width = layer.contentSize.w + 'px';
      e.el.style.height = layer.contentSize.h + 'px';
    }

    const needsMount = !e.instance || e.widget !== layer.widget;
    if (needsMount) {
      this.mount(e, layer, settings);
    } else if (settingsKey !== e.settingsKey) {
      if (e.instance!.update) e.instance!.update(settings);
      else this.mount(e, layer, settings);
    } else if (sizeKey !== e.sizeKey) {
      e.size.w = layer.contentSize.w;
      e.size.h = layer.contentSize.h;
      if (e.instance!.resize) e.instance!.resize(e.size);
      else this.mount(e, layer, settings);
    }
    e.settingsKey = settingsKey;
    e.sizeKey = sizeKey;

    const h = rectToQuad(layer.contentSize.w, layer.contentSize.h, layer.quad);
    const t = h ? toMatrix3d(multiply(base, h)) : 'scale(0)';
    if (t !== e.transform) {
      e.el.style.transform = t;
      (e.el.style as any).webkitTransform = t;
      e.transform = t;
    }
    e.el.style.zIndex = '' + (index + 1);
    e.el.style.opacity = '' + layer.opacity;
    e.el.style.display = layer.visible ? 'block' : 'none';
    if (layer.visible !== e.active) {
      e.active = layer.visible;
      if (e.instance && e.instance.setActive) e.instance.setActive(layer.visible);
    }

    // Calibration highlight: bright fill + name so the quad is easy to line up.
    if (highlight || selected) {
      if (!e.hl) {
        e.hl = document.createElement('div');
        e.el.appendChild(e.hl);
      }
      const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
      const fs = Math.max(24, Math.min(layer.contentSize.w, layer.contentSize.h) / 6);
      e.hl.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
        'font:700 ' + fs + 'px sans-serif;color:#000;' +
        (highlight ? 'background:' + color + ';' : '') +
        (selected ? 'border:' + Math.max(6, fs / 5) + 'px solid ' + (highlight ? '#fff' : color) + ';' : '');
      e.hl.textContent = highlight ? layer.name : '';
    } else if (e.hl) {
      e.el.removeChild(e.hl);
      e.hl = null;
    }
  }

  private mount(e: Entry, layer: Layer, settings: Record<string, any>) {
    if (e.instance) {
      try {
        e.instance.destroy();
      } catch (err) {
        console.error(err);
      }
      e.instance = null;
    }
    e.host.innerHTML = '';
    e.widget = layer.widget;
    e.size = { w: layer.contentSize.w, h: layer.contentSize.h };
    const def = getWidget(layer.widget);
    if (!def) {
      e.host.textContent = this.opts.mode === 'editor' ? 'Unknown widget: ' + layer.widget : '';
      e.instance = { destroy() {} };
      return;
    }
    const live = this.opts.live;
    const send = this.opts.sendCommand;
    try {
      e.instance = def.mount(e.host, {
        settings,
        size: e.size,
        now: () => new Date(serverNow()),
        state: { get: () => live.get(), subscribe: (fn) => live.subscribe(fn) },
        sendCommand: send || (() => Promise.reject(new Error('Commands are not available here'))),
        theme: DEFAULT_THEME,
        mode: this.opts.mode,
      });
    } catch (err) {
      console.error('Widget ' + layer.widget + ' failed to mount', err);
      e.instance = { destroy() {} };
    }
    e.active = true;
  }

  private destroyEntry(e: Entry) {
    if (e.instance) {
      try {
        e.instance.destroy();
      } catch (err) {
        console.error(err);
      }
    }
    if (e.el.parentNode) e.el.parentNode.removeChild(e.el);
  }

  private syncGrid(cw: number, ch: number, base: Mat3, on: boolean) {
    this.grid.style.display = on ? 'block' : 'none';
    if (!on) return;
    const key = cw + 'x' + ch;
    if (key !== this.gridKey) {
      this.gridKey = key;
      this.grid.style.width = cw + 'px';
      this.grid.style.height = ch + 'px';
      this.grid.innerHTML = testPatternSvg(cw, ch);
    }
    const t = toMatrix3d(base);
    this.grid.style.transform = t;
    (this.grid.style as any).webkitTransform = t;
  }
}

/** Scale and offset that fit a cw×ch canvas inside a vw×vh box, centred, keeping aspect. */
export function fitCanvas(vw: number, vh: number, cw: number, ch: number, padding: number) {
  const aw = Math.max(1, vw - padding * 2);
  const ah = Math.max(1, vh - padding * 2);
  const scale = vw && vh ? Math.min(aw / cw, ah / ch) : 1;
  return { scale, x: (vw - cw * scale) / 2, y: (vh - ch * scale) / 2 };
}

/** Grid + test pattern: 16 columns, border, diagonals, centre circle and crosshair. */
function testPatternSvg(w: number, h: number): string {
  const step = w / 16;
  let lines = '';
  for (let x = step; x < w - 0.5; x += step) lines += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + h + '"/>';
  for (let y = step; y < h - 0.5; y += step) lines += '<line x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '"/>';
  const r = Math.min(w, h) * 0.4;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">' +
    '<g stroke="#00e5ff" stroke-width="2" opacity="0.7">' + lines + '</g>' +
    '<g stroke="#ffffff" stroke-width="3" fill="none">' +
    '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" stroke-width="6"/>' +
    '<line x1="0" y1="0" x2="' + w + '" y2="' + h + '"/><line x1="' + w + '" y1="0" x2="0" y2="' + h + '"/>' +
    '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + r + '"/>' +
    '<line x1="' + w / 2 + '" y1="0" x2="' + w / 2 + '" y2="' + h + '" stroke="#ff2d55"/>' +
    '<line x1="0" y1="' + h / 2 + '" x2="' + w + '" y2="' + h / 2 + '" stroke="#ff2d55"/>' +
    '</g></svg>'
  );
}
