// The Wall Durable Object: single source of truth for the project and live
// state, and the hub every editor/display WebSocket connects to. Uses the
// WebSocket Hibernation API so idle displays cost nothing.

import { DurableObject } from 'cloudflare:workers';
import { defaultLiveState, defaultProject, type ClientMessage, type LiveState, type Project, type ServerMessage } from '../../shared/types';
import { validateProject } from '../../shared/validate';
import { createSession, isEditor, randomToken, safeEqual, sessionCookie } from './auth';
import { allowedOrigins, type Env } from './env';

type Role = 'editor' | 'display';

const PERSIST_INTERVAL_MS = 1000;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['project', 'live', 'rev', 'displayKey']);
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
    });
  }

  // ---------- HTTP ----------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/ws') return this.handleSocket(req, url);

    if (path === '/api/login' && req.method === 'POST') return this.login(req);
    if (path === '/api/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
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

    return json({ ok: false, error: 'Not found' }, 404);
  }

  private originAllowed(req: Request): boolean {
    const origin = req.headers.get('Origin');
    return !!origin && allowedOrigins(this.env).indexOf(origin) >= 0;
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
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session) });
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

    if (msg.t === 'setProject') {
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

  // ---------- persistence ----------
  // Drags stream ~25 updates/s; write at most once a second, with an alarm for the tail.

  private async markDirty() {
    this.dirty = true;
    const now = Date.now();
    if (now - this.lastPersist >= PERSIST_INTERVAL_MS) {
      await this.persist();
    } else if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(this.lastPersist + PERSIST_INTERVAL_MS);
    }
  }

  private async persist() {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersist = Date.now();
    await this.ctx.storage.put({ project: this.project, live: this.live, rev: this.rev });
  }

  async alarm() {
    await this.persist();
  }
}
