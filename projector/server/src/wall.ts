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
import { parseText } from './commands/parseText';
import { isLocalDev, isOriginAllowed, type Env } from './env';

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['project', 'live', 'rev', 'displayKey', 'commandToken', 'commandLog']);
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
    const result = await this.execute('api', body.text, body.type ? { type: String(body.type), payload: body.payload } : undefined);
    return json(result);
  }

  /** Parses (if needed), runs, logs and broadcasts a command. */
  private async execute(source: string, text?: string, command?: Command): Promise<CommandResult> {
    const now = Date.now();
    let cmd: Command | null = command && command.type ? command : null;
    const input = typeof text === 'string' ? text.trim().slice(0, MAX_COMMAND_TEXT) : '';
    if (!cmd && input) cmd = parseText(input);

    let result: CommandResult;
    if (!cmd) {
      result = input ? { ok: false, reply: `Sorry, I didn't understand "${input}".` } : { ok: false, reply: 'Empty command.' };
    } else {
      if (cmd.payload !== undefined && (typeof cmd.payload !== 'object' || cmd.payload === null)) cmd = { type: cmd.type };
      const out = runCommand(cmd, { live: this.live, project: this.project, now });
      result = { ...out.result, command: cmd };
      if (out.live) {
        this.live = out.live;
        this.broadcast({ t: 'live', live: this.live, serverTime: now });
      }
      if (out.project) {
        this.project = out.project;
        this.rev++;
        this.broadcast({ t: 'project', project: this.project, rev: this.rev, serverTime: now });
      }
      if (result.ok) this.broadcast({ t: 'command', command: cmd });
      if (out.live || out.project) this.dirty = true;
    }

    this.commandLog = [
      { at: now, source, input: input || (cmd ? cmd.type : ''), type: cmd ? cmd.type : null, ok: result.ok, reply: result.reply },
      ...this.commandLog,
    ].slice(0, COMMAND_LOG_SIZE);
    const logMsg = JSON.stringify({ t: 'commandLog', entries: this.commandLog } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets('editor')) {
      try {
        ws.send(logMsg);
      } catch (e) {}
    }
    await this.ctx.storage.put('commandLog', this.commandLog);
    await this.markDirty();
    return result;
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
    for (let i = 0; i < 20; i++) {
      const next = advanceTimer(this.live, Date.now());
      if (!next) break;
      this.live = next;
      changed = true;
    }
    if (changed) {
      this.broadcast({ t: 'live', live: this.live, serverTime: Date.now() });
      this.dirty = true;
    }
    await this.persist();
    await this.scheduleAlarm();
  }
}
