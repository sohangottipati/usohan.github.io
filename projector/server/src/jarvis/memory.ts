// Long-term memory: facts Sohan explicitly asks Jarvis to remember. Stored in
// the Durable Object and included in every brain request, so they're capped to
// keep requests small (and the free daily allowance stretching far).

import type { MemoryFact } from '../../../shared/jarvis';
import { MAX_FACTS, MAX_FACT_CHARS, MAX_MEMORY_CHARS } from '../../../shared/jarvis';

export interface MemoryOutcome {
  facts: MemoryFact[];
  ok: boolean;
  reply: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const FILLER = /\b(the|a|an|my|that|this|thing|things|stuff|fact|note|one|about|of|is|was|i|me|you|told|said)\b/g;

/**
 * Which saved fact does "the pizza thing" mean? Scores how much of what was
 * said (minus filler words) appears in each fact; needs at least half.
 */
export function matchFact(said: string, facts: MemoryFact[]): MemoryFact | null {
  const words = norm(said).replace(FILLER, ' ').split(' ').filter(Boolean);
  if (!words.length) return null;
  let best: MemoryFact | null = null;
  let bestScore = 0;
  for (const f of facts) {
    const t = norm(f.text);
    const tWords = t.split(' ');
    let hit = 0;
    for (const w of words) if (tWords.indexOf(w) >= 0 || (w.length > 3 && tWords.some((x) => x.indexOf(w) === 0 || w.indexOf(x) === 0 && x.length > 3))) hit++;
    const score = hit / words.length + (t.indexOf(norm(said)) >= 0 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** "that my mom's birthday is March 3." → "My mom's birthday is March 3" */
export function cleanFact(text: string): string {
  let t = text.trim().replace(/^(that|about)\s+/i, '').replace(/[.!\s]+$/, '');
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t.slice(0, MAX_FACT_CHARS);
}

export function totalChars(facts: MemoryFact[]): number {
  return facts.reduce((n, f) => n + f.text.length, 0);
}

export function addFact(facts: MemoryFact[], text: string, now: number, id: string): MemoryOutcome {
  const fact = cleanFact(text);
  if (!fact) return { facts, ok: false, reply: 'What should I remember?' };
  if (facts.some((f) => norm(f.text) === norm(fact))) return { facts, ok: true, reply: 'I already know that.' };
  if (facts.length >= MAX_FACTS || totalChars(facts) + fact.length > MAX_MEMORY_CHARS) {
    return { facts, ok: false, reply: 'My memory is full. Delete a few things in the Jarvis panel first.' };
  }
  return { facts: [...facts, { id, text: fact, at: now }], ok: true, reply: 'Got it. I’ll remember that.' };
}

export function forgetFact(facts: MemoryFact[], text: string, id?: string): MemoryOutcome {
  const target = id ? facts.find((f) => f.id === id) || null : matchFact(text, facts);
  if (!target) return { facts, ok: false, reply: "I don't have anything like that saved." };
  return { facts: facts.filter((f) => f.id !== target.id), ok: true, reply: 'Forgotten: ' + target.text + '.' };
}

export function listFacts(facts: MemoryFact[], aboutMe: string): MemoryOutcome {
  if (!facts.length && !aboutMe.trim()) return { facts, ok: true, reply: "Nothing yet. Say 'remember that…' and I'll keep it." };
  const parts: string[] = [];
  if (aboutMe.trim()) parts.push('your About me notes');
  if (facts.length) {
    const shown = facts.slice(-5).map((f) => f.text);
    parts.push(facts.length + (facts.length === 1 ? ' fact' : ' facts') + ', including: ' + shown.join('; '));
  }
  return { facts, ok: true, reply: 'I have ' + parts.join(', and ') + '.' };
}
