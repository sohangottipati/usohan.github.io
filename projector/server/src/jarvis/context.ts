// A compact, plain-text snapshot of what the wall knows right now, so the brain
// can answer "do I have time for a nap?" and pick sensible commands.

import { activeScene, spotifyProgress, timerRemaining, type LiveState, type Project } from '../../../shared/types';
import { clockTime, localDate, speakableNow } from './time';

function mins(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
}

export function buildContext(live: LiveState, project: Project, now: number, tz: string): string {
  const lines: string[] = [];
  lines.push('Now: ' + speakableNow(now, tz) + ' (' + tz + ')');

  const scene = activeScene(project);
  lines.push('Scenes: ' + project.scenes.map((s) => s.name + (s.id === scene.id ? ' (on)' : '')).join(', '));
  lines.push('Wall: ' + (live.blackout ? 'blacked out' : 'on'));

  const t = live.timer;
  if (t && t.status !== 'idle') {
    const left = timerRemaining(t, now);
    const what = (t.label ? t.label + ' timer' : 'Timer') + (t.pomodoro ? ' (pomodoro ' + t.pomodoro.phase + ', round ' + (t.pomodoro.round + 1) + ')' : '');
    lines.push('Timer: ' + what + ', ' + (t.status === 'paused' ? 'paused with ' + mins(left) + ' left' : left > 0 ? mins(left) + ' left' : 'finished'));
  } else {
    lines.push('Timer: none');
  }

  const sp = live.spotify;
  if (sp === undefined || sp === null) lines.push('Spotify: not connected');
  else if (sp.track) {
    lines.push(
      'Spotify: ' + (sp.isPlaying ? 'playing' : 'paused') + ' "' + sp.track.name + '" by ' + sp.track.artists +
        ' (' + mins(spotifyProgress(sp, now)) + ' of ' + mins(sp.track.durationMs) + ')' + (sp.volume !== null ? ', volume ' + sp.volume : ''),
    );
  } else lines.push('Spotify: connected, nothing playing');

  const cal = live.calendar;
  if (cal === undefined || cal === null) lines.push('Calendar: not connected');
  else {
    const today = localDate(now, tz);
    const upcoming = cal.events
      .filter((e) => (e.allDay ? e.end > today : Date.parse(e.end) > now))
      .slice(0, 8)
      .map((e) => {
        if (e.allDay) return '- ' + (e.start <= today ? 'today' : e.start) + ' all day: ' + e.title;
        const start = Date.parse(e.start);
        const day = localDate(start, tz) === today ? 'today' : localDate(start, tz);
        return '- ' + day + ' ' + clockTime(start, tz) + '-' + clockTime(Date.parse(e.end), tz) + ': ' + e.title + (start <= now ? ' (happening now)' : '');
      });
    lines.push('Calendar (upcoming):' + (upcoming.length ? '\n' + upcoming.join('\n') : ' nothing'));
  }

  const todos = live.todos;
  if (todos === undefined || todos === null) lines.push('To-dos: not connected');
  else {
    const today = localDate(now, tz);
    const items = todos.items.slice(0, 12).map((i) => '- ' + i.title + (i.due ? (i.due < today ? ' (OVERDUE, was due ' + i.due + ')' : ' (due ' + (i.due === today ? 'today' : i.due) + ')') : ''));
    lines.push('To-dos (' + todos.items.length + ' open):' + (items.length ? '\n' + items.join('\n') : ' none'));
  }
  return lines.join('\n');
}
