// Renders a Project's active scene into a container using CSS matrix3d warps.
// Shared by the projector display (with the master keystone applied) and the
// editor preview (without it). Plain DOM, ES2017-safe.

import { IDENTITY, multiply, rectToQuad, scaleTranslate, toMatrix3d, type Mat3 } from './homography';
import { LiveStore, serverNow } from './live';
import { activeScene, type Command, type Layer, type LiveState, type MessageState, type Project } from './types';
import { getWidget, withDefaults } from './widgets/registry';
import { DEFAULT_THEME, type WidgetInstance } from './widgets/types';
import { fitText } from './widgets/util';
import { EASE_IN, EASE_OUT, MOTION } from './motion';


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
  private msg: HTMLDivElement;
  private msgText: HTMLDivElement;
  private msgSpan: HTMLSpanElement;
  private msgKey = '';
  private msgTimer: any = null;
  private vw = 0;
  private vh = 0;
  private project: Project | null = null;
  private sceneId = '';
  /** Layers fading out after a scene change; destroyed when the fade ends. */
  private leaving: Entry[] = [];
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
    // Fallback spot for "say …" messages when the scene has no Message layer.
    this.msg = document.createElement('div');
    this.msg.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:99999;display:none;';
    this.msgText = document.createElement('div');
    this.msgText.style.cssText =
      'position:absolute;left:10%;top:25%;width:80%;height:50%;display:flex;align-items:center;justify-content:center;text-align:center;' +
      'overflow:hidden;line-height:1.1;white-space:pre-wrap;word-wrap:break-word;color:#fff;font-weight:600;' +
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
    // A black panel behind the words: on a projector that's "no light", so the
    // message reads cleanly over whatever layers are underneath.
    this.msgSpan = document.createElement('span');
    this.msgSpan.style.cssText = 'display:inline-block;background:#000;padding:.15em .45em;border-radius:.2em;box-shadow:0 0 .6em .6em #000;max-width:100%;';
    this.msgText.appendChild(this.msgSpan);
    this.msgText.style.opacity = '0';
    this.msgText.style.transform = 'translateY(' + MOTION.messageRise + 'px)';
    this.msg.appendChild(this.msgText);
    root.appendChild(this.msg);
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
    // Scene change: layers only in the new scene fade in, layers only in the old one fade out.
    // Shared layers (same id in both) simply stay.
    const switching = this.sceneId !== '' && this.sceneId !== scene.id;
    this.sceneId = scene.id;
    const seen: { [id: string]: boolean } = {};
    const cal = live.calibration;
    for (let i = 0; i < scene.layers.length; i++) {
      const layer = scene.layers[i];
      seen[layer.id] = true;
      let e = this.entries[layer.id];
      const fresh = !e;
      if (!e) e = this.entries[layer.id] = this.createEntry(layer);
      this.syncEntry(e, layer, base, i, cal.highlight, cal.selectedLayerId === layer.id && (cal.highlight || cal.grid));
      if (fresh && switching) this.fadeIn(e, layer.opacity);
    }
    for (const id in this.entries) {
      if (!seen[id]) {
        if (switching) this.fadeOut(this.entries[id]);
        else this.destroyEntry(this.entries[id]);
        delete this.entries[id];
      }
    }
    this.syncGrid(cw, ch, base, cal.grid);
    let messageLayer = false;
    for (let i = 0; i < scene.layers.length; i++) {
      if (scene.layers[i].visible && scene.layers[i].widget === 'message') messageLayer = true;
    }
    this.syncMessage(cw, ch, base, messageLayer ? null : live.message);
    this.blackout.style.display = live.blackout && this.opts.mode === 'display' ? 'block' : 'none';
  }

  /** Forward a command that ran on the server to every widget's onCommand(). */
  dispatchCommand(cmd: Command) {
    for (const id in this.entries) {
      const inst = this.entries[id].instance;
      if (inst && inst.onCommand) {
        try {
          inst.onCommand(cmd);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  private fadeIn(e: Entry, target: number) {
    e.el.style.transition = 'none';
    e.el.style.opacity = '0';
    void e.el.offsetWidth; // commit the starting opacity before transitioning
    e.el.style.transition = 'opacity ' + MOTION.sceneIn + 'ms ' + EASE_OUT;
    e.el.style.opacity = '' + target;
    setTimeout(() => {
      e.el.style.transition = '';
    }, MOTION.sceneIn + 50);
  }

  private fadeOut(e: Entry) {
    this.leaving.push(e);
    // Leaving is quieter and shorter than arriving.
    e.el.style.transition = 'opacity ' + MOTION.sceneOut + 'ms ' + EASE_IN;
    e.el.style.opacity = '0';
    setTimeout(() => {
      const i = this.leaving.indexOf(e);
      if (i >= 0) this.leaving.splice(i, 1);
      this.destroyEntry(e);
    }, MOTION.sceneOut + 50);
  }

  destroy() {
    for (const e of this.leaving) this.destroyEntry(e);
    this.leaving = [];
    clearTimeout(this.msgTimer);
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

  private syncMessage(cw: number, ch: number, base: Mat3, m: MessageState | null) {
    clearTimeout(this.msgTimer);
    const left = m ? m.until - serverNow() : 0;
    if (!m || left <= 0) {
      if (this.msgKey) {
        // Toast exit: fade and sink back the way it came, faster than it arrived.
        this.msgText.style.transition = 'opacity ' + MOTION.messageOut + 'ms ' + EASE_IN + ', transform ' + MOTION.messageOut + 'ms ' + EASE_IN;
        this.msgText.style.opacity = '0';
        this.msgText.style.transform = 'translateY(' + MOTION.messageRise + 'px)';
        const key = this.msgKey;
        setTimeout(() => {
          if (this.msgKey === '' || this.msgKey === key) this.msg.style.display = 'none';
        }, MOTION.messageOut + 30);
      } else this.msg.style.display = 'none';
      this.msgKey = '';
      return;
    }
    const t = toMatrix3d(base);
    this.msg.style.width = cw + 'px';
    this.msg.style.height = ch + 'px';
    this.msg.style.transform = t;
    (this.msg.style as any).webkitTransform = t;
    this.msg.style.display = 'block';
    const key = m.id + cw + 'x' + ch;
    if (key !== this.msgKey) {
      const wasShowing = !!this.msgKey;
      this.msgKey = key;
      const reply = m.kind === 'reply';
      // "Say" messages: big and centered. Replies to Siri: a smaller card in the
      // lower part of the wall, with the question above the answer.
      this.msgText.style.left = reply ? '8%' : '10%';
      this.msgText.style.width = reply ? '84%' : '80%';
      this.msgText.style.top = reply ? '52%' : '25%';
      this.msgText.style.height = reply ? '42%' : '50%';
      this.msgText.style.textAlign = reply ? 'left' : 'center';
      this.msgText.style.fontWeight = reply ? '500' : '600';
      this.msgText.style.lineHeight = reply ? '1.25' : '1.1';
      this.msgSpan.textContent = '';
      if (reply && m.from) {
        const q = document.createElement('div');
        q.style.cssText = 'font-size:.55em;opacity:.6;margin-bottom:.35em;font-weight:400';
        q.textContent = '“' + m.from + '”';
        this.msgSpan.appendChild(q);
      }
      const a = document.createElement('div');
      a.textContent = m.text;
      this.msgSpan.appendChild(a);
      fitText(this.msgText, reply ? ch / 14 : ch / 6);
      if (!wasShowing) {
        // Toast entrance: rise 16px and fade in on the ease-out curve.
        this.msgText.style.transition = 'none';
        this.msgText.style.opacity = '0';
        this.msgText.style.transform = 'translateY(' + MOTION.messageRise + 'px)';
        void this.msgText.offsetWidth;
        this.msgText.style.transition = 'opacity ' + MOTION.messageIn + 'ms ' + EASE_OUT + ', transform ' + MOTION.messageIn + 'ms ' + EASE_OUT;
      }
      this.msgText.style.opacity = '1';
      this.msgText.style.transform = 'translateY(0)';
    }
    this.msgTimer = setTimeout(() => {
      if (this.project) this.render(this.project);
    }, left + 50);
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
