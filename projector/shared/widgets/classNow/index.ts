// Class: "CS 100 · 42 min left" during a class (class mode), "Next: MATH 10A at
// 2 PM" before one, nothing otherwise. Minute-level updates, no motion: it's
// read at a glance, often.

import { type LiveState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { formatTime } from '../util';

export interface ClassNowSettings {
  showNext: boolean;
  nextWithinHours: number;
  showLocation: boolean;
  showBar: boolean;
  font: string;
  size: number;
  color: string;
  accent: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function left(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60000));
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
}

export const classNowWidget: WidgetDefinition<ClassNowSettings> = {
  type: 'classNow',
  name: 'Class',
  description: 'The class going on now and time left (class mode), or the next one.',
  defaultSize: { w: 900, h: 240 },
  requires: ['google'],
  defaultSettings: {
    showNext: true,
    nextWithinHours: 4,
    showLocation: true,
    showBar: true,
    font: FONT_OPTIONS[0].value,
    size: 64,
    color: '#ffffff',
    accent: '#5ac0f2',
  },
  settingsSchema: [
    { key: 'showNext', label: 'Show the next class when none is on', type: 'toggle' },
    { key: 'nextWithinHours', label: '…if it starts within (hours)', type: 'number', min: 1, max: 24, when: { key: 'showNext', is: [true] } },
    { key: 'showLocation', label: 'Location', type: 'toggle' },
    { key: 'showBar', label: 'Progress bar', type: 'toggle' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Accent', type: 'color' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let live: LiveState = ctx.state.get();
    const box = document.createElement('div');
    el.appendChild(box);

    function nextClass(now: number) {
      const n = live.classNext;
      if (!n) return null;
      const start = new Date(n.start).getTime();
      return start > now && start <= now + s.nextWithinHours * 3600000 ? n : null;
    }

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;' +
        'font-family:' + s.font + ';color:' + s.color + ';line-height:1.15;white-space:nowrap;overflow:hidden;';
      const now = ctx.now().getTime();
      const c = live.classNow;
      if (c) {
        const start = new Date(c.start).getTime();
        const end = new Date(c.end).getTime();
        const frac = Math.max(0, Math.min(1, (now - start) / (end - start || 1)));
        box.innerHTML =
          '<div style="font-size:' + fs * 0.4 + 'px;letter-spacing:.08em;text-transform:uppercase;color:' + s.accent + '">In class</div>' +
          '<div style="font-size:' + fs + 'px;font-weight:700;overflow:hidden;text-overflow:ellipsis">' + esc(c.title) + '</div>' +
          '<div style="font-size:' + fs * 0.5 + 'px;opacity:.75;font-variant-numeric:tabular-nums">' + left(end - now) + ' left' +
          (s.showLocation && c.location ? ' · ' + esc(c.location) : '') + '</div>' +
          (s.showBar
            ? '<div style="margin-top:' + fs * 0.2 + 'px;height:' + Math.max(4, fs * 0.08) + 'px;background:rgba(255,255,255,.15);border-radius:99px;overflow:hidden">' +
              '<div style="height:100%;width:100%;background:' + s.accent + ';transform-origin:0 50%;transform:scaleX(' + frac.toFixed(4) + ')"></div></div>'
            : '');
        return;
      }
      const n = s.showNext ? nextClass(now) : null;
      if (n) {
        box.innerHTML =
          '<div style="font-size:' + fs * 0.4 + 'px;letter-spacing:.08em;text-transform:uppercase;opacity:.6">Next class</div>' +
          '<div style="font-size:' + fs * 0.8 + 'px;font-weight:700;overflow:hidden;text-overflow:ellipsis">' + esc(n.title) + '</div>' +
          '<div style="font-size:' + fs * 0.5 + 'px;opacity:.75;font-variant-numeric:tabular-nums">' + formatTime(new Date(n.start), false, false) + ' · in ' + left(new Date(n.start).getTime() - now) +
          (s.showLocation && n.location ? ' · ' + esc(n.location) : '') + '</div>';
        return;
      }
      box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777;font-size:' + fs * 0.45 + 'px">No class now (turn on Class mode in the Jarvis panel)</div>' : '';
    }

    render();
    let timer: any = setInterval(render, 20000);
    return {
      update(next) {
        s = next;
        render();
      },
      resize() {
        render();
      },
      onState(state: LiveState) {
        const changed = state.classNow !== live.classNow || state.classNext !== live.classNext;
        live = state;
        if (changed) render();
      },
      setActive(a) {
        clearInterval(timer);
        timer = a ? setInterval(render, 20000) : null;
        if (a) render();
      },
      destroy() {
        clearInterval(timer);
        el.removeChild(box);
      },
    };
  },
};
