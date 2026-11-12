import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { everySecond, formatDate, formatTime } from '../util';

export interface ClockSettings {
  format: '12' | '24';
  showSeconds: boolean;
  showDate: boolean;
  font: string;
  size: number;
  dateSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

export const clockWidget: WidgetDefinition<ClockSettings> = {
  type: 'clock',
  name: 'Clock',
  description: 'Time with an optional date line.',
  defaultSize: { w: 700, h: 300 },
  defaultSettings: {
    format: '12',
    showSeconds: false,
    showDate: true,
    font: FONT_OPTIONS[0].value,
    size: 160,
    dateSize: 44,
    color: '#ffffff',
    align: 'center',
  },
  settingsSchema: [
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      options: [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
    },
    { key: 'showSeconds', label: 'Seconds', type: 'toggle' },
    { key: 'showDate', label: 'Date line', type: 'toggle' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Time size (px)', type: 'number', min: 8, max: 1000 },
    { key: 'dateSize', label: 'Date size (px)', type: 'number', min: 8, max: 400 },
    { key: 'color', label: 'Color', type: 'color' },
    {
      key: 'align',
      label: 'Align',
      type: 'select',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    const wrap = document.createElement('div');
    const time = document.createElement('div');
    const date = document.createElement('div');
    wrap.appendChild(time);
    wrap.appendChild(date);
    el.appendChild(wrap);
    let stop: (() => void) | null = null;

    const style = () => {
      wrap.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;' +
        'white-space:nowrap;line-height:1.05;font-family:' + s.font + ';color:' + s.color + ';text-align:' + s.align + ';';
      time.style.cssText = 'font-size:' + s.size + 'px;font-weight:600;';
      date.style.cssText = 'font-size:' + s.dateSize + 'px;opacity:0.8;margin-top:0.2em;display:' + (s.showDate ? 'block' : 'none') + ';';
    };
    const render = () => {
      const d = ctx.now();
      time.textContent = formatTime(d, s.format === '24', s.showSeconds);
      if (s.showDate) date.textContent = formatDate(d);
    };
    const start = () => {
      if (!stop) stop = everySecond(render);
    };
    style();
    render();
    start();

    return {
      update(next) {
        s = next;
        style();
        render();
      },
      resize() {},
      setActive(a) {
        if (a) {
          render();
          start();
        } else if (stop) {
          stop();
          stop = null;
        }
      },
      destroy() {
        if (stop) stop();
        el.removeChild(wrap);
      },
    };
  },
};
