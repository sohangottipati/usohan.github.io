// The Wall Durable Object: single source of truth for the project and live
// state, and the hub every editor/display WebSocket connects to. Uses the
// WebSocket Hibernation API so idle displays cost nothing.

import { DurableObject } from 'cloudflare:workers';
import {
  defaultLiveState,
  defaultProject,
  type ClientMessage,
  type Command,
  type CommandLogEntry,
  type CommandResult,
  type LiveState,
  type Project,
  type ServerMessage,
} from '../../shared/types';
import { validateProject } from '../../shared/validate';
import { createSession, isEditor, randomToken, safeEqual, sessionCookie } from './auth';
import { advanceTimer, runCommand } from './commands/handle';
import { parseTextDetailed } from './commands/parseText';
import { defaultJarvisSettings, sanitizeJarvisSettings, type JarvisSettings } from '../../shared/jarvis';
import { brainReady, think } from './jarvis/brain';
import { composeBriefing } from './jarvis/briefing';
import { buildContext } from './jarvis/context';
import type { Exchange } from './jarvis/prompt';
import { localDate, nextDailyTime } from './jarvis/time';
import { synthesize } from './jarvis/voice';
import { isLocalDev, isOriginAllowed, originOk, type Env } from './env';
import { Google } from './integrations/google';
import { Spotify, spotifyChanged } from './integrations/spotify';

type Role = 'editor' | 'display';

const PERSIST_INTERVAL_MS = 1000;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const LOGIN_MAX_FAILURES = 5;
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// SQLite-backed Durable Object values are capped at 2 MB.
const MAX_MEDIA_BYTES = 1.9 * 1024 * 1024;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const COMMAND_LOG_SIZE = 50;
const COMMAND_RATE = 30; // per minute, per wall
const TOKEN_FAILURE_LIMIT = 10; // wrong tokens per minute before refusing everything for a minute
const MAX_COMMAND_TEXT = 500;
// Spotify polling while any screen is connected: often while music plays, less when it doesn't.
const SPOTIFY_POLL_PLAYING_MS = 3000;
const SPOTIFY_POLL_IDLE_MS = 10000;
const SPOTIFY_POLL_QUIET_MS = 30000;
const SPOTIFY_QUIET_AFTER_MS = 10 * 60 * 1000;
// Google: to-dos every minute, calendar every 5 minutes, while a screen is connected.
const TODOS_POLL_MS = 60 * 1000;
const CALENDAR_POLL_MS = 5 * 60 * 1000;
// Jarvis: keep a few recent exchanges for follow-ups; hold a missed briefing until a display connects.
const MEMORY_SIZE = 6;
const BRIEFING_HOLD_MS = 4 * 3600 * 1000;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export class Wall extends DurableObject<Env> {
  private project: Project = defaultProject();
  private live: LiveState = defaultLiveState();
  private rev = 0;
  private displayKey = '';
  private lastPersist = 0;
  private dirty = false;
  private loginFailures = 0;
  private loginLockedUntil = 0;
  private commandToken = '';
  private commandLog: CommandLogEntry[] = [];
  private commandTimes: number[] = [];
  private tokenFailures: number[] = [];
  private spotify: Spotify;
  private nextSpotifyPoll = Infinity;
  private lastMusicAt = 0;
  private google: Google;
  private nextGooglePoll = Infinity;
  private lastCalendarPoll = 0;
  private jarvis: JarvisSettings = defaultJarvisSettings();
  private memory: Exchange[] = [];
  private lastBrainError: string | null = null;
  private lastBrainMs = 0;
  private announcedTimerEnd = 0;
  private announcedEvents: string[] = [];
  private lastBriefingDate = '';
  private briefingPendingUntil = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.spotify = new Spotify(env, ctx.storage);
    this.google = new Google(env, ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['project', 'live', 'rev', 'displayKey', 'commandToken', 'commandLog', 'jarvis', 'jarvis:state']);
      this.jarvis = sanitizeJarvisSettings(stored.get('jarvis'));
      const js = (stored.get('jarvis:state') as any) || {};
      this.announcedTimerEnd = js.announcedTimerEnd || 0;
      this.announcedEvents = js.announcedEvents || [];
      this.lastBriefingDate = js.lastBriefingDate || '';
      this.briefingPendingUntil = js.briefingPendingUntil || 0;
      const p = stored.get('project');
      if (p && validateProject(p) === null) this.project = p as Project;
      const l = stored.get('live') as LiveState | undefined;
      if (l) this.live = { ...defaultLiveState(), ...l };
      this.rev = (stored.get('rev') as number) || 0;
      this.displayKey = (stored.get('displayKey') as string) || env.DISPLAY_KEY || '';
      if (!this.displayKey) {
        this.displayKey = randomToken(18);
        await ctx.storage.put('displayKey', this.displayKey);
      }
      this.commandToken = (stored.get('commandToken') as string) || env.COMMAND_TOKEN || '';
      if (!this.commandToken) {
        this.commandToken = randomToken(24);
        await ctx.storage.put('commandToken', this.commandToken);
      }
      this.commandLog = (stored.get('commandLog') as CommandLogEntry[]) || [];
    });
  }

  // ---------- HTTP ----------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/ws') return this.handleSocket(req, url);

    // Uploaded images are public (unguessable ids) so the projector can load them in <img>.
    const media = /^\/api\/media\/([A-Za-z0-9_-]{8,40})$/.exec(path);
    if (media && req.method === 'GET') return this.getMedia(media[1]);

    // Voice assistants and scripts: bearer token, no cookie, no CORS.
    if (path === '/api/command' && req.method === 'POST') return this.commandApi(req);

    // Spotify sends the browser back here after login (no cookie needed: the state value is the proof).
    if (path === '/api/spotify/callback' && req.method === 'GET') return this.spotifyCallback(url);
    if (path === '/api/google/callback' && req.method === 'GET') return this.googleCallback(url);
    // The spec's direct Spotify routes accept the command token as well as the editor cookie.
    if (path.indexOf('/api/spotify/') === 0 && /^Bearer\s/i.test(req.headers.get('Authorization') || '')) {
      if (!this.bearerOk(req)) {
        await req.text();
        return json({ ok: false, reply: 'Wrong or missing command token.' }, 401);
      }
      return this.spotifyRoute(req, path);
    }

    if (path === '/api/login' && req.method === 'POST') return this.login(req);
    if (path === '/api/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, isLocalDev(this.env)) });
    }

    const editor = await isEditor(req, this.env.SESSION_SECRET);
    if (path === '/api/me') return json({ authed: editor });
    if (!editor) return json({ ok: false, error: 'Not logged in' }, 401);
    // Cookie is SameSite=None, so reject state changes from foreign origins (CSRF).
    if (req.method !== 'GET' && !this.originAllowed(req)) return json({ ok: false, error: 'Bad origin' }, 403);

    if (path === '/api/display-key' && req.method === 'GET') return json({ key: this.displayKey });
    if (path === '/api/display-key/rotate' && req.method === 'POST') {
      this.displayKey = randomToken(18);
      await this.ctx.storage.put('displayKey', this.displayKey);
      for (const ws of this.ctx.getWebSockets('display')) {
        this.sendTo(ws, { t: 'error', message: 'Display key was rotated. Open the new display link.' });
        ws.close(4001, 'key rotated');
      }
      return json({ key: this.displayKey });
    }
    if (path === '/api/project' && req.method === 'GET') return json(this.project);
    if (path === '/api/command-token' && req.method === 'GET') return json({ token: this.commandToken });
    if (path === '/api/command-token/rotate' && req.method === 'POST') {
      this.commandToken = randomToken(24);
      await this.ctx.storage.put('commandToken', this.commandToken);
      return json({ token: this.commandToken });
    }
    if (path === '/api/commands' && req.method === 'GET') return json({ entries: this.commandLog });
    if (path === '/api/jarvis' && req.method === 'GET') return json(this.jarvisStatus());
    if (path === '/api/jarvis' && req.method === 'PUT') {
      const body = await req.json().catch(() => null);
      this.jarvis = sanitizeJarvisSettings(body);
      await this.ctx.storage.put('jarvis', this.jarvis);
      await this.scheduleAlarm();
      return json(this.jarvisStatus());
    }
    if (path === '/api/jarvis/test-voice' && req.method === 'POST') {
      const text = 'Voice check. This is ' + this.jarvis.name + ', at your service.';
      const speech = await synthesize(this.jarvis, this.env, text);
      const displays = this.ctx.getWebSockets('display').length;
      if (speech) this.broadcast({ t: 'speak', text, audio: speech.audio, mime: speech.mime });
      return json({ ok: !!speech, text, audio: speech ? speech.audio : null, mime: speech ? speech.mime : null, displays });
    }
    if (path === '/api/jarvis/briefing' && req.method === 'POST') {
      return json(await this.execute('editor', undefined, { type: 'jarvis.briefing' }));
    }
    if (path === '/api/integrations' && req.method === 'GET') {
      return json({ spotify: await this.spotify.status(), google: await this.google.status(), weather: { provider: 'Open-Meteo', configured: true } });
    }
    if (path === '/api/google/connect' && req.method === 'POST') {
      if (!this.google.configured) return json({ ok: false, error: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server first.' }, 400);
      const body: any = await req.json().catch(() => ({}));
      const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '';
      let origin = '';
      try {
        origin = new URL(returnTo).origin;
      } catch (e) {}
      if (!originOk(this.env, origin)) return json({ ok: false, error: 'Bad return address' }, 400);
      return json({ ok: true, url: await this.google.authUrl(returnTo) });
    }
    if (path === '/api/google/disconnect' && req.method === 'POST') {
      await this.google.disconnect();
      this.nextGooglePoll = Infinity;
      this.setLive({ calendar: null, todos: null });
      return json({ ok: true });
    }
    if (path === '/api/google/refresh' && req.method === 'POST') {
      this.lastCalendarPoll = 0;
      await this.pollGoogle();
      await this.scheduleAlarm();
      return json({ ok: true });
    }
    if (path === '/api/spotify/connect' && req.method === 'POST') {
      if (!this.spotify.configured) return json({ ok: false, error: 'Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the server first.' }, 400);
      const body: any = await req.json().catch(() => ({}));
      const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '';
      let origin = '';
      try {
        origin = new URL(returnTo).origin;
      } catch (e) {}
      if (!originOk(this.env, origin)) return json({ ok: false, error: 'Bad return address' }, 400);
      return json({ ok: true, url: await this.spotify.authUrl(returnTo) });
    }
    if (path === '/api/spotify/disconnect' && req.method === 'POST') {
      await this.spotify.disconnect();
      this.setSpotify(null);
      return json({ ok: true });
    }
    if (path.indexOf('/api/spotify/') === 0) return this.spotifyRoute(req, path);
    if (path === '/api/media' && req.method === 'POST') return this.putMedia(req);

    return json({ ok: false, error: 'Not found' }, 404);
  }

  // ---------- commands ----------

  private async commandApi(req: Request): Promise<Response> {
    // Read the body before any early reply: answering mid-upload breaks keep-alive connections.
    const raw = (await req.text()).slice(0, 10000);
    const now = Date.now();
    this.tokenFailures = this.tokenFailures.filter((t) => now - t < 60000);
    if (this.tokenFailures.length >= TOKEN_FAILURE_LIMIT) {
      return json({ ok: false, reply: 'Too many bad tokens. Try again in a minute.' }, 429);
    }
    const auth = req.headers.get('Authorization') || '';
    const token = /^Bearer\s+(.+)$/i.exec(auth);
    if (!token || !safeEqual(token[1].trim(), this.commandToken)) {
      this.tokenFailures.push(now);
      return json({ ok: false, reply: 'Wrong or missing command token.' }, 401);
    }
    this.commandTimes = this.commandTimes.filter((t) => now - t < 60000);
    if (this.commandTimes.length >= COMMAND_RATE) {
      return json({ ok: false, reply: 'Slow down: too many commands this minute.' }, 429);
    }
    this.commandTimes.push(now);

    // JSON {type, payload} or {text}, or a plain-text body (handy from Shortcuts and curl).
    let body: any = null;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      body = { text: raw };
    }
    if (typeof body === 'string') body = { text: body };
    if (!body || typeof body !== 'object') return json({ ok: false, reply: 'Send {"text": "..."} or {"type": "...", "payload": {...}}.' }, 400);
    const result = await this.execute('api', body.text, body.type ? { type: String(body.type), payload: body.payload } : undefined, {
      speak: body.voice === 'wall',
    });
    return json(result);
  }

  private bearerOk(req: Request): boolean {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
    return !!m && safeEqual(m[1].trim(), this.commandToken);
  }

  // ---------- Spotify ----------

  private async spotifyCallback(url: URL): Promise<Response> {
    const r = await this.spotify.callback(url);
    if (r.ok) {
      // Fetch now-playing right away so the editor shows it on return.
      this.nextSpotifyPoll = Date.now();
      await this.scheduleAlarm();
    }
    return this.oauthReturn('spotify', r);
  }

  // ---------- Google ----------

  private async googleCallback(url: URL): Promise<Response> {
    const r = await this.google.callback(url);
    if (r.ok) {
      this.lastCalendarPoll = 0;
      this.nextGooglePoll = Date.now();
      await this.scheduleAlarm();
    }
    return this.oauthReturn('google', r);
  }

  private async pollGoogle() {
    const now = Date.now();
    const wantCalendar = now - this.lastCalendarPoll >= CALENDAR_POLL_MS - 1000;
    const [todos, calendar] = await Promise.all([this.google.fetchTodos(now), wantCalendar ? this.google.fetchCalendar(now) : Promise.resolve(undefined)]);
    if (todos === null) {
      // Not connected (or just got disconnected).
      this.nextGooglePoll = Infinity;
      if (this.live.todos || this.live.calendar) this.setLive({ calendar: null, todos: null });
      return;
    }
    const patch: Partial<LiveState> = {};
    if (!sameExceptTime(this.live.todos, todos)) patch.todos = todos;
    if (calendar !== undefined) {
      this.lastCalendarPoll = now;
      if (!sameExceptTime(this.live.calendar, calendar)) patch.calendar = calendar;
    }
    if (Object.keys(patch).length) this.setLive(patch);
    this.nextGooglePoll = this.ctx.getWebSockets().length ? now + TODOS_POLL_MS : Infinity;
  }

  private setLive(patch: Partial<LiveState>) {
    this.live = { ...this.live, ...patch };
    this.broadcast({ t: 'live', live: this.live, serverTime: Date.now() });
    this.dirty = true;
  }

  /** Send the browser back to the editor after an OAuth login, with the result in the query. */
  private oauthReturn(service: string, r: { returnTo: string; ok: boolean; message: string }): Response {
    let target = '';
    try {
      const u = new URL(r.returnTo);
      if (originOk(this.env, u.origin)) {
        u.searchParams.set(service, r.ok ? 'connected' : 'error');
        u.searchParams.set('message', r.message);
        target = u.toString();
      }
    } catch (e) {}
    if (target) return new Response(null, { status: 302, headers: { Location: target } });
    const msg = r.message.replace(/[<>&]/g, '');
    return new Response('<!doctype html><meta charset="utf-8"><title>' + service + '</title><p style="font:16px sans-serif">' + msg + '</p>', {
      status: r.ok ? 200 : 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  /** GET /api/spotify/now-playing, POST /api/spotify/{next|previous|play|pause|volume}. */
  private async spotifyRoute(req: Request, path: string): Promise<Response> {
    const action = path.slice('/api/spotify/'.length);
    if (action === 'now-playing' && req.method === 'GET') return json(this.live.spotify || { connected: false });
    if (req.method === 'POST' && ['next', 'previous', 'play', 'pause', 'volume'].indexOf(action) >= 0) {
      const body: any = await req.json().catch(() => ({}));
      const payload = action === 'volume' ? { percent: body.percent } : undefined;
      return json(await this.execute(this.bearerOk(req) ? 'api' : 'editor', undefined, { type: 'spotify.' + action, payload }));
    }
    return json({ ok: false, error: 'Not found' }, 404);
  }

  private setSpotify(next: LiveState['spotify']) {
    this.live = { ...this.live, spotify: next };
    this.broadcast({ t: 'live', live: this.live, serverTime: Date.now() });
    this.dirty = true;
  }

  private async pollSpotify() {
    const now = Date.now();
    const sample = await this.spotify.poll(now);
    if (sample === null) {
      this.nextSpotifyPoll = Infinity;
      if (this.live.spotify) this.setSpotify(null);
      return;
    }
    if (sample.isPlaying) this.lastMusicAt = now;
    if (spotifyChanged(this.live.spotify, sample, now)) this.setSpotify(sample);
    const quiet = now - this.lastMusicAt > SPOTIFY_QUIET_AFTER_MS;
    const interval = sample.isPlaying ? SPOTIFY_POLL_PLAYING_MS : quiet ? SPOTIFY_POLL_QUIET_MS : SPOTIFY_POLL_IDLE_MS;
    // Only keep polling while someone is looking.
    this.nextSpotifyPoll = this.ctx.getWebSockets().length ? now + interval : Infinity;
  }

  /**
   * Runs a request: a structured command, a known phrase (fast, free), or, with
   * Jarvis on, anything else via the brain. Logs it, and speaks the reply on the
   * wall when asked to (room mics) or when voice is set to "every reply".
   */
  private async execute(source: string, text?: string, command?: Command, opts: { speak?: boolean } = {}): Promise<CommandResult> {
    const now = Date.now();
    const input = typeof text === 'string' ? text.trim().slice(0, MAX_COMMAND_TEXT) : '';
    let result: CommandResult;
    let logType: string | null = null;

    if (command && command.type) {
      result = await this.runOne(command, now);
      logType = command.type;
    } else if (!input) {
      result = { ok: false, reply: 'Empty command.' };
    } else {
      const parsed = parseTextDetailed(input);
      const brainOn = this.jarvis.provider !== 'off';
      if (parsed.command && !(brainOn && parsed.loose)) {
        result = await this.runOne(parsed.command, now);
        logType = parsed.command.type;
      } else if (brainOn) {
        const r = await this.askJarvis(input, now, parsed.command);
        result = r.result;
        logType = r.logType;
      } else {
        result = { ok: false, reply: `Sorry, I didn't understand "${input}".` };
      }
      this.remember(input, result.reply, now);
    }

    this.commandLog = [{ at: now, source, input: input || (command ? command.type : ''), type: logType, ok: result.ok, reply: result.reply }, ...this.commandLog].slice(
      0,
      COMMAND_LOG_SIZE,
    );
    const logMsg = JSON.stringify({ t: 'commandLog', entries: this.commandLog } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets('editor')) {
      try {
        ws.send(logMsg);
      } catch (e) {}
    }
    await this.ctx.storage.put('commandLog', this.commandLog);

    // The briefing is an announcement: spoken whenever voice is on.
    const briefing = logType === 'jarvis.briefing' && result.ok;
    if (opts.speak || this.jarvis.voice === 'all' || (briefing && this.jarvis.voice !== 'off')) await this.say(result.reply);
    await this.markDirty();
    return result;
  }

  /** Runs one structured command and broadcasts what changed. */
  private async runOne(cmd: Command, now: number): Promise<CommandResult> {
    if (cmd.payload !== undefined && (typeof cmd.payload !== 'object' || cmd.payload === null)) cmd = { type: cmd.type };
    let out: { result: CommandResult; live?: LiveState; project?: Project };
    if (cmd.type === 'jarvis.briefing') {
      out = { result: { ok: true, reply: await composeBriefing(this.jarvis, this.env, this.live, now) } };
      this.lastBriefingDate = localDate(now, this.jarvis.timeZone);
      this.briefingPendingUntil = 0;
      await this.saveJarvisState();
    } else if (cmd.type.indexOf('spotify.') === 0) {
      const r = await this.spotify.control(cmd, this.live.spotify, now);
      out = { result: { ok: r.ok, reply: r.reply } };
      // Show what we already know changed; the next poll confirms it.
      if (r.patch && this.live.spotify) out.live = { ...this.live, spotify: { ...this.live.spotify, ...r.patch } };
    } else if (cmd.type.indexOf('todo.') === 0 || cmd.type.indexOf('calendar.') === 0) {
      const r = await this.google.control(cmd, this.live, now);
      out = { result: { ok: r.ok, reply: r.reply } };
      if (r.todos) out.live = { ...this.live, todos: r.todos };
      // Confirm against Google shortly (ids, ordering, edits made elsewhere).
      if (r.ok && cmd.type.indexOf('todo.') === 0 && cmd.type !== 'todo.list') this.nextGooglePoll = now + 1500;
    } else {
      out = runCommand(cmd, { live: this.live, project: this.project, now });
    }
    if (cmd.type.indexOf('spotify.') === 0 && cmd.type !== 'spotify.status' && out.result.ok) {
      // Spotify's state lags a little behind the command; look again shortly.
      this.lastMusicAt = now;
      this.nextSpotifyPoll = now + 700;
    }
    if (out.live) {
      this.live = out.live;
      this.broadcast({ t: 'live', live: this.live, serverTime: now });
    }
    if (out.project) {
      this.project = out.project;
      this.rev++;
      this.broadcast({ t: 'project', project: this.project, rev: this.rev, serverTime: now });
    }
    if (out.result.ok) this.broadcast({ t: 'command', command: cmd });
    if (out.live || out.project) this.dirty = true;
    return { ...out.result, command: cmd };
  }

  // ---------- Jarvis ----------

  /** Ask the brain for a plan and carry it out. `fallback` is the parser's guess, used if the brain is unreachable. */
  private async askJarvis(input: string, now: number, fallback: Command | null): Promise<{ result: CommandResult; logType: string | null }> {
    const memory = this.memory.filter((m) => now - m.at < this.jarvis.memoryMinutes * 60000);
    const context = buildContext(this.live, this.project, now, this.jarvis.timeZone);
    const r = await think(this.jarvis, this.env, input, context, memory);
    this.lastBrainMs = r.ms;
    if ('error' in r) {
      this.lastBrainError = r.error;
      if (fallback) return { result: await this.runOne(fallback, now), logType: fallback.type };
      return { result: { ok: false, reply: `${this.jarvis.name} couldn't think that through: ${r.error.replace(/\.$/, '')}.` }, logType: null };
    }
    this.lastBrainError = null;
    const plan = r.plan;
    const results: CommandResult[] = [];
    for (const c of plan.commands) results.push(await this.runOne(c, Date.now()));
    const failed = results.filter((x) => !x.ok);
    // The model wrote its reply before anything ran: trust it only if everything worked.
    let reply = plan.reply;
    if (failed.length) reply = results.map((x) => x.reply).join(' ');
    else if (!reply) reply = results.map((x) => x.reply).join(' ') || 'Done.';
    const types = plan.commands.map((c) => c.type);
    return { result: { ok: !failed.length, reply, command: plan.commands[0] }, logType: types.length ? 'jarvis: ' + types.join(', ') : 'jarvis: answer' };
  }

  private remember(user: string, reply: string, now: number) {
    this.memory = [...this.memory.filter((m) => now - m.at < this.jarvis.memoryMinutes * 60000), { at: now, user, reply }].slice(-MEMORY_SIZE);
  }

  private jarvisStatus() {
    return {
      settings: this.jarvis,
      status: {
        ready: brainReady(this.jarvis, this.env),
        workersAI: !!(this.env.AI || this.env.AI_MOCK_URL),
        claudeKey: !!this.env.ANTHROPIC_API_KEY,
        lastError: this.lastBrainError,
        lastMs: this.lastBrainMs,
        displays: this.ctx.getWebSockets('display').length,
        nextBriefing: this.jarvis.briefing ? nextDailyTime(Date.now(), this.jarvis.briefingTime, this.jarvis.timeZone) : null,
      },
    };
  }

  /** Speak through the projector(s), and optionally caption it on the wall. */
  private async say(text: string) {
    if (!text || this.jarvis.voice === 'off') return;
    if (this.jarvis.captions) {
      const now = Date.now();
      const seconds = Math.max(4, Math.min(20, Math.round(text.split(/\s+/).length * 0.45) + 2));
      this.live = { ...this.live, message: { id: 'j' + now.toString(36), text, until: now + seconds * 1000 } };
      this.broadcast({ t: 'live', live: this.live, serverTime: now });
      this.dirty = true;
    }
    if (!this.ctx.getWebSockets('display').length) return; // nobody to hear it
    const speech = await synthesize(this.jarvis, this.env, text);
    this.broadcast({ t: 'speak', text, audio: speech ? speech.audio : null, mime: speech ? speech.mime : 'audio/mpeg' });
  }

  /** Something Jarvis says on its own (timer done, event soon). Logged like a command. */
  private async announce(text: string) {
    const now = Date.now();
    this.commandLog = [{ at: now, source: 'jarvis', input: '(announcement)', type: 'jarvis.announce', ok: true, reply: text }, ...this.commandLog].slice(0, COMMAND_LOG_SIZE);
    const logMsg = JSON.stringify({ t: 'commandLog', entries: this.commandLog } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets('editor')) {
      try {
        ws.send(logMsg);
      } catch (e) {}
    }
    await this.ctx.storage.put('commandLog', this.commandLog);
    await this.say(text);
  }

  private async saveJarvisState() {
    await this.ctx.storage.put('jarvis:state', {
      announcedTimerEnd: this.announcedTimerEnd,
      announcedEvents: this.announcedEvents,
      lastBriefingDate: this.lastBriefingDate,
      briefingPendingUntil: this.briefingPendingUntil,
    });
  }

  /** Timed events that should get a heads-up: [eventId, start]. */
  private upcomingReminders(): [string, number][] {
    const cal = this.live.calendar;
    if (!cal || !this.jarvis.announceEvents) return [];
    const out: [string, number][] = [];
    for (const e of cal.events) {
      if (e.allDay || this.announcedEvents.indexOf(e.id) >= 0) continue;
      const start = Date.parse(e.start);
      if (isFinite(start)) out.push([e.id, start]);
    }
    return out;
  }

  /** When the next announcement is due (Infinity if none). */
  private nextAnnouncementAt(): number {
    if (this.jarvis.voice === 'off' && !this.jarvis.captions) return Infinity;
    const now = Date.now();
    let next = Infinity;
    const t = this.live.timer;
    if (this.jarvis.announceTimers && t && t.status === 'running' && !t.pomodoro && t.endsAt > this.announcedTimerEnd) next = Math.min(next, t.endsAt);
    const lead = this.jarvis.eventLeadMinutes * 60000;
    for (const [, start] of this.upcomingReminders()) if (start > now) next = Math.min(next, Math.max(now, start - lead));
    if (this.jarvis.briefing) {
      next = Math.min(next, nextDailyTime(now, this.jarvis.briefingTime, this.jarvis.timeZone));
      if (this.briefingPendingUntil > now && this.ctx.getWebSockets('display').length) next = Math.min(next, now + 1500);
    }
    return next;
  }

  private async checkAnnouncements(now: number) {
    if (this.jarvis.voice === 'off' && !this.jarvis.captions) return;
    let changed = false;
    // Timer finished (plain timers; Pomodoro phases are announced as they roll over).
    const t = this.live.timer;
    if (this.jarvis.announceTimers && t && t.status === 'running' && !t.pomodoro && t.endsAt <= now && t.endsAt > this.announcedTimerEnd) {
      this.announcedTimerEnd = t.endsAt;
      changed = true;
      if (now - t.endsAt < 60000) await this.announce((t.label ? 'Your ' + t.label.toLowerCase() + ' timer' : 'Your timer') + ' is done.');
    }
    // Events starting soon.
    const lead = this.jarvis.eventLeadMinutes * 60000;
    const cal = this.live.calendar;
    for (const [id, start] of this.upcomingReminders()) {
      if (start - lead <= now && now < start) {
        const ev = cal && cal.events.find((e) => e.id === id);
        this.announcedEvents = [...this.announcedEvents, id].slice(-100);
        changed = true;
        const m = Math.max(1, Math.round((start - now) / 60000));
        if (ev) await this.announce('Heads up: ' + ev.title + ' starts in ' + m + (m === 1 ? ' minute.' : ' minutes.'));
      }
    }
    // Daily briefing: deliver now if a display is listening, otherwise hold it for a few hours.
    if (this.jarvis.briefing) {
      const today = localDate(now, this.jarvis.timeZone);
      const dueToday = nextDailyTime(now - 24 * 3600 * 1000, this.jarvis.briefingTime, this.jarvis.timeZone);
      const due = this.lastBriefingDate !== today && (now >= dueToday && now - dueToday < BRIEFING_HOLD_MS);
      if (due || this.briefingPendingUntil > now) {
        if (this.ctx.getWebSockets('display').length) {
          await this.execute('jarvis', undefined, { type: 'jarvis.briefing' });
        } else if (!this.briefingPendingUntil) {
          this.briefingPendingUntil = dueToday + BRIEFING_HOLD_MS;
          changed = true;
        }
      }
    }
    if (changed) await this.saveJarvisState();
  }

  // ---------- media ----------

  private async putMedia(req: Request): Promise<Response> {
    const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    // No SVG: it can carry script and would be served from the API's origin.
    if (MEDIA_TYPES.indexOf(type) < 0) return json({ ok: false, error: 'Only PNG, JPEG, WebP or GIF images' }, 415);
    const data = await req.arrayBuffer();
    if (data.byteLength === 0) return json({ ok: false, error: 'Empty upload' }, 400);
    if (data.byteLength > MAX_MEDIA_BYTES) return json({ ok: false, error: 'Image must be under 1.9 MB' }, 413);
    const id = randomToken(16);
    await this.ctx.storage.put('media:' + id, { type, data, size: data.byteLength, createdAt: Date.now() });
    return json({ ok: true, id, path: '/api/media/' + id });
  }

  private async getMedia(id: string): Promise<Response> {
    const m = (await this.ctx.storage.get('media:' + id)) as { type: string; data: ArrayBuffer } | undefined;
    if (!m) return new Response('Not found', { status: 404 });
    return new Response(m.data, {
      headers: {
        'Content-Type': m.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private originAllowed(req: Request): boolean {
    return isOriginAllowed(this.env, req);
  }

  private async login(req: Request): Promise<Response> {
    if (!this.originAllowed(req)) return json({ ok: false, error: 'Bad origin' }, 403);
    const now = Date.now();
    if (now < this.loginLockedUntil) {
      return json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' }, 429);
    }
    let body: any = null;
    try {
      body = await req.json();
    } catch (e) {}
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!this.env.EDITOR_PASSWORD || !this.env.SESSION_SECRET) {
      return json({ ok: false, error: 'Server is missing EDITOR_PASSWORD or SESSION_SECRET' }, 500);
    }
    if (!safeEqual(password, this.env.EDITOR_PASSWORD)) {
      this.loginFailures++;
      if (this.loginFailures >= LOGIN_MAX_FAILURES) {
        this.loginFailures = 0;
        this.loginLockedUntil = now + LOGIN_LOCK_MS;
      }
      return json({ ok: false, error: 'Wrong password' }, 401);
    }
    this.loginFailures = 0;
    const session = await createSession(this.env.SESSION_SECRET);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session, undefined, isLocalDev(this.env)) });
  }

  // ---------- WebSockets ----------

  private async handleSocket(req: Request, url: URL): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    let role: Role | null = null;
    let error = '';
    const k = url.searchParams.get('k');
    if (k !== null) {
      if (safeEqual(k, this.displayKey)) role = 'display';
      else error = 'Invalid display key. Copy the display link from the editor.';
    } else if (await isEditor(req, this.env.SESSION_SECRET)) {
      if (this.originAllowed(req)) role = 'editor';
      else error = 'Origin not allowed';
    } else {
      error = 'Not logged in';
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!role) {
      // Browsers can't read an HTTP error on a WS upgrade, so explain over the socket.
      server.accept();
      server.send(JSON.stringify({ t: 'error', message: error } satisfies ServerMessage));
      server.close(4001, 'unauthorized');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);
    this.sendTo(server, {
      t: 'snapshot',
      project: this.project,
      live: this.live,
      rev: this.rev,
      serverTime: Date.now(),
      role,
    });
    if (role === 'editor') this.sendTo(server, { t: 'commandLog', entries: this.commandLog });
    // Someone is watching: make sure integrations are fresh and polling is on.
    if (await this.spotify.connected()) {
      if (this.nextSpotifyPoll > Date.now() + 1000) this.nextSpotifyPoll = Date.now() + 200;
    }
    if (await this.google.connected()) {
      if (this.nextGooglePoll > Date.now() + 1000) this.nextGooglePoll = Date.now() + 300;
    }
    await this.scheduleAlarm(); // also picks up a held briefing once a display connects
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (msg.t === 'ping') {
      this.sendTo(ws, { t: 'pong', serverTime: Date.now() });
      return;
    }
    const role = this.ctx.getTags(ws)[0] as Role;
    if (role !== 'editor') return; // displays are read-only

    if (msg.t === 'command') {
      const result = await this.execute('editor', msg.text, msg.command);
      this.sendTo(ws, { t: 'commandResult', id: String(msg.id || ''), result });
    } else if (msg.t === 'setProject') {
      const err = validateProject(msg.project);
      if (err) {
        this.sendTo(ws, { t: 'error', message: err });
        return;
      }
      this.project = msg.project;
      this.rev++;
      this.broadcast({ t: 'project', project: this.project, rev: this.rev, serverTime: Date.now() }, ws);
      await this.markDirty();
    } else if (msg.t === 'setCalibration') {
      const c = msg.calibration;
      if (!c || typeof c.grid !== 'boolean' || typeof c.highlight !== 'boolean') return;
      this.live = {
        ...this.live,
        calibration: { grid: c.grid, highlight: c.highlight, selectedLayerId: typeof c.selectedLayerId === 'string' ? c.selectedLayerId : null },
      };
      this.broadcast({ t: 'live', live: this.live, serverTime: Date.now() }, ws);
      await this.markDirty();
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch (e) {}
  }

  async webSocketError() {}

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {}
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch (e) {}
    }
  }

  // ---------- persistence + alarms ----------
  // Drags stream ~25 updates/s; write at most once a second, with an alarm for the tail.
  // The one alarm also wakes the object when a Pomodoro phase ends.

  private async markDirty() {
    this.dirty = true;
    if (Date.now() - this.lastPersist >= PERSIST_INTERVAL_MS) await this.persist();
    await this.scheduleAlarm();
  }

  private async scheduleAlarm() {
    let next = Infinity;
    if (this.dirty) next = this.lastPersist + PERSIST_INTERVAL_MS;
    const t = this.live.timer;
    if (t && t.status === 'running' && t.pomodoro) next = Math.min(next, t.endsAt);
    next = Math.min(next, this.nextSpotifyPoll, this.nextGooglePoll, this.nextAnnouncementAt());
    const current = await this.ctx.storage.getAlarm();
    if (next === Infinity) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (current !== next) {
      // Also covers the alarm that is firing right now, which may still be reported here.
      await this.ctx.storage.setAlarm(next);
    }
  }

  private async persist() {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersist = Date.now();
    await this.ctx.storage.put({ project: this.project, live: this.live, rev: this.rev });
  }

  async alarm() {
    // Roll Pomodoro phases forward (several, if the object slept through them).
    let changed = false;
    let phase: string | null = null;
    for (let i = 0; i < 20; i++) {
      const next = advanceTimer(this.live, Date.now());
      if (!next) break;
      this.live = next;
      changed = true;
      phase = next.timer.pomodoro ? next.timer.pomodoro.phase : null;
    }
    if (phase && this.jarvis.announceTimers) {
      const t = this.live.timer;
      await this.announce(
        phase === 'break'
          ? 'Focus session done. Take ' + Math.round(t.durationMs / 60000) + ' minutes.'
          : "Break's over. Back to focus.",
      );
    }
    if (changed) {
      this.broadcast({ t: 'live', live: this.live, serverTime: Date.now() });
      this.dirty = true;
    }
    if (Date.now() >= this.nextSpotifyPoll - 50) await this.pollSpotify();
    if (Date.now() >= this.nextGooglePoll - 50) await this.pollGoogle();
    await this.checkAnnouncements(Date.now());
    await this.persist();
    await this.scheduleAlarm();
  }
}

/** Deep-compare two integration states, ignoring when they were fetched. */
function sameExceptTime(a: any, b: any): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify({ ...a, fetchedAt: 0 }) === JSON.stringify({ ...b, fetchedAt: 0 });
}
