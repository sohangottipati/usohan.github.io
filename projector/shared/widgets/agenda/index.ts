// Agenda: calendar events, Canvas deadlines and (optionally) dated to-dos in
// one list, grouped by day. Updates are instant (they happen often); finished
// things recede instead of animating away.

import { localDateKey, type CalendarEvent, type CanvasItem, type LiveState, type TodoItem } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { formatTime } from '../util';

export interface AgendaSettings {
  days: number;
  maxItems: number;
  showEvents: boolean;
  showCanvas: boolean;
  showTodos: boolean;
  showMissing: boolean;
  hidePast: boolean;
  font: string;
  size: number;
  color: string;
  accent: string;
  dueColor: string;
  missingColor: string;
  format: '12' | '24';
  emptyText: string;
}

type Row =
  | { kind: 'event'; sort: number; day: string; allDay: boolean; title: string; sub: string; color: string; start: number; end: number }
  | { kind: 'due'; sort: number; day: string; title: string; sub: string; due: number }
  | { kind: 'todo'; sort: number; day: string; title: string }
  | { kind: 'missing'; sort: number; day: string; title: string; sub: string };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function shortCourse(c: string): string {
  return c.replace(/\s*[-–:(].*$/, '').trim() || c;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
function keyToDate(key: string): Date {
  const p = key.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export const agendaWidget: WidgetDefinition<AgendaSettings> = {
  type: 'agenda',
  name: 'Agenda',
  description: 'Calendar events and Canvas deadlines (plus dated to-dos) in one list, by day.',
  defaultSize: { w: 860, h: 820 },
  requires: ['google'],
  defaultSettings: {
    days: 3,
    maxItems: 12,
    showEvents: true,
    showCanvas: true,
    showTodos: false,
    showMissing: true,
    hidePast: true,
    font: FONT_OPTIONS[0].value,
    size: 40,
    color: '#ffffff',
    accent: '#5ac0f2',
    dueColor: '#ffb347',
    missingColor: '#ff6b6b',
    format: '12',
    emptyText: 'Nothing coming up',
  },
  settingsSchema: [
    { key: 'days', label: 'Days to show', type: 'number', min: 1, max: 14 },
    { key: 'maxItems', label: 'Most items', type: 'number', min: 1, max: 40 },
    { key: 'showEvents', label: 'Calendar events', type: 'toggle' },
    { key: 'showCanvas', label: 'Canvas deadlines', type: 'toggle' },
    { key: 'showMissing', label: 'Missing Canvas work (top)', type: 'toggle', when: { key: 'showCanvas', is: [true] } },
    { key: 'showTodos', label: 'To-dos with a due date', type: 'toggle' },
    { key: 'hidePast', label: 'Hide what’s over', type: 'toggle' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Time / now color', type: 'color' },
    { key: 'dueColor', label: 'Deadline color', type: 'color', when: { key: 'showCanvas', is: [true] } },
    { key: 'missingColor', label: 'Missing color', type: 'color', when: { key: 'showMissing', is: [true] } },
    {
      key: 'format',
      label: 'Time format',
      type: 'select',
      options: [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
    },
    { key: 'emptyText', label: 'When there’s nothing', type: 'text' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let live: LiveState = ctx.state.get();
    const box = document.createElement('div');
    el.appendChild(box);

    function rows(now: Date): Row[] {
      const out: Row[] = [];
      const first = localDateKey(now);
      const last = localDateKey(addDays(now, s.days - 1));
      const t = now.getTime();
      if (s.showEvents && live.calendar) {
        for (const e of live.calendar.events as CalendarEvent[]) {
          if (e.allDay) {
            // Show an all-day event on each visible day it covers (once, on the first one).
            const day = e.start < first ? first : e.start;
            if (day > last || e.end <= first) continue;
            out.push({ kind: 'event', sort: keyToDate(day).getTime(), day, allDay: true, title: e.title, sub: '', color: e.color, start: 0, end: 0 });
          } else {
            const start = new Date(e.start).getTime();
            const end = new Date(e.end).getTime();
            const day = localDateKey(new Date(start));
            if (day < first || day > last) continue;
            if (s.hidePast && end <= t) continue;
            out.push({ kind: 'event', sort: start, day, allDay: false, title: e.title, sub: e.location, color: e.color, start, end });
          }
        }
      }
      if (s.showCanvas && live.canvas && !live.canvas.error) {
        for (const i of live.canvas.items as CanvasItem[]) {
          if (i.submitted) continue;
          if (i.missing) {
            if (s.showMissing) out.push({ kind: 'missing', sort: -1, day: '', title: i.title, sub: shortCourse(i.course) });
            continue;
          }
          if (!i.due) continue;
          const due = new Date(i.due).getTime();
          const day = localDateKey(new Date(due));
          if (day < first || day > last || due < t) continue;
          out.push({ kind: 'due', sort: due, day, title: i.title, sub: shortCourse(i.course), due });
        }
      }
      if (s.showTodos && live.todos) {
        for (const td of live.todos.items as TodoItem[]) {
          if (!td.due || td.due < first || td.due > last) continue;
          out.push({ kind: 'todo', sort: keyToDate(td.due).getTime() + 1, day: td.due, title: td.title });
        }
      }
      out.sort((a, b) => a.sort - b.sort);
      return out;
    }

    function line(r: Row, now: Date): string {
      const fs = s.size;
      const t = now.getTime();
      const time = (ms: number) => formatTime(new Date(ms), s.format === '24', false);
      let left = '';
      let color = s.color;
      let marker = '';
      let fade = false;
      if (r.kind === 'event') {
        const live = !r.allDay && r.start <= t && t < r.end;
        fade = !r.allDay && r.end <= t;
        left = r.allDay ? 'All day' : live ? 'Now' : time(r.start);
        marker = '<span style="display:inline-block;width:' + fs * 0.3 + 'px;height:' + fs * 0.3 + 'px;border-radius:50%;background:' + esc(r.color) + ';margin-right:' + fs * 0.28 + 'px;vertical-align:middle"></span>';
      } else if (r.kind === 'due') {
        left = 'Due ' + time(r.due);
        color = s.dueColor;
        marker = '<span style="display:inline-block;width:' + fs * 0.3 + 'px;height:' + fs * 0.3 + 'px;border-radius:2px;background:' + s.dueColor + ';margin-right:' + fs * 0.28 + 'px;vertical-align:middle"></span>';
      } else if (r.kind === 'todo') {
        left = 'To-do';
        marker = '<span style="display:inline-block;width:' + fs * 0.3 + 'px;height:' + fs * 0.3 + 'px;border-radius:50%;box-sizing:border-box;border:2px solid ' + s.accent + ';margin-right:' + fs * 0.28 + 'px;vertical-align:middle"></span>';
      } else {
        left = '';
        color = s.missingColor;
      }
      const isNow = r.kind === 'event' && !r.allDay && r.start <= t && t < r.end;
      return (
        '<div style="display:flex;align-items:baseline;padding:' + fs * 0.14 + 'px 0 ' + fs * 0.14 + 'px ' + fs * 0.28 + 'px;' +
        'border-left:' + Math.max(3, fs * 0.08) + 'px solid ' + (isNow ? s.accent : 'transparent') + ';opacity:' + (fade ? 0.4 : 1) + '">' +
        '<span style="flex:none;width:' + fs * 4.8 + 'px;white-space:nowrap;font-size:' + fs * 0.7 + 'px;font-variant-numeric:tabular-nums;color:' + (r.kind === 'event' ? s.accent : color) + '">' + left + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (r.kind === 'missing' ? 'color:' + s.missingColor : '') + '">' +
        marker + esc(r.title) +
        ('sub' in r && r.sub ? '<span style="opacity:.55;font-size:.7em"> · ' + esc(r.sub) + '</span>' : '') +
        '</span></div>'
      );
    }

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;' +
        'font-family:' + s.font + ';font-size:' + fs + 'px;color:' + s.color + ';line-height:1.2;';
      const nothingConnected = (!s.showEvents || !live.calendar) && (!s.showCanvas || !live.canvas) && (!s.showTodos || !live.todos);
      if (nothingConnected) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777">Connect Google and/or Canvas in Integrations</div>' : '';
        return;
      }
      const now = ctx.now();
      const all = rows(now);
      const shown = all.slice(0, Math.max(1, s.maxItems));
      const today = localDateKey(now);
      const tomorrow = localDateKey(addDays(now, 1));
      const heading = (txt: string, color?: string) =>
        '<div style="font-size:' + fs * 0.6 + 'px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin:' + fs * 0.32 + 'px 0 ' + fs * 0.08 + 'px;' + (color ? 'color:' + color + ';opacity:.9' : '') + '">' + txt + '</div>';
      let html = '';
      let lastDay: string | null = null;
      for (const r of shown) {
        const day = r.kind === 'missing' ? 'missing' : r.day;
        if (day !== lastDay) {
          lastDay = day;
          html += heading(day === 'missing' ? 'Missing' : day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : DAYS[keyToDate(day).getDay()], day === 'missing' ? s.missingColor : undefined);
        }
        html += line(r, now);
      }
      if (all.length > shown.length) html += '<div style="opacity:.55;font-size:' + fs * 0.6 + 'px;padding-top:' + fs * 0.15 + 'px">+' + (all.length - shown.length) + ' more</div>';
      if (!all.length) html += '<div style="opacity:.6">' + esc(s.emptyText) + '</div>';
      box.innerHTML = html;
    }

    render();
    let timer: any = setInterval(render, 30000);
    return {
      update(next) {
        s = next;
        render();
      },
      resize() {
        render();
      },
      onState(state: LiveState) {
        if (state.calendar !== live.calendar || state.canvas !== live.canvas || state.todos !== live.todos) {
          live = state;
          render();
        } else live = state;
      },
      setActive(a) {
        clearInterval(timer);
        timer = a ? setInterval(render, 30000) : null;
        if (a) render();
      },
      destroy() {
        clearInterval(timer);
        el.removeChild(box);
      },
    };
  },
};
