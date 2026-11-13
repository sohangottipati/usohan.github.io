import type { LiveState, MessageState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { fitText } from '../util';

export interface MessageSettings {
  font: string;
  maxSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

/**
 * Where "text.say" messages appear. Without a visible Message layer, the
 * display shows them centred on the wall instead.
 */
export const messageWidget: WidgetDefinition<MessageSettings> = {
  type: 'message',
  name: 'Message',
  description: 'Shows "say …" messages here instead of the middle of the wall.',
  defaultSize: { w: 1200, h: 300 },
  defaultSettings: { font: FONT_OPTIONS[0].value, maxSize: 140, color: '#ffffff', align: 'center' },
  settingsSchema: [
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'maxSize', label: 'Largest size (px)', type: 'number', min: 10, max: 600, help: 'Long messages shrink to fit the box.' },
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
    const node = document.createElement('div');
    el.appendChild(node);
    let hideTimer: any = null;

    function render(msg: MessageState | null) {
      clearTimeout(hideTimer);
      const left = msg ? msg.until - ctx.now().getTime() : 0;
      const show = !!msg && left > 0;
      const justify = s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center';
      node.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:' + justify + ';' +
        'overflow:hidden;box-sizing:border-box;padding:2%;line-height:1.1;white-space:pre-wrap;word-wrap:break-word;' +
        'font-family:' + s.font + ';font-weight:600;color:' + s.color + ';text-align:' + s.align + ';';
      if (show) {
        node.textContent = msg!.text;
        node.style.opacity = '1';
        fitText(node, s.maxSize);
        hideTimer = setTimeout(() => render(msg), left + 50);
      } else if (ctx.mode === 'editor') {
        node.textContent = 'Messages appear here';
        node.style.opacity = '0.3';
        fitText(node, Math.min(60, s.maxSize));
      } else {
        node.textContent = '';
      }
    }

    render(ctx.state.get().message);
    return {
      update(next) {
        s = next;
        render(ctx.state.get().message);
      },
      resize() {
        render(ctx.state.get().message);
      },
      onState(state: LiveState) {
        render(state.message);
      },
      destroy() {
        clearTimeout(hideTimer);
        el.removeChild(node);
      },
    };
  },
};
