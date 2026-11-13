import { localDateKey as localDate, type CanvasItem, type CanvasState, type LiveState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { formatTime } from '../util';

export interface CanvasDueSettings {
  title: string;
  days: number;
  maxItems: number;
  showCourse: boolean;
  showMissing: boolean;
  font: string;
  size: number;
  color: string;
  accent: string;
  missingColor: string;
  emptyText: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortCourse(c: string): string {
  // "CS 100 - Software Construction (Fall 2026)" → "CS 100"
  return c.replace(/\s*[-–:(].*$/, '').trim() || c;
}

function dueLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const today = localDate(now);
  const key = localDate(d);
  const tomorrow = localDate(new Date(now.getTime() + 86400000));
  const t = formatTime(d, false, false);
  if (key === today) return 'Today ' + t;
  if (key === tomorrow) return 'Tomorrow ' + t;
  const diff = (d.getTime() - now.getTime()) / 86400000;
  if (diff > 0 && diff < 7) return DAYS[d.getDay()] + ' ' + t;
  return MONTHS[d.getMonth()] + ' ' + d.getDate();
}

export const canvasDueWidget: WidgetDefinition<CanvasDueSettings> = {
  type: 'canvasDue',
  name: 'Canvas: due soon',
  description: 'Assignments, quizzes and discussions from Canvas that aren’t submitted yet.',
  defaultSize: { w: 820, h: 680 },
  defaultSettings: {
    title: 'Due soon',
    days: 7,
    maxItems: 7,
    showCourse: true,
    showMissing: true,
    font: FONT_OPTIONS[0].value,
    size: 42,
    color: '#ffffff',
    accent: '#ffb347',
    missingColor: '#ff6b6b',
    emptyText: 'Nothing due. Nice.',
  },
  settingsSchema: [
    { key: 'title', label: 'Heading', type: 'text', help: 'Leave empty for no heading.' },
    { key: 'days', label: 'Look ahead (days)', type: 'number', min: 1, max: 21 },
    { key: 'maxItems', label: 'Most items', type: 'number', min: 1, max: 30 },
    { key: 'showCourse', label: 'Course names', type: 'toggle' },
    { key: 'showMissing', label: 'Missing work', type: 'toggle' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Due today / tomorrow color', type: 'color' },
    { key: 'missingColor', label: 'Missing color', type: 'color', when: { key: 'showMissing', is: [true] } },
    { key: 'emptyText', label: 'When nothing is due', type: 'text' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let cv: CanvasState | null = ctx.state.get().canvas || null;
    const box = document.createElement('div');
    el.appendChild(box);

    function row(i: CanvasItem, now: Date, missing: boolean): string {
      const fs = s.size;
      const soon = !missing && i.due && new Date(i.due).getTime() - now.getTime() < 2 * 86400000;
      const color = missing ? s.missingColor : soon ? s.accent : s.color;
      return (
        '<div style="display:flex;align-items:baseline;padding:' + fs * 0.14 + 'px 0;' + (missing ? 'color:' + s.missingColor + ';' : '') + '">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(i.title) +
        (s.showCourse && i.course ? '<span style="opacity:.55;font-size:.7em"> · ' + esc(shortCourse(i.course)) + '</span>' : '') +
        '</span>' +
        '<span style="flex:none;margin-left:' + fs * 0.4 + 'px;font-size:' + fs * 0.62 + 'px;color:' + color + ';' + (missing || soon ? 'font-weight:700' : 'opacity:.7') + '">' +
        (missing ? 'Missing' : i.due ? dueLabel(i.due, now) : '') +
        '</span></div>'
      );
    }

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;' +
        'font-family:' + s.font + ';font-size:' + fs + 'px;color:' + s.color + ';line-height:1.2;';
      if (!cv) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777">Canvas not connected</div>' : '';
        return;
      }
      if (cv.error && !cv.items.length) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#c96">' + esc(cv.error) + '</div>' : '';
        return;
      }
      const now = ctx.now();
      const until = now.getTime() + s.days * 86400000;
      const open = cv.items.filter((i) => !i.submitted && !i.missing && i.due && new Date(i.due).getTime() >= now.getTime() && new Date(i.due).getTime() <= until);
      const missing = s.showMissing ? cv.items.filter((i) => i.missing && !i.submitted) : [];
      let html = s.title ? '<div style="font-size:' + fs * 0.62 + 'px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-bottom:' + fs * 0.25 + 'px">' + esc(s.title) + '</div>' : '';
      const list = missing.map((i) => ({ i, m: true })).concat(open.map((i) => ({ i, m: false })));
      const shown = list.slice(0, Math.max(1, s.maxItems));
      for (const x of shown) html += row(x.i, now, x.m);
      if (list.length > shown.length) html += '<div style="opacity:.55;font-size:' + fs * 0.62 + 'px;padding-top:' + fs * 0.15 + 'px">+' + (list.length - shown.length) + ' more</div>';
      if (!list.length) html += '<div style="opacity:.6">' + esc(s.emptyText) + '</div>';
      box.innerHTML = html;
    }

    render();
    let timer: any = setInterval(render, 60000);
    return {
      update(next) {
        s = next;
        render();
      },
      resize() {
        render();
      },
      onState(state: LiveState) {
        const next = state.canvas || null;
        if (next !== cv) {
          cv = next;
          render();
        }
      },
      setActive(a) {
        clearInterval(timer);
        timer = a ? setInterval(render, 60000) : null;
        if (a) render();
      },
      destroy() {
        clearInterval(timer);
        el.removeChild(box);
      },
    };
  },
};
