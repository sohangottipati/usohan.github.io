import { localDateKey, type CalendarEvent, type CalendarState, type LiveState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { formatTime } from '../util';

export interface CalendarSettings {
  days: 'today' | 'both' | 'upcoming';
  maxEvents: number;
  font: string;
  size: number;
  color: string;
  accent: string;
  format: '12' | '24';
  showHeadings: boolean;
  showLocation: boolean;
  showColors: boolean;
  hidePast: boolean;
  emptyText: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** Does the event happen on local day `key` (YYYY-MM-DD)? */
function onDay(e: CalendarEvent, key: string): boolean {
  if (e.allDay) return e.start <= key && key < e.end;
  const s = localDateKey(new Date(e.start));
  const end = new Date(new Date(e.end).getTime() - 1);
  return s <= key && key <= localDateKey(end);
}

export const calendarWidget: WidgetDefinition<CalendarSettings> = {
  type: 'calendar',
  name: 'Calendar',
  description: 'Today’s (and tomorrow’s) events from Google Calendar.',
  defaultSize: { w: 800, h: 700 },
  requires: ['google'],
  defaultSettings: {
    days: 'both',
    maxEvents: 8,
    font: FONT_OPTIONS[0].value,
    size: 44,
    color: '#ffffff',
    accent: '#5ac0f2',
    format: '12',
    showHeadings: true,
    showLocation: false,
    showColors: true,
    hidePast: true,
    emptyText: 'Nothing scheduled',
  },
  settingsSchema: [
    {
      key: 'days',
      label: 'Show',
      type: 'select',
      options: [
        { value: 'both', label: 'Today and tomorrow' },
        { value: 'today', label: 'Today only' },
        { value: 'upcoming', label: 'Next events (any day)' },
      ],
    },
    { key: 'maxEvents', label: 'Most events', type: 'number', min: 1, max: 30 },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Time / now color', type: 'color' },
    {
      key: 'format',
      label: 'Time format',
      type: 'select',
      options: [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
    },
    { key: 'showHeadings', label: 'Today / Tomorrow headings', type: 'toggle' },
    { key: 'showColors', label: 'Calendar color dots', type: 'toggle' },
    { key: 'showLocation', label: 'Locations', type: 'toggle' },
    { key: 'hidePast', label: 'Hide events that have ended', type: 'toggle' },
    { key: 'emptyText', label: 'When there’s nothing', type: 'text' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let cal: CalendarState | null = ctx.state.get().calendar || null;
    const box = document.createElement('div');
    el.appendChild(box);

    function row(e: CalendarEvent, now: number): string {
      const start = e.allDay ? 0 : new Date(e.start).getTime();
      const end = e.allDay ? 0 : new Date(e.end).getTime();
      const live = !e.allDay && start <= now && now < end;
      const past = !e.allDay && end <= now;
      const fs = s.size;
      const time = e.allDay ? 'All day' : formatTime(new Date(start), s.format === '24', false);
      const dot = s.showColors ? '<span style="display:inline-block;width:' + fs * 0.32 + 'px;height:' + fs * 0.32 + 'px;border-radius:50%;background:' + esc(e.color) + ';margin-right:' + fs * 0.3 + 'px;vertical-align:middle;flex:none"></span>' : '';
      return (
        '<div style="display:flex;align-items:baseline;padding:' + fs * 0.18 + 'px 0 ' + fs * 0.18 + 'px ' + fs * 0.3 + 'px;' +
        'border-left:' + Math.max(3, fs * 0.08) + 'px solid ' + (live ? s.accent : 'transparent') + ';opacity:' + (past ? 0.4 : 1) + '">' +
        '<span style="flex:none;width:' + fs * 3.4 + 'px;color:' + s.accent + ';font-size:' + fs * 0.75 + 'px;font-variant-numeric:tabular-nums">' + (live ? 'Now' : time) + '</span>' +
        '<span style="flex:1;min-width:0;display:flex;align-items:center">' + dot +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.title) +
        (s.showLocation && e.location ? '<span style="opacity:.6;font-size:.7em"> · ' + esc(e.location) + '</span>' : '') +
        '</span></span></div>'
      );
    }

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;' +
        'font-family:' + s.font + ';font-size:' + fs + 'px;color:' + s.color + ';line-height:1.2;';
      if (!cal) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777">Google Calendar not connected</div>' : '';
        return;
      }
      if (cal.error && !cal.events.length) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#c96">' + esc(cal.error) + '</div>' : '';
        return;
      }
      const nowD = ctx.now();
      const now = nowD.getTime();
      const visible = (e: CalendarEvent) => !(s.hidePast && !e.allDay && new Date(e.end).getTime() <= now);
      let html = '';
      let left = Math.max(1, s.maxEvents);
      const heading = (t: string) =>
        s.showHeadings ? '<div style="font-size:' + fs * 0.62 + 'px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin:' + fs * 0.35 + 'px 0 ' + fs * 0.1 + 'px">' + t + '</div>' : '';

      if (s.days === 'upcoming') {
        const list = cal.events.filter((e) => visible(e) && (e.allDay ? e.end > localDateKey(nowD) : true)).slice(0, left);
        html += list.map((e) => row(e, now)).join('');
        if (!list.length) html += '<div style="opacity:.6">' + esc(s.emptyText) + '</div>';
      } else {
        const days: [string, string][] = [['Today', localDateKey(nowD)]];
        if (s.days === 'both') days.push(['Tomorrow', localDateKey(addDays(nowD, 1))]);
        for (const [label, key] of days) {
          if (left <= 0) break;
          const list = cal.events.filter((e) => onDay(e, key) && (label !== 'Today' || visible(e))).slice(0, left);
          left -= list.length;
          if (!list.length && label !== 'Today') continue;
          html += heading(label);
          html += list.length ? list.map((e) => row(e, now)).join('') : '<div style="opacity:.6;padding-left:' + fs * 0.3 + 'px">' + esc(s.emptyText) + '</div>';
        }
      }
      box.innerHTML = html;
    }

    render();
    // Minute-level updates are enough ("Now" markers, ended events fading).
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
        const next = state.calendar || null;
        if (next !== cal) {
          cal = next;
          render();
        }
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
