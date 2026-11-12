import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { everySecond, formatDate, formatTime } from '../util';

export interface TextSettings {
  text: string;
  font: string;
  size: number;
  weight: string;
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
}

const TEMPLATE = /\{(time|time24|date|seconds)\}/;

export function renderTemplate(text: string, d: Date): string {
  return text
    .replace(/\{time\}/g, formatTime(d, false, false))
    .replace(/\{time24\}/g, formatTime(d, true, false))
    .replace(/\{date\}/g, formatDate(d))
    .replace(/\{seconds\}/g, formatTime(d, true, true));
}

function style(node: HTMLElement, s: TextSettings) {
  const justify = s.valign === 'top' ? 'flex-start' : s.valign === 'bottom' ? 'flex-end' : 'center';
  node.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;' +
    'justify-content:' + justify + ';white-space:pre-wrap;line-height:1.15;overflow:hidden;' +
    'font-family:' + s.font + ';font-size:' + s.size + 'px;font-weight:' + s.weight + ';color:' + s.color + ';text-align:' + s.align + ';';
}

export const textWidget: WidgetDefinition<TextSettings> = {
  type: 'text',
  name: 'Text',
  description: 'Static text, or templated with {time}, {time24}, {date}, {seconds}.',
  defaultSize: { w: 800, h: 200 },
  defaultSettings: {
    text: 'Hello, wall',
    font: FONT_OPTIONS[0].value,
    size: 96,
    weight: '600',
    color: '#ffffff',
    align: 'center',
    valign: 'middle',
  },
  settingsSchema: [
    { key: 'text', label: 'Text', type: 'text', multiline: true, help: 'Templates: {time} {time24} {date} {seconds}' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Size (px)', type: 'number', min: 8, max: 1000 },
    {
      key: 'weight',
      label: 'Weight',
      type: 'select',
      options: [
        { value: '300', label: 'Light' },
        { value: '400', label: 'Regular' },
        { value: '600', label: 'Semibold' },
        { value: '800', label: 'Bold' },
      ],
    },
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
    {
      key: 'valign',
      label: 'Vertical',
      type: 'select',
      options: [
        { value: 'top', label: 'Top' },
        { value: 'middle', label: 'Middle' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    const node = document.createElement('div');
    const span = document.createElement('div');
    node.appendChild(span);
    el.appendChild(node);
    let stop: (() => void) | null = null;
    let active = true;

    const render = () => {
      span.textContent = TEMPLATE.test(s.text) ? renderTemplate(s.text, ctx.now()) : s.text;
    };
    const sync = () => {
      if (stop) stop();
      stop = null;
      if (active && TEMPLATE.test(s.text)) stop = everySecond(render);
    };
    style(node, s);
    render();
    sync();

    return {
      update(next) {
        s = next;
        style(node, s);
        render();
        sync();
      },
      resize() {},
      setActive(a) {
        active = a;
        if (a) render();
        sync();
      },
      destroy() {
        if (stop) stop();
        el.removeChild(node);
      },
    };
  },
};
