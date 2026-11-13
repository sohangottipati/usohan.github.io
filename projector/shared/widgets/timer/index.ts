import { timerRemaining, type LiveState, type TimerState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { everySecond, formatClock, playChime } from '../util';

export interface TimerSettings {
  style: 'ring' | 'text';
  font: string;
  size: number;
  color: string;
  ringColor: string;
  breakColor: string;
  trackColor: string;
  ringWidth: number;
  showLabel: boolean;
  whenIdle: 'hide' | 'show';
  doneText: string;
  doneHold: number;
  flash: boolean;
  chime: boolean;
}

const TAU = Math.PI * 2;

if (typeof document !== 'undefined' && !document.getElementById('wall-timer-css')) {
  const css = document.createElement('style');
  css.id = 'wall-timer-css';
  css.textContent = '@keyframes wallTimerFlash{0%,100%{opacity:1}50%{opacity:.25}}';
  document.head.appendChild(css);
}

export const timerWidget: WidgetDefinition<TimerSettings> = {
  type: 'timer',
  name: 'Timer',
  description: 'Countdown ring. Start, pause and reset it by voice or command; Pomodoro too.',
  defaultSize: { w: 600, h: 600 },
  defaultSettings: {
    style: 'ring',
    font: FONT_OPTIONS[0].value,
    size: 130,
    color: '#ffffff',
    ringColor: '#5ac0f2',
    breakColor: '#34c759',
    trackColor: '#2a2a2a',
    ringWidth: 22,
    showLabel: true,
    whenIdle: 'hide',
    doneText: "Time's up",
    doneHold: 60,
    flash: true,
    chime: true,
  },
  settingsSchema: [
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      options: [
        { value: 'ring', label: 'Ring + time' },
        { value: 'text', label: 'Time only' },
      ],
    },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Time size (px)', type: 'number', min: 10, max: 800 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'ringColor', label: 'Ring color', type: 'color', when: { key: 'style', is: ['ring'] } },
    { key: 'breakColor', label: 'Break color (Pomodoro)', type: 'color', when: { key: 'style', is: ['ring'] } },
    { key: 'trackColor', label: 'Track color', type: 'color', when: { key: 'style', is: ['ring'] } },
    { key: 'ringWidth', label: 'Ring width', type: 'number', min: 1, max: 200, when: { key: 'style', is: ['ring'] } },
    { key: 'showLabel', label: 'Label (e.g. Focus)', type: 'toggle' },
    {
      key: 'whenIdle',
      label: 'When no timer is running',
      type: 'select',
      options: [
        { value: 'hide', label: 'Show nothing' },
        { value: 'show', label: 'Show 0:00' },
      ],
    },
    { key: 'doneText', label: 'Finished text', type: 'text' },
    { key: 'doneHold', label: 'Show finished for (seconds)', type: 'number', min: 0, max: 3600, help: 'Then it hides, unless "Show 0:00" is chosen.' },
    { key: 'flash', label: 'Flash when finished', type: 'toggle' },
    { key: 'chime', label: 'Chime when finished', type: 'toggle', help: 'The projector plays sound only after one remote button press.' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let timer: TimerState = ctx.state.get().timer;
    let chimedFor = 0;
    let active = true;
    let stop: (() => void) | null = null;

    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    el.appendChild(root);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible');
    const track = document.createElementNS(svgNS, 'circle');
    const arc = document.createElementNS(svgNS, 'circle');
    svg.appendChild(track);
    svg.appendChild(arc);
    root.appendChild(svg);
    const text = document.createElement('div');
    const time = document.createElement('div');
    const label = document.createElement('div');
    text.appendChild(time);
    text.appendChild(label);
    root.appendChild(text);

    function layout() {
      const w = ctx.size.w;
      const h = ctx.size.h;
      const r = Math.max(1, Math.min(w, h) / 2 - s.ringWidth / 2 - 2);
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      for (const c of [track, arc]) {
        c.setAttribute('cx', '' + w / 2);
        c.setAttribute('cy', '' + h / 2);
        c.setAttribute('r', '' + r);
        c.setAttribute('fill', 'none');
        c.setAttribute('stroke-width', '' + s.ringWidth);
      }
      track.setAttribute('stroke', s.trackColor);
      arc.setAttribute('stroke-linecap', 'round');
      // Start at 12 o'clock, run clockwise.
      arc.setAttribute('transform', 'rotate(-90 ' + w / 2 + ' ' + h / 2 + ')');
      arc.setAttribute('stroke-dasharray', '' + TAU * r);
      svg.style.display = s.style === 'ring' ? 'block' : 'none';
      text.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'font-family:' + s.font + ';color:' + s.color + ';line-height:1;white-space:nowrap;';
      time.style.cssText = 'font-size:' + s.size + 'px;font-weight:600;font-variant-numeric:tabular-nums;';
      label.style.cssText = 'font-size:' + Math.round(s.size * 0.28) + 'px;opacity:.75;margin-top:' + Math.round(s.size * 0.15) + 'px;';
    }

    function render() {
      const now = ctx.now().getTime();
      const remaining = timerRemaining(timer, now);
      const running = timer.status === 'running';
      const finished = running && remaining <= 0 && !timer.pomodoro;
      const finishedFor = finished ? now - timer.endsAt : 0;
      const holdOver = finished && finishedFor > s.doneHold * 1000;
      const idle = timer.status === 'idle' || holdOver;

      if (idle && s.whenIdle === 'hide') {
        root.style.display = ctx.mode === 'editor' ? 'block' : 'none';
        root.style.opacity = ctx.mode === 'editor' ? '0.35' : '1';
      } else {
        root.style.display = 'block';
        root.style.opacity = timer.status === 'paused' ? '0.6' : '1';
      }

      const total = timer.durationMs || 1;
      const frac = idle ? 0 : Math.max(0, Math.min(1, remaining / total));
      const r = parseFloat(arc.getAttribute('r') || '0');
      arc.setAttribute('stroke-dashoffset', '' + TAU * r * (1 - frac));
      arc.setAttribute('stroke', timer.pomodoro && timer.pomodoro.phase === 'break' ? s.breakColor : s.ringColor);
      arc.style.display = frac > 0 ? 'block' : 'none';

      if (finished && !holdOver) {
        time.textContent = s.doneText || '0:00';
        // Words are wider than "12:34": shrink so they fit inside the ring.
        time.style.fontSize = Math.round(s.size * (s.doneText && s.doneText.length > 5 ? 0.6 : 1)) + 'px';
        root.style.animation = s.flash ? 'wallTimerFlash 1s ease-in-out infinite' : '';
        // Chime once per finish, and only if we saw it happen (not on a page load much later).
        if (s.chime && ctx.mode === 'display' && chimedFor !== timer.endsAt && finishedFor < 5000) {
          chimedFor = timer.endsAt;
          playChime();
        }
      } else {
        time.textContent = formatClock(idle ? 0 : remaining);
        time.style.fontSize = s.size + 'px';
        root.style.animation = '';
      }

      let lbl = '';
      if (s.showLabel && !idle) {
        lbl = timer.label || '';
        if (timer.pomodoro) lbl += (lbl ? ' · ' : '') + 'round ' + (timer.pomodoro.round + (timer.pomodoro.phase === 'focus' ? 1 : 0));
        if (timer.status === 'paused') lbl = (lbl ? lbl + ' · ' : '') + 'paused';
      }
      if (ctx.mode === 'editor' && idle) lbl = 'No timer running';
      label.textContent = lbl;
      label.style.display = lbl ? 'block' : 'none';
    }

    function sync() {
      if (stop) stop();
      stop = active ? everySecond(render) : null;
    }

    layout();
    render();
    sync();

    return {
      update(next) {
        s = next;
        layout();
        render();
      },
      resize() {
        layout();
        render();
      },
      onState(state: LiveState) {
        if (state.timer !== timer) {
          timer = state.timer;
          render();
        }
      },
      setActive(a) {
        active = a;
        sync();
        if (a) render();
      },
      destroy() {
        if (stop) stop();
        el.removeChild(root);
      },
    };
  },
};
