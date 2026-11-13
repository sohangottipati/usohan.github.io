// AI usage: what Jarvis's brain and voice have used today and this month, so a
// layer can show it. Claude is priced per token; Workers AI is free up to its
// daily allowance, so it counts requests and tokens but no dollars.

export interface UsageTotals {
  /** Model requests (brain, briefing/summary writing, voice). */
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Estimated, in US dollars (Claude only). */
  costUsd: number;
  /** How many of the calls were spoken audio. */
  speech: number;
  errors: number;
}

export interface AiUsage {
  /** YYYY-MM-DD in the wall's time zone. */
  day: string;
  /** YYYY-MM */
  month: string;
  today: UsageTotals;
  thisMonth: UsageTotals;
  todayClaude: UsageTotals;
  todayWorkers: UsageTotals;
  last: { at: number; provider: UsageEvent['provider']; model: string } | null;
}

export interface UsageEvent {
  provider: 'claude' | 'workers-ai';
  model: string;
  kind: 'think' | 'write' | 'speech';
  tokensIn: number;
  tokensOut: number;
  cacheRead?: number;
  cacheWrite?: number;
  ok: boolean;
}

/** US dollars per million tokens (first-party API rates, Nov 2026). */
export const CLAUDE_PRICES: { [model: string]: { input: number; output: number; cacheRead: number } } = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function emptyTotals(): UsageTotals {
  return { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, speech: 0, errors: 0 };
}

export function eventCost(e: UsageEvent): number {
  if (e.provider !== 'claude') return 0;
  const p = CLAUDE_PRICES[e.model] || CLAUDE_PRICES['claude-opus-5-5'];
  // Cache writes cost 1.25x input (5-minute cache).
  return (e.tokensIn * p.input + (e.cacheWrite || 0) * p.input * 1.25 + (e.cacheRead || 0) * p.cacheRead + e.tokensOut * p.output) / 1e6;
}

function add(t: UsageTotals, e: UsageEvent, cost: number): UsageTotals {
  return {
    calls: t.calls + 1,
    tokensIn: t.tokensIn + e.tokensIn + (e.cacheRead || 0) + (e.cacheWrite || 0),
    tokensOut: t.tokensOut + e.tokensOut,
    costUsd: t.costUsd + cost,
    speech: t.speech + (e.kind === 'speech' ? 1 : 0),
    errors: t.errors + (e.ok ? 0 : 1),
  };
}

/** Roll over to a new day/month when needed. */
export function rollUsage(u: AiUsage | null | undefined, day: string): AiUsage {
  const month = day.slice(0, 7);
  if (!u) return { day, month, today: emptyTotals(), thisMonth: emptyTotals(), todayClaude: emptyTotals(), todayWorkers: emptyTotals(), last: null };
  let out = u;
  if (out.month !== month) out = { ...out, month, thisMonth: emptyTotals() };
  if (out.day !== day) out = { ...out, day, today: emptyTotals(), todayClaude: emptyTotals(), todayWorkers: emptyTotals() };
  return out;
}

export function recordUsage(u: AiUsage | null | undefined, e: UsageEvent, day: string, now: number): AiUsage {
  const r = rollUsage(u, day);
  const cost = eventCost(e);
  return {
    ...r,
    today: add(r.today, e, cost),
    thisMonth: add(r.thisMonth, e, cost),
    todayClaude: e.provider === 'claude' ? add(r.todayClaude, e, cost) : r.todayClaude,
    todayWorkers: e.provider === 'workers-ai' ? add(r.todayWorkers, e, cost) : r.todayWorkers,
    last: { at: now, provider: e.provider, model: e.model },
  };
}
