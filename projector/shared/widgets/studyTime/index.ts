// Study time: minutes logged in work sessions today against a daily goal, the
// last seven days as bars, and what today's time went to. Ticks once a minute
// during a session; no motion beyond the bars resizing.

import { localDateKey, timerRemaining, type LiveState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';

export interface StudyTimeSettings {
  showWeek: boolean;
  showTasks: boolean;
  title: string;
  font: string;
  size: number;
  color: string;
  accent: string;
  goalColor: string;
}

const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function hm(m: number): string {
  m = Math.round(m);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
}

export const studyTimeWidget: WidgetDefinition<StudyTimeSettings> = {
  type: 'studyTime',
  name: 'Study time',
  description: 'Time logged in work sessions ("start working on…"): today vs your goal, and the last 7 days.',
  defaultSize: { w: 760, h: 520 },
  defaultSettings: {
    showWeek: true,
    showTasks: true,
    title: 'Study time',
    font: FONT_OPTIONS[0].value,
    size: 56,
    color: '#ffffff',
    accent: '#5ac0f2',
    goalColor: '#7ee081',
  },
  settingsSchema: [
    { key: 'showWeek', label: 'Last 7 days', type: 'toggle' },
    { key: 'showTasks', label: "What today's time went to", type: 'toggle' },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Accent', type: 'color' },
    { key: 'goalColor', label: 'Goal reached color', type: 'color' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let live: LiveState = ctx.state.get();
    const box = document.createElement('div');
    el.appendChild(box);

    /** Minutes of the session that's running now. */
    function runningMinutes(now: number): number {
      const st = live.study;
      if (!st || !st.active) return 0;
      const t = live.timer;
      const ms = t && t.label === st.active.label && t.status !== 'idle' ? t.durationMs - timerRemaining(t, now) : now - st.active.startedAt;
      return Math.max(0, ms / 60000);
    }

    function render() {
      const fs = s.size;
      const now = ctx.now().getTime();
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;white-space:nowrap;' +
        'font-family:' + s.font + ';color:' + s.color + ';line-height:1.15;';
      const st = live.study;
      const today = localDateKey(new Date(now));
      // Stale summary (from before midnight): shift it so today starts at zero.
      let week = st ? st.week.slice() : [0, 0, 0, 0, 0, 0, 0];
      if (st && st.day !== today) {
        const gap = Math.max(1, Math.round((new Date(today + 'T12:00:00').getTime() - new Date(st.day + 'T12:00:00').getTime()) / 86400000));
        week = week.slice(Math.min(7, gap)).concat(new Array(Math.min(7, gap)).fill(0));
      }
      const fresh = !!st && st.day === today;
      week[6] += runningMinutes(now);
      const todayMin = week[6];
      const goal = st ? st.goalMinutes : 120;
      const reached = goal > 0 && todayMin >= goal;
      let html = s.title ? '<div style="font-size:' + fs * 0.4 + 'px;font-weight:700;color:' + s.accent + '">' + esc(s.title) + '</div>' : '';
      html +=
        '<div style="font-size:' + fs + 'px;font-weight:700;font-variant-numeric:tabular-nums;' + (reached ? 'color:' + s.goalColor : '') + '">' + hm(todayMin) +
        '<span style="font-size:.45em;font-weight:400;opacity:.65"> today' + (goal > 0 ? ' of ' + hm(goal) : '') + '</span></div>';
      if (goal > 0) {
        const frac = Math.min(1, todayMin / goal);
        html +=
          '<div style="margin-top:' + fs * 0.12 + 'px;height:' + Math.max(4, fs * 0.12) + 'px;background:rgba(255,255,255,.15);border-radius:99px;overflow:hidden">' +
          '<div style="height:100%;width:100%;transform-origin:0 50%;transform:scaleX(' + frac.toFixed(4) + ');background:' + (reached ? s.goalColor : s.accent) + '"></div></div>';
      }
      if (s.showWeek) {
        const max = Math.max(goal, ...week, 1);
        const h = fs * 1.4;
        let bars = '';
        for (let i = 0; i < 7; i++) {
          const d = new Date(now - (6 - i) * 86400000);
          const frac = week[i] / max;
          bars +=
            '<div style="flex:1;display:flex;flex-direction:column;align-items:center">' +
            '<div style="width:60%;height:' + h + 'px;display:flex;align-items:flex-end">' +
            '<div style="width:100%;height:100%;transform-origin:50% 100%;transform:scaleY(' + Math.max(0.02, frac).toFixed(4) + ');border-radius:' + fs * 0.06 + 'px;background:' +
            (i === 6 ? (reached ? s.goalColor : s.accent) : 'rgba(255,255,255,.35)') + '"></div></div>' +
            '<div style="font-size:' + fs * 0.3 + 'px;opacity:' + (i === 6 ? 1 : 0.5) + ';margin-top:' + fs * 0.06 + 'px">' + INITIALS[d.getDay()] + '</div></div>';
        }
        html += '<div style="display:flex;gap:' + fs * 0.1 + 'px;margin-top:' + fs * 0.3 + 'px">' + bars + '</div>';
      }
      if (s.showTasks && fresh && st!.todayTasks.length) {
        html +=
          '<div style="font-size:' + fs * 0.36 + 'px;opacity:.7;margin-top:' + fs * 0.2 + 'px;overflow:hidden;text-overflow:ellipsis">' +
          st!.todayTasks.slice(0, 3).map((t) => esc(t.task) + ' ' + hm(t.minutes)).join(' · ') +
          '</div>';
      }
      if (!st && ctx.mode === 'editor') html += '<div style="color:#777;font-size:' + fs * 0.32 + 'px;margin-top:' + fs * 0.2 + 'px">Say "start working on…" to log a session.</div>';
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
        const changed = state.study !== live.study || (!!(state.study && state.study.active) && state.timer !== live.timer);
        live = state;
        if (changed) render();
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
