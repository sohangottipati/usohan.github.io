// Canvas LMS (read-only): assignments, quizzes and discussions from the
// planner, with due dates and submitted / missing status. Uses a personal
// access token the user creates in Canvas; it's kept in the Durable Object and
// never sent back to the browser.

import type { CanvasItem, CanvasState, Command, CommandResult } from '../../../shared/types';

interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface Conn {
  baseUrl: string;
  token: string;
  user: string;
}

export interface CanvasStatus {
  connected: boolean;
  baseUrl: string;
  user: string;
  error: string | null;
}

/** "elearn.ucr.edu", "https://canvas.school.edu/" → "https://elearn.ucr.edu" */
export function normalizeBaseUrl(input: string): string | null {
  let s = (input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
    return u.origin;
  } catch (e) {
    return null;
  }
}

export class Canvas {
  private store: Store;
  private conn: Conn | null = null;
  private loaded = false;
  lastError: string | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  private async load() {
    if (this.loaded) return;
    this.conn = (await this.store.get<Conn>('canvas:conn')) || null;
    this.loaded = true;
  }

  async connected(): Promise<boolean> {
    await this.load();
    return !!this.conn;
  }

  async status(): Promise<CanvasStatus> {
    await this.load();
    return { connected: !!this.conn, baseUrl: this.conn ? this.conn.baseUrl : '', user: this.conn ? this.conn.user : '', error: this.lastError };
  }

  private async get(path: string, conn = this.conn): Promise<Response> {
    if (!conn) throw new Error('Canvas is not connected.');
    return fetch(conn.baseUrl + path, {
      headers: {
        Authorization: 'Bearer ' + conn.token,
        Accept: 'application/json+canvas-string-ids, application/json',
        // Some school firewalls refuse requests that don't say what they are.
        'User-Agent': 'ProjectorWall/1.0 (+https://sohan.website/projector/privacy)',
      },
      redirect: 'manual',
    });
  }

  /** Checks the URL and token against Canvas, then saves them. */
  async connect(baseUrlInput: string, token: string): Promise<{ ok: boolean; message: string }> {
    const baseUrl = normalizeBaseUrl(baseUrlInput);
    if (!baseUrl) return { ok: false, message: 'That doesn’t look like a Canvas address (e.g. elearn.ucr.edu).' };
    const t = (token || '').trim();
    if (t.length < 20) return { ok: false, message: 'Paste the whole access token from Canvas.' };
    const trial: Conn = { baseUrl, token: t, user: '' };
    let r: Response;
    try {
      r = await this.get('/api/v1/users/self', trial);
    } catch (e) {
      return { ok: false, message: 'Couldn’t reach ' + baseUrl + '.' };
    }
    if (r.status >= 300 && r.status < 400) {
      const to = r.headers.get('Location') || '';
      let host = '';
      try {
        host = new URL(to, baseUrl).host;
      } catch (e) {}
      return { ok: false, message: 'That address redirects' + (host ? ' to ' + host : '') + '. Use the address your browser shows when you’re in Canvas' + (host ? ' (try ' + host + ')' : '') + '.' };
    }
    if (r.status === 401) return { ok: false, message: 'Canvas rejected that token. Make a new one and paste it again.' };
    if (!r.ok) return { ok: false, message: 'Canvas answered ' + r.status + ': ' + (await canvasReason(r)) };
    const me: any = await r.json().catch(() => ({}));
    trial.user = me.short_name || me.name || '';
    this.conn = trial;
    this.lastError = null;
    await this.store.put('canvas:conn', trial);
    return { ok: true, message: 'Connected' + (trial.user ? ' as ' + trial.user : '') };
  }

  async disconnect() {
    this.conn = null;
    this.lastError = null;
    await this.store.delete('canvas:conn');
  }

  /** Planner items from a week ago to three weeks ahead. Never throws. */
  async fetch(now: number): Promise<CanvasState | null> {
    await this.load();
    if (!this.conn) return null;
    try {
      const start = new Date(now - 7 * 86400000).toISOString();
      const end = new Date(now + 21 * 86400000).toISOString();
      const r = await this.get('/api/v1/planner/items?per_page=100&start_date=' + encodeURIComponent(start) + '&end_date=' + encodeURIComponent(end));
      if (r.status === 401) {
        this.lastError = 'Canvas token expired or was revoked. Connect Canvas again.';
        return { items: [], fetchedAt: now, error: this.lastError };
      }
      if (!r.ok) throw new Error('Canvas planner failed (' + r.status + '): ' + (await canvasReason(r)));
      const list: any[] = await r.json();
      const items: CanvasItem[] = [];
      for (const it of list) {
        const type = it.plannable_type || '';
        if (['assignment', 'quiz', 'discussion_topic', 'sub_assignment'].indexOf(type) < 0) continue;
        const p = it.plannable || {};
        const sub = it.submissions || {};
        items.push({
          id: String(it.plannable_id || p.id || it.html_url),
          title: String(p.title || p.name || 'Untitled').slice(0, 140),
          course: String(it.context_name || '').slice(0, 60),
          due: p.due_at || it.plannable_date || null,
          type: type === 'discussion_topic' ? 'discussion' : type === 'sub_assignment' ? 'assignment' : type,
          submitted: !!(sub.submitted || sub.graded || sub.excused),
          missing: !!sub.missing,
          url: it.html_url ? this.conn.baseUrl + it.html_url : '',
        });
      }
      items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      this.lastError = null;
      return { items: items.slice(0, 80), fetchedAt: now, error: null };
    } catch (e: any) {
      this.lastError = e.message || 'Could not reach Canvas.';
      return { items: [], fetchedAt: now, error: this.lastError };
    }
  }

  async control(cmd: Command, state: CanvasState | null | undefined, now: number, tz: string): Promise<CommandResult> {
    if (!(await this.connected())) return { ok: false, reply: "Canvas isn't connected. Add it in the wall editor's Integrations panel." };
    const s = state && !state.error ? state : await this.fetch(now);
    if (!s) return { ok: false, reply: "Canvas isn't connected." };
    if (s.error) return { ok: false, reply: s.error };
    const days = cmd.payload && typeof cmd.payload.days === 'number' ? Math.max(1, Math.min(21, cmd.payload.days)) : 7;
    return { ok: true, reply: dueSummary(s.items, now, tz, days) };
  }
}

/** Why Canvas said no, in words: its own JSON error, or a hint about firewalls / API restrictions. */
async function canvasReason(r: Response): Promise<string> {
  const type = r.headers.get('Content-Type') || '';
  const text = await r.text().catch(() => '');
  if (type.indexOf('json') >= 0) {
    try {
      const j = JSON.parse(text);
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || j.message || j.error;
      if (msg) return String(msg).slice(0, 160) + (r.status === 403 ? ' (your school may not allow personal API tokens).' : '');
    } catch (e) {}
  }
  if (r.status === 403) {
    return /<html/i.test(text)
      ? 'a firewall in front of Canvas blocked the request. Tell Claude: "Canvas firewall 403".'
      : 'Canvas refused the request. Your school may not allow personal API tokens.';
  }
  return 'check the address.';
}

function dayName(iso: string, now: number, tz: string): string {
  const fmt = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const d = fmt(Date.parse(iso));
  if (d === fmt(now)) return 'today';
  if (d === fmt(now + 86400000)) return 'tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(Date.parse(iso)));
}

/** "3 things due this week: CS 100 HW 3 tomorrow, … Missing: Lab 2." */
export function dueSummary(items: CanvasItem[], now: number, tz: string, days = 7): string {
  const until = now + days * 86400000;
  const open = items.filter((i) => !i.submitted && i.due && Date.parse(i.due) >= now && Date.parse(i.due) <= until);
  const missing = items.filter((i) => i.missing && !i.submitted);
  const name = (i: CanvasItem) => i.title + (i.course ? ' for ' + i.course.replace(/\s*[-–:].*$/, '') : '');
  let out = '';
  if (!open.length) out = 'Nothing due in the next ' + (days === 7 ? 'week' : days + ' days') + '.';
  else {
    const list = open.slice(0, 5).map((i) => name(i) + ' ' + dayName(i.due!, now, tz));
    out = open.length + (open.length === 1 ? ' thing' : ' things') + ' due ' + (days === 7 ? 'this week' : 'soon') + ': ' + list.join(', ') + (open.length > 5 ? ', and more' : '') + '.';
  }
  if (missing.length) out += ' Missing: ' + missing.slice(0, 3).map((i) => i.title).join(', ') + (missing.length > 3 ? ', and ' + (missing.length - 3) + ' more' : '') + '.';
  return out;
}
