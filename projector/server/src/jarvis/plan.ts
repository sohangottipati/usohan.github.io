// The brain answers with a small JSON plan: commands to run, and what to say.
// Parsing is lenient (models sometimes wrap JSON in prose or code fences) but
// the result is strictly validated: only known command types get through.

import type { Command } from '../../../shared/types';

export interface Plan {
  commands: Command[];
  reply: string;
}

const MAX_COMMANDS = 6;

/** Every command type the brain may use. Integrations' commands are included; they fail politely if not connected. */
export const BRAIN_COMMANDS = [
  'work.next',
  'focus.start',
  'focus.done',
  'focus.stats',
  'calendar.free',
  'todo.breakdown',
  'timer.start',
  'timer.pause',
  'timer.reset',
  'timer.add',
  'timer.status',
  'text.say',
  'display.blackout',
  'display.wake',
  'scene.set',
  'scene.next',
  'scene.previous',
  'spotify.next',
  'spotify.previous',
  'spotify.play',
  'spotify.pause',
  'spotify.volume',
  'todo.add',
  'todo.complete',
  'jarvis.briefing',
  'calendar.add',
  'calendar.undo',
  'email.summary',
  'canvas.due',
  'routine.run',
  'routine.cancel',
  'memory.save',
  'memory.forget',
  'memory.list',
];

/** Pull the first balanced {...} object out of a model's text. */
export function extractJson(text: string): any | null {
  if (!text) return null;
  const s = text.replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/** Turn a model response (string or already-parsed object) into a validated plan, or null. */
export function parsePlan(raw: unknown): Plan | null {
  const data = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!data || typeof data !== 'object') {
    // A model that ignored the format but said something sensible: speak it, run nothing.
    if (typeof raw === 'string' && raw.trim() && raw.trim().length < 400 && raw.indexOf('{') < 0) return { commands: [], reply: raw.trim() };
    return null;
  }
  const d = data as any;
  const commands: Command[] = [];
  const list = Array.isArray(d.commands) ? d.commands : Array.isArray(d.actions) ? d.actions : [];
  for (const c of list.slice(0, MAX_COMMANDS)) {
    if (!c || typeof c !== 'object' || typeof c.type !== 'string') continue;
    if (BRAIN_COMMANDS.indexOf(c.type) < 0) continue;
    const payload = c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload) ? c.payload : undefined;
    commands.push(payload ? { type: c.type, payload } : { type: c.type });
  }
  const reply = typeof d.reply === 'string' ? d.reply.trim().slice(0, 500) : typeof d.say === 'string' ? d.say.trim().slice(0, 500) : '';
  if (!commands.length && !reply) return null;
  return { commands, reply };
}
