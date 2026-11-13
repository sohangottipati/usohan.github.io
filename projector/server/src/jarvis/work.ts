// Spoken answers for getting work done: what to work on next, when you're
// free, and how much you've studied. Pure functions over the wall's state, so
// they're instant, free and testable.

import { freeGaps, freeWindow, speakMinutes, workItems, type DayFns, type StudyEntry, type WorkItem } from '../../../shared/planner';
import type { LiveState } from '../../../shared/types';
import { clockTime, localDate, zonedTime } from './time';

export function dayFns(tz: string): DayFns {
  return {
    dayOf: (ms) => localDate(ms, tz),
    endOfDay: (day) => {
      const [y, m, d] = day.split('-').map(Number);
      return zonedTime(y, m, d, 23, 59, tz) + 59999;
    },
  };
}

export function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function at(ms: number, tz: string): string {
  return clockTime(ms, tz);
}

/** "today at 6 PM", "tomorrow at 9 AM", "Monday" */
export function whenDue(ms: number, now: number, tz: string): string {
  const f = dayFns(tz);
  const d = f.dayOf(ms);
  const today = f.dayOf(now);
  if (d === today) return 'at ' + at(ms, tz);
  const tomorrow = f.dayOf(now + 86400000);
  if (d === tomorrow) return 'tomorrow at ' + at(ms, tz);
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(ms));
}

function describe(it: WorkItem, now: number, tz: string, todoDayOnly = true): string {
  let s = it.title + (it.course ? ' for ' + it.course : '');
  if (it.missing) s += ", which is missing";
  else if (it.overdue) s += ', which is overdue';
  else if (it.due !== null) s += it.source === 'todo' && todoDayOnly ? (dayFns(tz).dayOf(it.due) === dayFns(tz).dayOf(now) ? ', due today' : ', due ' + whenDue(it.due, now, tz).replace(/ at .*/, '')) : ', due ' + whenDue(it.due, now, tz);
  return s;
}

/** "You're free for 50 minutes, until MATH 10A. Start with HW 3 for CS 100, due at 6 PM. Then Lab 2 and Quiz 4." */
export function whatNext(live: LiveState, now: number, tz: string): string {
  const f = dayFns(tz);
  const items = workItems(live, now, f);
  const w = freeWindow(live, now, f);
  let lead = '';
  if (w.busy) lead = "You're in " + w.busy.title + ' until ' + at(w.from, tz) + '. After that, ';
  else if (w.until !== null && w.next) {
    const mins = (w.until - now) / 60000;
    lead = mins < 15 ? w.next.title + ' starts in ' + speakMinutes(mins) + '. After it, ' : "You're free for " + speakMinutes(mins) + ', until ' + w.next.title + '. ';
  } else if (live.calendar) lead = 'Nothing else on your calendar today. ';
  const canvasNote = !live.canvas ? '' : live.canvas.error ? " (I can't reach Canvas right now.)" : '';
  if (!items.length) return lead + (lead.endsWith(', ') ? 'n' : 'N') + 'othing open on Canvas or your list. Good time to get ahead.' + canvasNote;
  const start = lead.endsWith(', ') ? 'start with ' : 'Start with ';
  let out = lead + start + describe(items[0], now, tz) + '.';
  const rest = items.slice(1, 3).map((i) => i.title + (i.course && i.course !== items[0].course ? ' for ' + i.course : ''));
  if (rest.length) out += ' Then ' + rest.join(' and ') + '.';
  return out + canvasNote;
}

/** "You're free now until 2 PM, from 3:20 to 5 PM, and after 6 PM." */
export function freeTime(live: LiveState, now: number, tz: string, which: 'today' | 'tomorrow'): string {
  if (!live.calendar) return "Your calendar isn't connected, so I can't tell.";
  if (live.calendar.error) return "I couldn't load your calendar just now.";
  const f = dayFns(tz);
  const day = which === 'today' ? f.dayOf(now) : f.dayOf(now + 86400000);
  const [y, m, d] = day.split('-').map(Number);
  const dayStart = zonedTime(y, m, d, 8, 0, tz);
  const dayEnd = zonedTime(y, m, d, 23, 0, tz);
  const from = which === 'today' ? Math.max(now, dayStart) : dayStart;
  if (from >= dayEnd) return "The day's basically over. Tomorrow, then.";
  const gaps = freeGaps(live, from, dayEnd, 20);
  const when = which === 'today' ? '' : ' tomorrow';
  if (!gaps.length) return "You're booked solid" + when + '.';
  const parts = gaps.slice(0, 4).map(([a, b]) => {
    if (a <= now + 60000) return b >= dayEnd ? 'free for the rest of the day' : 'free now until ' + at(b, tz);
    if (b >= dayEnd) return 'after ' + at(a, tz);
    return 'from ' + at(a, tz) + ' to ' + at(b, tz);
  });
  if (gaps.length === 1 && parts[0].indexOf('free') === 0) return "You're " + parts[0] + when + '.';
  const first = parts[0].indexOf('free') === 0 ? parts.shift()! : 'free ' + parts.shift()!;
  const joined = parts.length ? ', ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] : 'and ' + parts[0]) : '';
  const total = gaps.reduce((n, [a, b]) => n + (b - a), 0) / 60000;
  return "You're " + first + joined + when + '. About ' + speakMinutes(Math.round(total / 15) * 15) + ' in all.';
}

/** "One hour twenty today: 50 minutes on HW 3 and 30 on Lab 2. 4 hours this week." */
export function studyStats(log: StudyEntry[], extraToday: number, now: number, tz: string, period: 'today' | 'week', goal: number): string {
  const f = dayFns(tz);
  const today = f.dayOf(now);
  const days = [today];
  for (let i = 0; i < 6; i++) days.unshift(prevDay(days[0]));
  const todayEntries = log.filter((e) => e.day === today);
  const todayMins = todayEntries.reduce((n, e) => n + e.minutes, 0) + extraToday;
  const weekMins = log.filter((e) => days.indexOf(e.day) >= 0).reduce((n, e) => n + e.minutes, 0) + extraToday;
  if (period === 'week') {
    if (!weekMins) return "No work sessions logged this week yet. Say \"start working on\" something to begin one.";
    const best = days.map((d) => [d, log.filter((e) => e.day === d).reduce((n, e) => n + e.minutes, 0)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
    const bestName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(best[0] + 'T12:00:00Z'));
    return speakMinutes(weekMins) + ' in the last seven days.' + (best[1] ? ' Your best day was ' + bestName + ', with ' + speakMinutes(best[1]) + '.' : '');
  }
  if (!todayMins) return "Nothing logged today yet. Say \"start working on\" something and I'll track it.";
  const byTask: { [k: string]: number } = {};
  for (const e of todayEntries) byTask[e.task] = (byTask[e.task] || 0) + e.minutes;
  const top = Object.keys(byTask)
    .sort((a, b) => byTask[b] - byTask[a])
    .slice(0, 3)
    .map((k) => speakMinutes(byTask[k]) + ' on ' + k);
  let out = speakMinutes(todayMins) + ' today' + (top.length ? ': ' + top.join(', ') : '') + '.';
  if (goal > 0) out += todayMins >= goal ? " That's your " + speakMinutes(goal) + ' goal done.' : ' ' + speakMinutes(goal - todayMins) + ' to your goal.';
  return out;
}
