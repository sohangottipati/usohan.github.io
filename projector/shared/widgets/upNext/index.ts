// Up next: the one thing to work on now (missing and soonest-due Canvas work and
// to-dos first) and how much free time there is before the next event. During a
// work session it shows what you're working on instead. Read at a glance, so it
// updates in place without motion.

import { freeWindow, workItems, type DayFns, type WorkItem } from '../../planner';
import { localDateKey, type LiveState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { formatTime } from '../util';

export interface UpNextSettings {
  showFree: boolean;
  more: number;
  font: string;
  size: number;
  color: string;
  accent: string;
  warnColor: string;
  format: '12' | '24';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The display's own clock and time zone. */
export const localDays: DayFns = {
  dayOf: (ms) => localDateKey(new Date(ms)),
  endOfDay: (day) => {
    const p = day.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59, 999).getTime();
  },
};

function mins(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + ' min';
}

export const upNextWidget: WidgetDefinition<UpNextSettings> = {
  type: 'upNext',
  name: 'Up next',
  description: 'The one thing to work on now, from Canvas and your to-dos, and your free time before the next event.',
  defaultSize: { w: 900, h: 340 },
  defaultSettings: {
    showFree: true,
    more: 2,
    font: FONT_OPTIONS[0].value,
    size: 64,
    color: '#ffffff',
    accent: '#5ac0f2',
    warnColor: '#ff6b6b',
    format: '12',
  },
  settingsSchema: [
    { key: 'showFree', label: 'Free time before the next event', type: 'toggle' },
    { key: 'more', label: 'Also show the next (count)', type: 'number', min: 0, max: 5 },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Accent', type: 'color' },
    { key: 'warnColor', label: 'Missing / overdue color', type: 'color' },
    {
      key: 'format',
      label: 'Time format',
      type: 'select',
      options: [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
    },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let live: LiveState = ctx.state.get();
    const box = document.createElement('div');
    el.appendChild(box);

    function due(it: WorkItem, now: number): string {
      if (it.missing) return 'Missing';
      if (it.overdue) return 'Overdue';
      if (it.due === null) return '';
      const d = localDays.dayOf(it.due);
      if (d === localDays.dayOf(now)) return it.source === 'todo' ? 'Due today' : 'Due ' + formatTime(new Date(it.due), s.format === '24', false);
      if (d === localDays.dayOf(now + 86400000)) return 'Due tomorrow';
      return 'Due ' + DAYS[new Date(it.due).getDay()];
    }

    function render() {
      const fs = s.size;
      const now = ctx.now().getTime();
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;white-space:nowrap;' +
        'font-family:' + s.font + ';color:' + s.color + ';line-height:1.15;display:flex;flex-direction:column;justify-content:center;';
      const label = (txt: string, color?: string) =>
        '<div style="font-size:' + fs * 0.36 + 'px;letter-spacing:.08em;text-transform:uppercase;' + (color ? 'color:' + color : 'opacity:.6') + '">' + txt + '</div>';
      const big = (txt: string, color?: string) =>
        '<div style="font-size:' + fs + 'px;font-weight:700;overflow:hidden;text-overflow:ellipsis;' + (color ? 'color:' + color : '') + '">' + esc(txt) + '</div>';
      const sub = (txt: string) => '<div style="font-size:' + fs * 0.45 + 'px;opacity:.75;overflow:hidden;text-overflow:ellipsis">' + txt + '</div>';

      let html = '';
      const active = live.study && live.study.active;
      const items = workItems(live, now, localDays);
      if (active) {
        html += label('Working on', s.accent) + big(active.task) + sub(esc(active.course ? active.course + ' · ' : '') + 'since ' + formatTime(new Date(active.startedAt), s.format === '24', false));
      } else if (items.length) {
        const it = items[0];
        const d = due(it, now);
        const warn = it.missing || it.overdue;
        html += label('Up next', s.accent) + big(it.title, warn ? s.warnColor : undefined);
        html += sub(esc(it.course) + (it.course && d ? ' · ' : '') + (d ? '<span style="' + (warn ? 'color:' + s.warnColor + ';opacity:1' : '') + '">' + d + '</span>' : ''));
      } else if (live.canvas || live.todos) {
        html += label('Up next', s.accent) + big('All caught up');
      } else {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777;font-size:' + fs * 0.45 + 'px">Connect Canvas and/or Google in Integrations</div>' : '';
        return;
      }
      if (s.showFree && live.calendar) {
        const w = freeWindow(live, now, localDays);
        let line = '';
        if (w.busy) line = 'In ' + esc(w.busy.title) + ' until ' + formatTime(new Date(w.from), s.format === '24', false);
        else if (w.until !== null && w.next) line = 'Free ' + mins(w.until - now) + ' · then ' + esc(w.next.title);
        else line = 'Free the rest of the day';
        html += '<div style="font-size:' + fs * 0.42 + 'px;margin-top:' + fs * 0.22 + 'px;color:' + s.accent + '">' + line + '</div>';
      }
      const rest = items.slice(active ? 0 : 1, (active ? 0 : 1) + Math.max(0, s.more));
      if (rest.length) {
        html +=
          '<div style="font-size:' + fs * 0.4 + 'px;opacity:.55;margin-top:' + fs * 0.12 + 'px;overflow:hidden;text-overflow:ellipsis">Then: ' +
          rest.map((i) => esc(i.title)).join(' · ') +
          '</div>';
      }
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
        const changed = state.calendar !== live.calendar || state.canvas !== live.canvas || state.todos !== live.todos || state.study !== live.study;
        live = state;
        if (changed) render();
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
