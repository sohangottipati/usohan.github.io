// Runs a structured Command against the wall's state and returns a short,
// spoken-friendly reply. No I/O: the Durable Object persists and broadcasts
// whatever changed. Integrations (Spotify, Google) plug in here later.

import { idleTimer, timerRemaining, type Command, type CommandResult, type LiveState, type Project, type TimerState } from '../../../shared/types';

export interface CommandState {
  live: LiveState;
  project: Project;
  now: number;
}

export interface CommandOutcome {
  result: CommandResult;
  live?: LiveState;
  project?: Project;
}

const MAX_TIMER_MS = 24 * 3600 * 1000;
const POMODORO_FOCUS = 25;
const POMODORO_BREAK = 5;
const POMODORO_LONG_BREAK = 15;

/** "25 minutes", "1 hour and 5 minutes", "45 seconds". */
export function speakDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
  const parts: string[] = [];
  if (h) parts.push(plural(h, 'hour'));
  if (m) parts.push(plural(m, 'minute'));
  // Seconds only matter for short durations.
  if (s && total < 600) parts.push(plural(s, 'second'));
  if (!parts.length) return '0 seconds';
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function ok(reply: string, extra: Partial<CommandOutcome> = {}): CommandOutcome {
  return { result: { ok: true, reply }, ...extra };
}
function fail(reply: string): CommandOutcome {
  return { result: { ok: false, reply } };
}

function num(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
}

function startTimer(live: LiveState, now: number, ms: number, label: string, pomodoro: TimerState['pomodoro'] = null): LiveState {
  return { ...live, timer: { status: 'running', label, durationMs: ms, endsAt: now + ms, remainingMs: 0, pomodoro } };
}

function labelled(t: TimerState): string {
  return t.label ? t.label + ' timer' : 'Timer';
}

export function runCommand(cmd: Command, st: CommandState): CommandOutcome {
  const p = cmd.payload || {};
  const { live, project, now } = st;
  const t = live.timer;
  const remaining = timerRemaining(t, now);
  const active = t.status === 'paused' || (t.status === 'running' && remaining > 0);

  switch (cmd.type) {
    // ---------- timer ----------
    case 'timer.start': {
      if (p.pomodoro) {
        const focus = num(p.focusMinutes) || POMODORO_FOCUS;
        const brk = num(p.breakMinutes) || POMODORO_BREAK;
        return ok(`Pomodoro started. ${speakDuration(focus * 60000)} of focus.`, {
          live: startTimer(live, now, focus * 60000, 'Focus', { phase: 'focus', round: 0, focusMinutes: focus, breakMinutes: brk }),
        });
      }
      const minutes = num(p.minutes);
      const seconds = num(p.seconds) || 0;
      if (minutes !== null || seconds) {
        const ms = Math.round(((minutes || 0) * 60 + seconds) * 1000);
        if (ms < 1000 || ms > MAX_TIMER_MS) return fail('Timers can be from 1 second to 24 hours.');
        const label = typeof p.label === 'string' ? p.label.slice(0, 40).trim() : '';
        return ok(`${label ? label + ' timer' : 'Timer'} set for ${speakDuration(ms)}.`, { live: startTimer(live, now, ms, label) });
      }
      // No duration: resume a paused timer.
      if (t.status === 'paused') {
        return ok(`${labelled(t)} resumed. ${speakDuration(t.remainingMs)} left.`, {
          live: { ...live, timer: { ...t, status: 'running', endsAt: now + t.remainingMs, remainingMs: 0 } },
        });
      }
      if (active) return ok(`${labelled(t)} is already running. ${speakDuration(remaining)} left.`);
      return fail("Say how long, like 'timer 10 minutes'.");
    }
    case 'timer.pause': {
      if (t.status === 'paused') return ok(`${labelled(t)} is already paused.`);
      if (!active) return fail("There's no timer running.");
      return ok(`${labelled(t)} paused with ${speakDuration(remaining)} left.`, {
        live: { ...live, timer: { ...t, status: 'paused', remainingMs: remaining, endsAt: 0 } },
      });
    }
    case 'timer.reset': {
      if (t.status === 'idle') return ok("There's no timer to cancel.");
      return ok(t.pomodoro ? 'Pomodoro stopped.' : `${labelled(t)} cancelled.`, { live: { ...live, timer: idleTimer() } });
    }
    case 'timer.add': {
      const add = Math.round(((num(p.minutes) || 0) * 60 + (num(p.seconds) || 0)) * 1000);
      if (add <= 0) return fail('Say how much time to add.');
      if (!active) return ok(`Timer set for ${speakDuration(add)}.`, { live: startTimer(live, now, add, '') });
      const next: TimerState =
        t.status === 'paused'
          ? { ...t, remainingMs: Math.min(MAX_TIMER_MS, t.remainingMs + add), durationMs: t.durationMs + add }
          : { ...t, endsAt: Math.min(now + MAX_TIMER_MS, t.endsAt + add), durationMs: t.durationMs + add };
      return ok(`Added ${speakDuration(add)}. ${speakDuration(timerRemaining(next, now))} left.`, { live: { ...live, timer: next } });
    }
    case 'timer.status': {
      if (!active) return ok("There's no timer running.");
      const phase = t.pomodoro ? (t.pomodoro.phase === 'focus' ? ' of focus' : ' of break') : '';
      return ok(`${speakDuration(remaining)}${phase} left${t.status === 'paused' ? ', paused' : ''}.`);
    }

    // ---------- display ----------
    case 'display.blackout':
      return ok('Wall is dark.', { live: { ...live, blackout: true } });
    case 'display.wake':
      return ok(live.blackout ? 'Wall is back on.' : 'Wall is already on.', { live: { ...live, blackout: false } });

    case 'text.say': {
      const text = typeof p.text === 'string' ? p.text.trim().slice(0, 280) : '';
      if (!text) return fail('What should I show?');
      const seconds = Math.max(1, Math.min(3600, num(p.seconds) || 10));
      return ok(`Showing it for ${speakDuration(seconds * 1000)}.`, {
        live: { ...live, message: { id: now.toString(36), text, until: now + seconds * 1000 } },
      });
    }

    // ---------- scenes ----------
    case 'scene.set': {
      const want = String(p.name || p.id || '').toLowerCase().trim();
      if (!want) return fail('Which scene?');
      const scene =
        project.scenes.find((s) => s.id === p.id) ||
        project.scenes.find((s) => s.name.toLowerCase() === want) ||
        project.scenes.find((s) => s.name.toLowerCase().indexOf(want) === 0) ||
        project.scenes.find((s) => s.name.toLowerCase().indexOf(want) >= 0);
      if (!scene) return fail(`There's no ${want} scene. You have ${project.scenes.map((s) => s.name).join(', ')}.`);
      if (scene.id === project.activeSceneId) return ok(`${scene.name} is already on.`);
      return ok(`Switched to ${scene.name}.`, { project: { ...project, activeSceneId: scene.id } });
    }

    // ---------- coming in later milestones ----------
    case 'spotify.next':
    case 'spotify.previous':
    case 'spotify.play':
    case 'spotify.pause':
    case 'spotify.volume':
      return fail("Spotify isn't connected yet.");
    case 'todo.add':
    case 'todo.complete':
      return fail("To-dos aren't set up yet.");
  }
  return fail(`I don't know the command ${cmd.type}.`);
}

/**
 * Called when a running timer reaches zero. Pomodoro timers roll over to the
 * next phase; plain timers stay at zero (the widget shows "Time's up").
 * Returns new live state, or null if nothing changes.
 */
export function advanceTimer(live: LiveState, now: number): LiveState | null {
  const t = live.timer;
  if (t.status !== 'running' || !t.pomodoro || now < t.endsAt) return null;
  const pd = t.pomodoro;
  if (pd.phase === 'focus') {
    const round = pd.round + 1;
    const long = round % 4 === 0;
    const mins = long ? POMODORO_LONG_BREAK : pd.breakMinutes;
    return startTimer(live, t.endsAt, mins * 60000, long ? 'Long break' : 'Break', { ...pd, phase: 'break', round });
  }
  return startTimer(live, t.endsAt, pd.focusMinutes * 60000, 'Focus', { ...pd, phase: 'focus' });
}
