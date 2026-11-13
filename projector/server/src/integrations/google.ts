// Google integration: one OAuth connection with Calendar (read) and Tasks
// (read/write). The refresh token stays in the Durable Object.
// Same shape as spotify.ts: status, connect/callback/disconnect, poll, control.

import { randomToken } from '../auth';
import type { Env } from '../env';
import type { CalendarEvent, CalendarState, Command, CommandResult, LiveState, TodoItem, TodoState } from '../../../shared/types';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/tasks'];
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_CALENDARS = 8;
const DEFAULT_TZ = 'America/Los_Angeles';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  scope: string;
  timeZone: string;
}

interface PendingAuth {
  state: string;
  returnTo: string;
  expires: number;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string;
  calendar: boolean;
  tasks: boolean;
  timeZone: string;
  error: string | null;
  redirectUri: string;
}

interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export type ControlResult = CommandResult & { todos?: TodoState };

export class Google {
  private env: Env;
  private store: Store;
  private tokens: Tokens | null = null;
  private loaded = false;
  lastError: string | null = null;

  constructor(env: Env, store: Store) {
    this.env = env;
    this.store = store;
  }

  private get authUrlBase() {
    return this.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
  }
  private get tokenUrl() {
    return this.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
  }
  private get apiUrl() {
    return (this.env.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/$/, '');
  }
  get redirectUri() {
    return this.env.API_ORIGIN.replace(/\/$/, '') + '/api/google/callback';
  }
  get configured() {
    return !!(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  private async load() {
    if (this.loaded) return;
    this.tokens = (await this.store.get<Tokens>('google:tokens')) || null;
    this.loaded = true;
  }

  async connected(): Promise<boolean> {
    await this.load();
    return !!this.tokens;
  }

  get timeZone(): string {
    return (this.tokens && this.tokens.timeZone) || DEFAULT_TZ;
  }

  private has(scope: 'calendar' | 'tasks'): boolean {
    if (!this.tokens) return false;
    return this.tokens.scope.indexOf(scope === 'calendar' ? 'auth/calendar' : 'auth/tasks') >= 0;
  }

  async status(): Promise<GoogleStatus> {
    await this.load();
    return {
      configured: this.configured,
      connected: !!this.tokens,
      email: this.tokens ? this.tokens.email : '',
      calendar: this.has('calendar'),
      tasks: this.has('tasks'),
      timeZone: this.timeZone,
      error: this.lastError,
      redirectUri: this.redirectUri,
    };
  }

  // ---------- OAuth ----------

  async authUrl(returnTo: string): Promise<string> {
    const state = randomToken(18);
    await this.store.put('google:pending', { state, returnTo, expires: Date.now() + STATE_TTL_MS } satisfies PendingAuth);
    const q = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID || '',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // offline + consent: always hand back a refresh token, even on reconnect.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return this.authUrlBase + '?' + q.toString();
  }

  async callback(url: URL): Promise<{ returnTo: string; ok: boolean; message: string }> {
    const pending = await this.store.get<PendingAuth>('google:pending');
    const state = url.searchParams.get('state');
    if (!pending || !state || pending.state !== state || pending.expires < Date.now()) {
      return { returnTo: pending ? pending.returnTo : '', ok: false, message: 'That Google sign-in link expired. Try connecting again.' };
    }
    await this.store.delete('google:pending');
    const err = url.searchParams.get('error');
    if (err) return { returnTo: pending.returnTo, ok: false, message: err === 'access_denied' ? 'Google access was not allowed.' : 'Google said: ' + err };
    try {
      const tok = await this.tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: this.redirectUri });
      if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
      const tokens: Tokens = {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + (tok.expires_in - 60) * 1000,
        email: emailFromIdToken(tok.id_token),
        scope: tok.scope || '',
        timeZone: DEFAULT_TZ,
      };
      this.tokens = tokens;
      // The primary calendar's time zone decides what "today" and "tomorrow" mean for to-dos.
      try {
        const r = await this.api('GET', '/calendar/v3/users/me/calendarList/primary');
        if (r.ok) {
          const j: any = await r.json();
          if (j.timeZone) tokens.timeZone = j.timeZone;
        }
      } catch (e) {}
      await this.store.put('google:tokens', tokens);
      this.lastError = null;
      const missing = [!this.has('calendar') && 'Calendar', !this.has('tasks') && 'Tasks'].filter(Boolean);
      return {
        returnTo: pending.returnTo,
        ok: true,
        message: missing.length
          ? 'Connected, but without ' + missing.join(' and ') + ' (a checkbox was left unticked). Connect again to add it.'
          : 'Connected' + (tokens.email ? ' as ' + tokens.email : ''),
      };
    } catch (e: any) {
      return { returnTo: pending.returnTo, ok: false, message: e.message || 'Could not finish connecting to Google.' };
    }
  }

  async disconnect() {
    const t = this.tokens;
    this.tokens = null;
    this.lastError = null;
    await this.store.delete('google:tokens');
    // Best effort: also revoke on Google's side so the app disappears from the account.
    if (t && !this.env.GOOGLE_TOKEN_URL) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.refreshToken), { method: 'POST' });
      } catch (e) {}
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<any> {
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.env.GOOGLE_CLIENT_ID || '', client_secret: this.env.GOOGLE_CLIENT_SECRET || '' }).toString(),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.error || 'Google token request failed (' + res.status + ')');
    return j;
  }

  private async accessToken(): Promise<string> {
    await this.load();
    if (!this.tokens) throw new Error('Google is not connected.');
    if (Date.now() < this.tokens.expiresAt) return this.tokens.accessToken;
    try {
      const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken });
      this.tokens = { ...this.tokens, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 };
      await this.store.put('google:tokens', this.tokens);
      return this.tokens.accessToken;
    } catch (e: any) {
      if (/invalid_grant/i.test(e.message || '')) {
        await this.disconnect();
        this.lastError =
          'Google sign-in expired. Connect again. If this happens every week, set the OAuth app to "In production" (see the Google setup doc).';
      }
      throw e;
    }
  }

  private async api(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    return fetch(this.apiUrl + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ---------- reading ----------

  /** Calendar events from yesterday to the day after tomorrow, across the calendars shown in Google Calendar. */
  async fetchCalendar(now: number): Promise<CalendarState | null> {
    await this.load();
    if (!this.tokens) return null;
    if (!this.has('calendar')) return { events: [], fetchedAt: now, error: 'Calendar access was not granted. Connect Google again.' };
    try {
      const list = await this.api('GET', '/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50');
      if (!list.ok) throw new Error('Google Calendar failed (' + list.status + ').');
      const lj: any = await list.json();
      const cals = (lj.items || []).filter((c: any) => c.selected || c.primary).slice(0, MAX_CALENDARS);
      const timeMin = new Date(now - 36 * 3600e3).toISOString();
      const timeMax = new Date(now + 60 * 3600e3).toISOString();
      const lists = await Promise.all(
        cals.map(async (c: any) => {
          const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
          const r = await this.api('GET', '/calendar/v3/calendars/' + encodeURIComponent(c.id) + '/events?' + q.toString());
          if (!r.ok) return [] as CalendarEvent[];
          const j: any = await r.json();
          return (j.items || [])
            .filter((e: any) => e.status !== 'cancelled' && !declined(e))
            .map(
              (e: any): CalendarEvent => ({
                id: c.id + ':' + e.id,
                title: e.summary || '(No title)',
                start: e.start.dateTime || e.start.date,
                end: e.end.dateTime || e.end.date,
                allDay: !e.start.dateTime,
                calendar: c.summaryOverride || c.summary || '',
                color: c.backgroundColor || '#4285f4',
                location: e.location || '',
              }),
            );
        }),
      );
      const events: CalendarEvent[] = ([] as CalendarEvent[]).concat(...lists);
      events.sort((a, b) => eventTime(a) - eventTime(b) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1));
      this.lastError = null;
      return { events: events.slice(0, 120), fetchedAt: now, error: null };
    } catch (e: any) {
      if (!this.tokens) return null;
      this.lastError = e.message || 'Could not reach Google Calendar.';
      return { events: [], fetchedAt: now, error: this.lastError };
    }
  }

  /** Open tasks from the default list ("My Tasks"). */
  async fetchTodos(now: number): Promise<TodoState | null> {
    await this.load();
    if (!this.tokens) return null;
    if (!this.has('tasks')) return { listName: '', items: [], fetchedAt: now, error: 'Tasks access was not granted. Connect Google again.' };
    try {
      const [lr, tr] = await Promise.all([
        this.api('GET', '/tasks/v1/users/@me/lists/%40default'),
        this.api('GET', '/tasks/v1/lists/%40default/tasks?showCompleted=false&showHidden=false&maxResults=100'),
      ]);
      if (!tr.ok) throw new Error('Google Tasks failed (' + tr.status + ').');
      const lj: any = lr.ok ? await lr.json() : {};
      const tj: any = await tr.json();
      const items: TodoItem[] = (tj.items || [])
        .filter((t: any) => t.status !== 'completed' && (t.title || '').trim())
        .sort((a: any, b: any) => (a.position || '').localeCompare(b.position || ''))
        .map((t: any) => ({ id: t.id, title: t.title.trim(), due: t.due ? String(t.due).slice(0, 10) : null, notes: t.notes || '' }));
      this.lastError = null;
      return { listName: lj.title || 'My Tasks', items, fetchedAt: now, error: null };
    } catch (e: any) {
      if (!this.tokens) return null;
      this.lastError = e.message || 'Could not reach Google Tasks.';
      return { listName: '', items: [], fetchedAt: now, error: this.lastError };
    }
  }

  // ---------- commands ----------

  async control(cmd: Command, live: LiveState, now: number): Promise<ControlResult> {
    if (!this.configured) return { ok: false, reply: "Google isn't set up on the server yet." };
    if (!(await this.connected())) return { ok: false, reply: "Google isn't connected. Connect it from the wall editor." };
    const p = cmd.payload || {};
    const tz = this.timeZone;
    try {
      switch (cmd.type) {
        case 'todo.add': {
          const title = String(p.text || '').trim().slice(0, 200);
          if (!title) return { ok: false, reply: 'What should I add?' };
          const due = p.due ? resolveDue(String(p.due), now, tz) : null;
          const r = await this.api('POST', '/tasks/v1/lists/%40default/tasks', due ? { title, due: due + 'T00:00:00.000Z' } : { title });
          if (!r.ok) return { ok: false, reply: 'Google Tasks said no (' + r.status + ').' };
          const t: any = await r.json();
          const todos = live.todos;
          const item: TodoItem = { id: t.id, title, due, notes: '' };
          return {
            ok: true,
            reply: 'Added ' + quote(title) + (due ? ' for ' + dueWords(due, now, tz) : '') + '.',
            todos: todos ? { ...todos, items: [item, ...todos.items] } : undefined,
          };
        }
        case 'todo.complete': {
          const todos = live.todos && !live.todos.error ? live.todos : await this.fetchTodos(now);
          const items = todos ? todos.items : [];
          const match = p.id ? items.find((t) => t.id === p.id) || null : bestMatch(String(p.text || ''), items);
          if (!match) return { ok: false, reply: 'I couldn\'t find ' + quote(String(p.text || p.id || '')) + ' on your list.' };
          const r = await this.api('PATCH', '/tasks/v1/lists/%40default/tasks/' + encodeURIComponent(match.id), { status: 'completed' });
          if (!r.ok) return { ok: false, reply: 'Google Tasks said no (' + r.status + ').' };
          return {
            ok: true,
            reply: 'Checked off ' + quote(match.title) + '.',
            todos: todos ? { ...todos, items: todos.items.filter((t) => t.id !== match.id) } : undefined,
          };
        }
        case 'todo.list': {
          const todos = live.todos || (await this.fetchTodos(now));
          const items = todos ? todos.items : [];
          if (!items.length) return { ok: true, reply: 'Your list is empty.' };
          const names = items.slice(0, 5).map((t) => t.title);
          const more = items.length > 5 ? ', and ' + (items.length - 5) + ' more' : '';
          return { ok: true, reply: 'You have ' + plural(items.length, 'thing') + ': ' + joinWords(names) + more + '.' };
        }
        case 'calendar.today':
        case 'calendar.next': {
          const cal = live.calendar && !live.calendar.error ? live.calendar : await this.fetchCalendar(now);
          const events = cal ? cal.events : [];
          const today = dateInTz(now, tz);
          if (cmd.type === 'calendar.next') {
            const next = events.find((e) => !e.allDay && Date.parse(e.start) > now);
            if (!next) return { ok: true, reply: 'Nothing else coming up on your calendar.' };
            const day = dateInTz(Date.parse(next.start), tz);
            return { ok: true, reply: 'Next: ' + next.title + (day === today ? ' at ' : ' ' + dueWords(day, now, tz) + ' at ') + timeInTz(Date.parse(next.start), tz) + '.' };
          }
          const todays = events.filter((e) => (e.allDay ? e.start <= today && today < e.end : dateInTz(Date.parse(e.start), tz) === today));
          if (!todays.length) return { ok: true, reply: 'Nothing on your calendar today.' };
          const parts = todays.slice(0, 6).map((e) => (e.allDay ? e.title + ' all day' : e.title + ' at ' + timeInTz(Date.parse(e.start), tz)));
          return { ok: true, reply: 'Today: ' + joinWords(parts) + (todays.length > 6 ? ', and more' : '') + '.' };
        }
      }
    } catch (e: any) {
      return { ok: false, reply: e.message || 'Could not reach Google.' };
    }
    return { ok: false, reply: "I don't know the command " + cmd.type + '.' };
  }
}

// ---------- helpers (exported for tests) ----------

function declined(e: any): boolean {
  return (e.attendees || []).some((a: any) => a.self && a.responseStatus === 'declined');
}

function eventTime(e: CalendarEvent): number {
  return e.allDay ? Date.parse(e.start + 'T00:00:00Z') : Date.parse(e.start);
}

function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return '';
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '==='.slice((part.length + 3) % 4))).email || '';
  } catch (e) {
    return '';
  }
}

function quote(s: string): string {
  return '“' + s + '”';
}

function plural(n: number, w: string): string {
  return n + ' ' + w + (n === 1 ? '' : 's');
}

function joinWords(a: string[]): string {
  return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/** YYYY-MM-DD for an instant, in a time zone. */
export function dateInTz(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return parts.slice(0, 10);
}

function timeInTz(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(':00', '');
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "today", "tomorrow", "friday", "next friday", or an ISO date → YYYY-MM-DD in the time zone. */
export function resolveDue(due: string, now: number, tz: string): string | null {
  const d = due.toLowerCase().trim();
  const today = dateInTz(now, tz);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  if (d === 'today' || d === 'tonight') return today;
  if (d === 'tomorrow') return addDays(today, 1);
  const m = /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(d);
  if (m) {
    const [y, mo, da] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
    // "friday" (or "next friday") means the coming Friday; said on a Friday, a week from today.
    let ahead = (WEEKDAYS.indexOf(m[2]) - dow + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(today, ahead);
  }
  return null;
}

function dueWords(date: string, now: number, tz: string): string {
  const today = dateInTz(now, tz);
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const diff = Math.round((dt.getTime() - Date.parse(today + 'T00:00:00Z')) / 86400000);
  const name = WEEKDAYS[dt.getUTCDay()];
  return diff > 0 && diff < 7 ? name[0].toUpperCase() + name.slice(1) : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(dt);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|my|to|for)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fuzzy match spoken text to a task: exact, then prefix/containment, then word overlap. */
export function bestMatch(text: string, items: TodoItem[]): TodoItem | null {
  const q = norm(text);
  if (!q) return null;
  let best: TodoItem | null = null;
  let bestScore = 0;
  const qWords = q.split(' ');
  for (const it of items) {
    const t = norm(it.title);
    let score = 0;
    if (t === q) score = 100;
    else if (t.indexOf(q) === 0 || q.indexOf(t) === 0) score = 80;
    else if (t.indexOf(q) >= 0 || q.indexOf(t) >= 0) score = 70;
    else {
      const tWords = t.split(' ');
      let shared = 0;
      for (const w of qWords) if (tWords.indexOf(w) >= 0 || tWords.some((tw) => tw.length > 3 && (tw.indexOf(w) === 0 || w.indexOf(tw) === 0))) shared++;
      const overlap = shared / Math.max(qWords.length, tWords.length);
      if (overlap >= 0.5) score = 40 + overlap * 20;
    }
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}
