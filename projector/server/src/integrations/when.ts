// Resolves spoken dates and times ("next tuesday", "march 3", "3", "3:30pm",
// "noon", "6 to 8") into concrete local times for a calendar event.

import { resolveDue } from './google';

export interface WhenInput {
  /** today | tomorrow | friday | next monday | YYYY-MM-DD | "march 3" | "3/14" */
  date?: string;
  /** "15:00", "3pm", "3", "3:30", "noon" */
  time?: string;
  endTime?: string;
  durationMinutes?: number;
  allDay?: boolean;
  /** A full local start "2026-11-18T15:00" (models often send this). */
  start?: string;
  end?: string;
}

export interface When {
  allDay: boolean;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD, exclusive (all-day) or the end's date */
  endDate: string;
  /** "HH:MM" local, timed events only */
  startTime: string | null;
  endTime: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Minutes after midnight. A bare hour is guessed the way people talk about
 * plans: 1–7 → afternoon/evening, 8–11 → morning, 12 → noon.
 */
export function parseClock(s: string | undefined | null, after?: number): number | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/\./g, '').trim();
  if (t === 'noon' || t === 'midday') return 12 * 60;
  if (t === 'midnight') return 0;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  const ap = m[3];
  if (ap) {
    if (ap[0] === 'p' && h < 12) h += 12;
    if (ap[0] === 'a' && h === 12) h = 0;
  } else if (h >= 1 && h <= 11) {
    if (after !== undefined) {
      // An end time without am/pm: the first matching time after the start.
      if (h * 60 + min <= after) h += 12;
    } else if (h <= 7) h += 12;
  }
  return h * 60 + min;
}

/** "march 3", "mar 3rd", "3/14", "14 march" → next such date (this year, or next if it has passed). */
function monthDay(s: string, today: string): string | null {
  const t = s.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/,/g, '').trim();
  let mo = -1;
  let day = -1;
  let m = /^([a-z]{3,})\.?\s+(\d{1,2})$/.exec(t);
  if (m) {
    mo = MONTHS.indexOf(m[1].slice(0, 3));
    day = +m[2];
  } else if ((m = /^(\d{1,2})\s+([a-z]{3,})$/.exec(t))) {
    mo = MONTHS.indexOf(m[2].slice(0, 3));
    day = +m[1];
  } else if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) {
    mo = +m[1] - 1;
    day = +m[2];
  }
  if (mo < 0 || mo > 11 || day < 1 || day > 31) return null;
  const year = +today.slice(0, 4);
  let d = year + '-' + pad(mo + 1) + '-' + pad(day);
  if (d < today) d = year + 1 + '-' + pad(mo + 1) + '-' + pad(day);
  return d;
}

export function resolveDate(s: string | undefined, now: number, tz: string): string | null {
  const today = resolveDue('today', now, tz)!;
  if (!s || !s.trim()) return today;
  const t = s.toLowerCase().trim().replace(/^(on|this)\s+/, '');
  return resolveDue(t, now, tz) || monthDay(t, today);
}

/** Turns the spoken pieces into a concrete event time, or an error to read back. */
export function resolveWhen(p: WhenInput, now: number, tz: string): When | { error: string } {
  // A model may send start/end directly.
  if (p.start && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(p.start)) {
    const date = p.start.slice(0, 10);
    if (p.start.length < 16 || p.allDay) {
      const endDate = p.end && /^\d{4}-\d{2}-\d{2}/.test(p.end) && p.end.slice(0, 10) > date ? p.end.slice(0, 10) : addDays(date, 1);
      return { allDay: true, date, endDate, startTime: null, endTime: null };
    }
    const startTime = p.start.slice(11, 16);
    let endDate = date;
    let endTime: string;
    if (p.end && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.end)) {
      endDate = p.end.slice(0, 10);
      endTime = p.end.slice(11, 16);
    } else {
      const startMin = +startTime.slice(0, 2) * 60 + +startTime.slice(3, 5);
      const endMin = startMin + (p.durationMinutes && p.durationMinutes > 0 ? p.durationMinutes : 60);
      endDate = addDays(date, Math.floor(endMin / 1440));
      endTime = pad(Math.floor((endMin % 1440) / 60)) + ':' + pad(endMin % 60);
    }
    return { allDay: false, date, endDate, startTime, endTime };
  }

  const date = resolveDate(p.date, now, tz);
  if (!date) return { error: "I couldn't work out the date " + (p.date || '') + '.' };
  const startMin = parseClock(p.time);
  if (p.allDay || startMin === null) {
    if (p.time && startMin === null) return { error: "I couldn't work out the time " + p.time + '.' };
    return { allDay: true, date, endDate: addDays(date, 1), startTime: null, endTime: null };
  }
  let endMin = parseClock(p.endTime, startMin);
  if (endMin === null) endMin = startMin + (p.durationMinutes && p.durationMinutes > 0 ? Math.min(p.durationMinutes, 24 * 60) : 60);
  if (endMin <= startMin) endMin += 24 * 60; // e.g. 10pm to 1am
  const endDate = addDays(date, Math.floor(endMin / 1440));
  const e = endMin % 1440;
  return {
    allDay: false,
    date,
    endDate,
    startTime: pad(Math.floor(startMin / 60)) + ':' + pad(startMin % 60),
    endTime: pad(Math.floor(e / 60)) + ':' + pad(e % 60),
  };
}
