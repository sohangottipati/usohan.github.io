// "What should I work on?": ranks Canvas work and to-dos, and finds the free
// time around classes and events. Shared by Jarvis (server) and the Up next /
// Study time layers (display), so both always agree.

import { classKind } from './jarvis';
import type { CalendarEvent, LiveState } from './types';

const CLASS_DEFAULTS = { enabled: true, calendars: '', courseCodes: true, scene: '', quiet: true };

export interface WorkItem {
  key: string;
  title: string;
  /** Short course name ("CS 100"), or ''. */
  course: string;
  source: 'canvas' | 'todo';
  /** Epoch ms it's due (to-dos: the end of their due day), or null. */
  due: number | null;
  missing: boolean;
  overdue: boolean;
  /** Higher = do it sooner. */
  score: number;
}

export interface FreeWindow {
  /** The event happening right now, if any. */
  busy: CalendarEvent | null;
  /** When the free time starts (now, or when the current event ends). */
  from: number;
  /** When it ends (next event's start), or null if nothing else is on today. */
  until: number | null;
  next: CalendarEvent | null;
}

/** Day/time helpers for a time zone (the server passes the wall's; the display uses its own clock). */
export interface DayFns {
  /** YYYY-MM-DD for an instant. */
  dayOf(ms: number): string;
  /** The last moment of a YYYY-MM-DD day. */
  endOfDay(day: string): number;
}

export function shortCourse(c: string): string {
  return c.replace(/\s*[-–:(].*$/, '').trim() || c;
}

const HOUR = 3600000;

/** Open work, most urgent first: missing, then by due time, then undated to-dos. */
export function workItems(live: LiveState, now: number, f: DayFns, horizonDays = 14): WorkItem[] {
  const out: WorkItem[] = [];
  const horizon = now + horizonDays * 24 * HOUR;
  const cv = live.canvas;
  if (cv && !cv.error) {
    for (const i of cv.items) {
      if (i.submitted) continue;
      const due = i.due ? Date.parse(i.due) : null;
      if (!i.missing && (due === null || due > horizon || due < now - 24 * HOUR)) continue;
      const overdue = due !== null && due < now;
      out.push({
        key: 'c:' + i.id,
        title: i.title,
        course: shortCourse(i.course || ''),
        source: 'canvas',
        due,
        missing: i.missing,
        overdue,
        score: i.missing ? 1e7 : overdue ? 9e6 : 8e6 - ((due as number) - now) / 60000,
      });
    }
  }
  const td = live.todos;
  if (td) {
    const today = f.dayOf(now);
    for (const t of td.items) {
      const due = t.due ? f.endOfDay(t.due) : null;
      if (due !== null && due > horizon) continue;
      const overdue = !!t.due && t.due < today;
      out.push({
        key: 't:' + t.id,
        title: t.title,
        course: '',
        source: 'todo',
        due,
        missing: false,
        overdue,
        // A to-do due today ranks with Canvas work due around the end of today.
        score: overdue ? 8.9e6 : due !== null ? 8e6 - (due - now) / 60000 : 1000,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Timed (not all-day) events that overlap [from, to), sorted by start. */
function timedEvents(live: LiveState, from: number, to: number): CalendarEvent[] {
  const cal = live.calendar;
  if (!cal || cal.error) return [];
  return cal.events
    .filter((e) => !e.allDay && Date.parse(e.end) > from && Date.parse(e.start) < to)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Free time from now: busy until the current event ends, free until the next one starts. */
export function freeWindow(live: LiveState, now: number, f: DayFns): FreeWindow {
  const end = f.endOfDay(f.dayOf(now));
  const evs = timedEvents(live, now, end);
  let from = now;
  let busy: CalendarEvent | null = null;
  // Walk back-to-back or overlapping events to find when you're actually free.
  for (const e of evs) {
    const s = Date.parse(e.start);
    if (s <= from + 5 * 60000) {
      // Several things at once: name the class, not the meeting.
      if (s <= now && (!busy || (!classKind(busy, CLASS_DEFAULTS) && classKind(e, CLASS_DEFAULTS)))) busy = e;
      from = Math.max(from, Date.parse(e.end));
    } else {
      return { busy, from, until: s, next: e };
    }
  }
  return { busy, from, until: null, next: null };
}

/** Free gaps of at least `minMinutes` between `from` and `to`. */
export function freeGaps(live: LiveState, from: number, to: number, minMinutes = 20): [number, number][] {
  const out: [number, number][] = [];
  let cursor = from;
  for (const e of timedEvents(live, from, to)) {
    const s = Date.parse(e.start);
    if (s - cursor >= minMinutes * 60000) out.push([cursor, s]);
    cursor = Math.max(cursor, Date.parse(e.end));
  }
  if (to - cursor >= minMinutes * 60000) out.push([cursor, to]);
  return out;
}

const STOP = /^(the|a|an|my|on|for|to|of|and|with|assignment|due)$/;
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\bhomework\b/g, 'hw')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.test(w));
}

/** The work item a spoken name refers to ("hw 3", "the lab"), or null. */
export function matchWork(text: string, items: WorkItem[]): WorkItem | null {
  const said = words(text);
  if (!said.length) return null;
  let best: WorkItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    const have = words(it.title + ' ' + it.course);
    const hits = said.filter((w) => have.indexOf(w) >= 0).length;
    // Numbers must match ("hw 3" isn't "hw 4").
    const nums = said.filter((w) => /^\d+$/.test(w));
    if (nums.some((n) => have.indexOf(n) < 0)) continue;
    // A shared number alone isn't enough ("hw 4" isn't "Quiz 4").
    const named = said.filter((w) => !/^\d+$/.test(w));
    if (named.length && !named.some((w) => have.indexOf(w) >= 0)) continue;
    const score = hits / said.length;
    if (score > bestScore || (score === bestScore && best && it.score > best.score)) {
      best = it;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// ---------- study log ----------

export interface StudyEntry {
  day: string;
  task: string;
  course: string;
  minutes: number;
}

export interface FocusSession {
  task: string;
  course: string;
  /** The work item it's for, if any. */
  key: string;
  startedAt: number;
  /** The timer label it runs under, to tell if the timer was replaced. */
  label: string;
}

/** What the Study time / Up next layers need. */
export interface StudyState {
  active: FocusSession | null;
  /** Minutes per day, oldest first, ending today (7 days). */
  week: number[];
  /** YYYY-MM-DD of the last entry in `week`. */
  day: string;
  /** Today's minutes by task, most first. */
  todayTasks: { task: string; course: string; minutes: number }[];
  goalMinutes: number;
}

export function summarizeStudy(log: StudyEntry[], active: FocusSession | null, today: string, goalMinutes: number, prevDay: (day: string) => string): StudyState {
  const days: string[] = [today];
  for (let i = 0; i < 6; i++) days.unshift(prevDay(days[0]));
  const week = days.map((d) => log.filter((e) => e.day === d).reduce((n, e) => n + e.minutes, 0));
  const byTask: { [k: string]: { task: string; course: string; minutes: number } } = {};
  for (const e of log) {
    if (e.day !== today) continue;
    const k = e.task + '|' + e.course;
    byTask[k] = byTask[k] || { task: e.task, course: e.course, minutes: 0 };
    byTask[k].minutes += e.minutes;
  }
  const todayTasks = Object.keys(byTask)
    .map((k) => byTask[k])
    .sort((a, b) => b.minutes - a.minutes);
  return { active, week, day: today, todayTasks, goalMinutes };
}

export function speakMinutes(m: number): string {
  m = Math.round(m);
  if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + (r === 1 ? ' minute' : ' minutes') : '');
}
