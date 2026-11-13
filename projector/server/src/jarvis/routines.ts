// Routines: a phrase ("goodnight") runs a list of steps. Pure helpers here;
// the Durable Object runs the steps and schedules the delayed ones.

import { MAX_ROUTINES, MAX_ROUTINE_STEPS, type Routine, type RoutineStep } from '../../../shared/jarvis';

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/^\s*(hey|ok|okay)\s+(siri|alexa|google)\b/, ' ')
    .replace(/^\s*(the\s+)?wall\b/, ' ')
    .replace(/\b(please|jarvis)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Validates routines from the editor. */
export function sanitizeRoutines(input: any, makeId: () => string): Routine[] {
  if (!Array.isArray(input)) return [];
  const out: Routine[] = [];
  for (const r of input.slice(0, MAX_ROUTINES)) {
    if (!r || typeof r !== 'object') continue;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : '';
    if (!name) continue;
    const phrases = (Array.isArray(r.phrases) ? r.phrases : [])
      .filter((p: any) => typeof p === 'string' && norm(p))
      .map((p: string) => p.trim().slice(0, 60))
      .slice(0, 6);
    if (!phrases.length) phrases.push(name);
    const steps: RoutineStep[] = [];
    for (const st of (Array.isArray(r.steps) ? r.steps : []).slice(0, MAX_ROUTINE_STEPS)) {
      if (!st || ['do', 'speak', 'wait'].indexOf(st.kind) < 0) continue;
      const value = typeof st.value === 'string' ? st.value.trim().slice(0, 200) : String(st.value || '');
      if (!value) continue;
      if (st.kind === 'wait' && !(parseFloat(value) > 0)) continue;
      steps.push({ kind: st.kind, value });
    }
    out.push({ id: typeof r.id === 'string' && r.id ? r.id.slice(0, 20) : makeId(), name, phrases, steps });
  }
  return out;
}

/** The routine this sentence asks for, if any (whole-phrase match, ignoring "hey siri", "wall", "please"). */
export function matchRoutine(input: string, routines: Routine[]): Routine | null {
  const t = norm(input);
  if (!t) return null;
  for (const r of routines) {
    for (const p of r.phrases.concat(r.name)) {
      const q = norm(p);
      if (q && (t === q || t === 'run ' + q || t === q + ' routine' || t === 'run ' + q + ' routine' || t === 'start ' + q)) return r;
    }
  }
  return null;
}

/** Find a routine by (approximate) name, for the brain's routine.run. */
export function findRoutine(name: string, routines: Routine[]): Routine | null {
  const t = norm(name);
  return routines.find((r) => norm(r.name) === t) || routines.find((r) => norm(r.name).indexOf(t) >= 0 || t.indexOf(norm(r.name)) >= 0) || matchRoutine(name, routines);
}

export interface ScheduledStep {
  at: number;
  routineId: string;
  routineName: string;
  step: RoutineStep;
}

/** Splits a routine into steps to run now and steps to run later (after "wait" steps). */
export function planRoutine(r: Routine, now: number): { now: RoutineStep[]; later: ScheduledStep[] } {
  let delay = 0;
  const immediate: RoutineStep[] = [];
  const later: ScheduledStep[] = [];
  for (const st of r.steps) {
    if (st.kind === 'wait') {
      delay += Math.min(24 * 60, parseFloat(st.value) || 0) * 60000;
      continue;
    }
    if (delay === 0) immediate.push(st);
    else later.push({ at: now + delay, routineId: r.id, routineName: r.name, step: st });
  }
  return { now: immediate, later };
}
