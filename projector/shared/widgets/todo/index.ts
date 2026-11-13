import { localDateKey, type LiveState, type TodoItem, type TodoState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';

export interface TodoSettings {
  title: string;
  maxItems: number;
  font: string;
  size: number;
  color: string;
  accent: string;
  overdueColor: string;
  showDue: boolean;
  emptyText: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function keyToDate(key: string): Date {
  const p = key.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/** Days from today (local) to a YYYY-MM-DD date. */
function daysUntil(key: string, today: Date): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((keyToDate(key).getTime() - t) / 86400000);
}

export function dueLabel(key: string, today: Date): string {
  const d = daysUntil(key, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const dt = keyToDate(key);
  if (d > 1 && d < 7) return DAYS[dt.getDay()];
  return MONTHS[dt.getMonth()] + ' ' + dt.getDate();
}

/** Overdue first, then by due date, then undated in list order. */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ad = a.it.due;
      const bd = b.it.due;
      if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return a.i - b.i;
    })
    .map((x) => x.it);
}

export const todoWidget: WidgetDefinition<TodoSettings> = {
  type: 'todo',
  name: 'To-do list',
  description: 'Your Google Tasks list, with overdue items highlighted.',
  defaultSize: { w: 760, h: 680 },
  requires: ['google'],
  defaultSettings: {
    title: 'To do',
    maxItems: 8,
    font: FONT_OPTIONS[0].value,
    size: 44,
    color: '#ffffff',
    accent: '#5ac0f2',
    overdueColor: '#ff6b6b',
    showDue: true,
    emptyText: 'All done',
  },
  settingsSchema: [
    { key: 'title', label: 'Heading', type: 'text', help: 'Leave empty for no heading.' },
    { key: 'maxItems', label: 'Most items', type: 'number', min: 1, max: 50 },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Checkbox color', type: 'color' },
    { key: 'overdueColor', label: 'Overdue color', type: 'color' },
    { key: 'showDue', label: 'Due dates', type: 'toggle' },
    { key: 'emptyText', label: 'When the list is empty', type: 'text' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let todos: TodoState | null = ctx.state.get().todos || null;
    const box = document.createElement('div');
    el.appendChild(box);

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;' +
        'font-family:' + s.font + ';font-size:' + fs + 'px;color:' + s.color + ';line-height:1.2;';
      if (!todos) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#777">Google Tasks not connected</div>' : '';
        return;
      }
      if (todos.error && !todos.items.length) {
        box.innerHTML = ctx.mode === 'editor' ? '<div style="color:#c96">' + esc(todos.error) + '</div>' : '';
        return;
      }
      const today = ctx.now();
      const todayKey = localDateKey(today);
      let html = s.title ? '<div style="font-size:' + fs * 0.62 + 'px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-bottom:' + fs * 0.25 + 'px">' + esc(s.title) + '</div>' : '';
      const items = sortTodos(todos.items);
      const shown = items.slice(0, Math.max(1, s.maxItems));
      const ring = Math.round(fs * 0.62);
      for (const it of shown) {
        const overdue = !!it.due && it.due < todayKey;
        const dueToday = it.due === todayKey;
        const col = overdue ? s.overdueColor : s.accent;
        html +=
          '<div style="display:flex;align-items:center;padding:' + fs * 0.16 + 'px 0">' +
          '<span style="flex:none;width:' + ring + 'px;height:' + ring + 'px;border-radius:50%;box-sizing:border-box;border:' + Math.max(2, fs * 0.07) + 'px solid ' + col + ';margin-right:' + fs * 0.35 + 'px"></span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (overdue ? 'color:' + s.overdueColor + ';' : '') + '">' + esc(it.title) + '</span>' +
          (s.showDue && it.due
            ? '<span style="flex:none;margin-left:' + fs * 0.4 + 'px;font-size:' + fs * 0.62 + 'px;' + (overdue ? 'color:' + s.overdueColor + ';font-weight:700' : dueToday ? 'color:' + s.accent : 'opacity:.6') + '">' +
              (overdue ? 'Overdue · ' : '') + dueLabel(it.due, today) + '</span>'
            : '') +
          '</div>';
      }
      if (items.length > shown.length) html += '<div style="opacity:.55;font-size:' + fs * 0.62 + 'px;padding-top:' + fs * 0.15 + 'px">+' + (items.length - shown.length) + ' more</div>';
      if (!items.length) html += '<div style="opacity:.6">' + esc(s.emptyText) + '</div>';
      box.innerHTML = html;
    }

    render();
    // Re-check once a minute so "Today" → "Overdue" flips after midnight.
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
        const next = state.todos || null;
        if (next !== todos) {
          todos = next;
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
