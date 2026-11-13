// AI usage: how much Jarvis has used today and this month (requests, tokens,
// estimated Claude cost), with an optional monthly budget bar. Numbers change
// often, so nothing animates; they just update in place.

import { localDateKey, type LiveState } from '../../types';
import { emptyTotals, type AiUsage, type UsageTotals } from '../../usage';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';

export interface AiUsageSettings {
  period: 'today' | 'month' | 'both';
  showCost: boolean;
  showTokens: boolean;
  showSplit: boolean;
  monthlyBudget: number;
  title: string;
  font: string;
  size: number;
  color: string;
  accent: string;
  warnColor: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}
function money(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return '$' + (n < 10 ? n.toFixed(2) : n.toFixed(0));
}
function plural(n: number, one: string, many: string): string {
  return n + ' ' + (n === 1 ? one : many);
}

export const aiUsageWidget: WidgetDefinition<AiUsageSettings> = {
  type: 'aiUsage',
  name: 'AI usage',
  description: 'What Jarvis has used today and this month: requests, tokens and estimated Claude cost.',
  defaultSize: { w: 820, h: 320 },
  defaultSettings: {
    period: 'both',
    showCost: true,
    showTokens: true,
    showSplit: true,
    monthlyBudget: 0,
    title: 'AI usage',
    font: FONT_OPTIONS[0].value,
    size: 48,
    color: '#ffffff',
    accent: '#5ac0f2',
    warnColor: '#ff6b6b',
  },
  settingsSchema: [
    {
      key: 'period',
      label: 'Show',
      type: 'select',
      options: [
        { value: 'both', label: 'Today and this month' },
        { value: 'today', label: 'Today' },
        { value: 'month', label: 'This month' },
      ],
    },
    { key: 'showCost', label: 'Estimated cost (Claude)', type: 'toggle' },
    { key: 'showTokens', label: 'Tokens', type: 'toggle' },
    { key: 'showSplit', label: 'Claude vs Workers AI (today)', type: 'toggle' },
    { key: 'monthlyBudget', label: 'Monthly budget in $ (0 = no bar)', type: 'number', min: 0, max: 1000 },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Text size (px)', type: 'number', min: 10, max: 300 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Accent', type: 'color' },
    { key: 'warnColor', label: 'Over-budget color', type: 'color' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let usage: AiUsage | null | undefined = ctx.state.get().aiUsage;
    const box = document.createElement('div');
    el.appendChild(box);

    /** Totals for today and this month, treating stale days/months as zero. */
    function current(): { today: UsageTotals; month: UsageTotals; claude: UsageTotals; workers: UsageTotals } {
      const day = localDateKey(ctx.now());
      const u = usage;
      const fresh = !!u && u.day === day;
      const freshMonth = !!u && u.month === day.slice(0, 7);
      return {
        today: fresh ? u!.today : emptyTotals(),
        month: freshMonth ? u!.thisMonth : emptyTotals(),
        claude: fresh ? u!.todayClaude : emptyTotals(),
        workers: fresh ? u!.todayWorkers : emptyTotals(),
      };
    }

    function block(label: string, t: UsageTotals, fs: number): string {
      const parts = [plural(t.calls, 'request', 'requests')];
      if (s.showCost) parts.push(money(t.costUsd));
      let sub = '';
      if (s.showTokens) sub = compact(t.tokensIn) + ' in · ' + compact(t.tokensOut) + ' out';
      if (t.speech) sub += (sub ? ' · ' : '') + plural(t.speech, 'spoken reply', 'spoken replies');
      if (t.errors) sub += (sub ? ' · ' : '') + plural(t.errors, 'error', 'errors');
      return (
        '<div style="margin-top:' + fs * 0.25 + 'px">' +
        '<div style="font-size:' + fs * 0.42 + 'px;letter-spacing:.08em;text-transform:uppercase;opacity:.6">' + label + '</div>' +
        '<div style="font-size:' + fs + 'px;font-weight:700;font-variant-numeric:tabular-nums">' + parts.join(' · ') + '</div>' +
        (sub ? '<div style="font-size:' + fs * 0.5 + 'px;opacity:.7;font-variant-numeric:tabular-nums">' + sub + '</div>' : '') +
        '</div>'
      );
    }

    function render() {
      const fs = s.size;
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;white-space:nowrap;' +
        'font-family:' + s.font + ';color:' + s.color + ';line-height:1.2;';
      const c = current();
      let html = s.title ? '<div style="font-size:' + fs * 0.5 + 'px;font-weight:700;color:' + s.accent + '">' + esc(s.title) + '</div>' : '';
      if (s.period !== 'month') html += block('Today', c.today, fs);
      if (s.period !== 'today') html += block('This month', c.month, s.period === 'both' ? fs * 0.75 : fs);
      if (s.showSplit && s.period !== 'month' && c.today.calls) {
        html +=
          '<div style="font-size:' + fs * 0.45 + 'px;opacity:.6;margin-top:' + fs * 0.2 + 'px">' +
          'Claude ' + c.claude.calls + (s.showCost ? ' (' + money(c.claude.costUsd) + ')' : '') + ' · Workers AI ' + c.workers.calls + ' (free)</div>';
      }
      if (s.monthlyBudget > 0) {
        const frac = c.month.costUsd / s.monthlyBudget;
        const over = frac >= 1;
        html +=
          '<div style="margin-top:' + fs * 0.25 + 'px;height:' + Math.max(4, fs * 0.12) + 'px;background:rgba(255,255,255,.15);border-radius:99px;overflow:hidden">' +
          '<div style="height:100%;width:100%;transform-origin:0 50%;transform:scaleX(' + Math.min(1, frac).toFixed(4) + ');background:' + (over ? s.warnColor : s.accent) + '"></div></div>' +
          '<div style="font-size:' + fs * 0.42 + 'px;opacity:.7;margin-top:' + fs * 0.08 + 'px;' + (over ? 'color:' + s.warnColor + ';opacity:1' : '') + '">' +
          money(c.month.costUsd) + ' of ' + money(s.monthlyBudget) + ' this month</div>';
      }
      if (!usage && ctx.mode === 'editor') html += '<div style="color:#777;font-size:' + fs * 0.45 + 'px;margin-top:' + fs * 0.2 + 'px">Counts start with the next Jarvis request.</div>';
      box.innerHTML = html;
    }

    render();
    // Re-check once a minute so "today" resets at midnight.
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
        if (state.aiUsage !== usage) {
          usage = state.aiUsage;
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
