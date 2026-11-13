// Spotify integration: OAuth (refresh token kept in Durable Object storage),
// now-playing polling and playback control. Secrets never leave the server.
//
// Each integration is one module with the same shape: status(), connect and
// disconnect, and whatever polling/commands it needs. Home Assistant, Google
// and others slot in next to this file.

import { randomToken } from '../auth';
import type { Env } from '../env';
import type { Command, CommandResult, SpotifyState, SpotifyTrack } from '../../../shared/types';

const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
const STATE_TTL_MS = 10 * 60 * 1000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: string;
  product: string;
}

interface PendingAuth {
  state: string;
  returnTo: string;
  expires: number;
}

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  user: string;
  product: string;
  error: string | null;
  redirectUri: string;
}

/** Storage the integration needs (a slice of DurableObjectStorage). */
interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export class Spotify {
  private env: Env;
  private store: Store;
  private tokens: Tokens | null = null;
  private loaded = false;
  lastError: string | null = null;
  /** Spotify asked us to back off (429) until this time. */
  private retryAfter = 0;

  constructor(env: Env, store: Store) {
    this.env = env;
    this.store = store;
  }

  private get accountsUrl() {
    return (this.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com').replace(/\/$/, '');
  }
  private get apiUrl() {
    return (this.env.SPOTIFY_API_URL || 'https://api.spotify.com').replace(/\/$/, '');
  }
  get redirectUri() {
    return this.env.API_ORIGIN.replace(/\/$/, '') + '/api/spotify/callback';
  }
  get configured() {
    return !!(this.env.SPOTIFY_CLIENT_ID && this.env.SPOTIFY_CLIENT_SECRET);
  }

  private async load() {
    if (this.loaded) return;
    this.tokens = (await this.store.get<Tokens>('spotify:tokens')) || null;
    this.loaded = true;
  }

  async connected(): Promise<boolean> {
    await this.load();
    return !!this.tokens;
  }

  async status(): Promise<SpotifyStatus> {
    await this.load();
    return {
      configured: this.configured,
      connected: !!this.tokens,
      user: this.tokens ? this.tokens.user : '',
      product: this.tokens ? this.tokens.product : '',
      error: this.lastError,
      redirectUri: this.redirectUri,
    };
  }

  // ---------- OAuth ----------

  /** Starts the OAuth flow; the editor sends the browser to the returned URL. */
  async authUrl(returnTo: string): Promise<string> {
    const state = randomToken(18);
    await this.store.put('spotify:pending', { state, returnTo, expires: Date.now() + STATE_TTL_MS } satisfies PendingAuth);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.env.SPOTIFY_CLIENT_ID || '',
      scope: SCOPES,
      redirect_uri: this.redirectUri,
      state,
      show_dialog: 'true',
    });
    return this.accountsUrl + '/authorize?' + q.toString();
  }

  /** Handles Spotify's redirect back. Returns where to send the browser. */
  async callback(url: URL): Promise<{ returnTo: string; ok: boolean; message: string }> {
    const pending = await this.store.get<PendingAuth>('spotify:pending');
    const state = url.searchParams.get('state');
    if (!pending || !state || pending.state !== state || pending.expires < Date.now()) {
      return { returnTo: pending ? pending.returnTo : '', ok: false, message: 'That Spotify login link expired. Try connecting again.' };
    }
    await this.store.delete('spotify:pending');
    const err = url.searchParams.get('error');
    if (err) return { returnTo: pending.returnTo, ok: false, message: err === 'access_denied' ? 'Spotify access was not allowed.' : 'Spotify said: ' + err };
    const code = url.searchParams.get('code') || '';
    try {
      const tok = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
      const tokens: Tokens = {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + (tok.expires_in - 60) * 1000,
        user: '',
        product: '',
      };
      this.tokens = tokens;
      try {
        const me = await this.api('GET', '/v1/me');
        if (me.status === 200) {
          const j: any = await me.json();
          tokens.user = j.display_name || j.id || '';
          tokens.product = j.product || '';
        }
      } catch (e) {}
      await this.store.put('spotify:tokens', tokens);
      this.lastError = null;
      return { returnTo: pending.returnTo, ok: true, message: tokens.user ? 'Connected as ' + tokens.user : 'Connected' };
    } catch (e: any) {
      return { returnTo: pending.returnTo, ok: false, message: e.message || 'Could not finish connecting to Spotify.' };
    }
  }

  async disconnect() {
    this.tokens = null;
    this.lastError = null;
    await this.store.delete('spotify:tokens');
  }

  private async tokenRequest(params: Record<string, string>): Promise<any> {
    const res = await fetch(this.accountsUrl + '/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(this.env.SPOTIFY_CLIENT_ID + ':' + this.env.SPOTIFY_CLIENT_SECRET),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.error || 'Spotify token request failed (' + res.status + ')');
    return j;
  }

  private async accessToken(): Promise<string> {
    await this.load();
    if (!this.tokens) throw new Error('Spotify is not connected.');
    if (Date.now() < this.tokens.expiresAt) return this.tokens.accessToken;
    try {
      const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken });
      this.tokens = {
        ...this.tokens,
        accessToken: tok.access_token,
        // Spotify may or may not rotate the refresh token.
        refreshToken: tok.refresh_token || this.tokens.refreshToken,
        expiresAt: Date.now() + (tok.expires_in - 60) * 1000,
      };
      await this.store.put('spotify:tokens', this.tokens);
      return this.tokens.accessToken;
    } catch (e: any) {
      if (/invalid_grant|revoked/i.test(e.message || '')) {
        await this.disconnect();
        this.lastError = 'Spotify access was revoked. Connect again from Integrations.';
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

  // ---------- now playing ----------

  /** Current playback, or null if Spotify isn't connected. Never throws. */
  async poll(now: number): Promise<SpotifyState | null> {
    await this.load();
    if (!this.tokens) return null;
    const base: SpotifyState = { connected: true, track: null, isPlaying: false, progressMs: 0, at: now, volume: null, device: '', error: null };
    if (now < this.retryAfter) return { ...base, error: this.lastError };
    try {
      const res = await this.api('GET', '/v1/me/player?additional_types=episode');
      if (res.status === 204) {
        this.lastError = null;
        return base;
      }
      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') || '5', 10);
        this.retryAfter = now + Math.max(1, wait) * 1000;
        this.lastError = 'Spotify rate limit; pausing updates for ' + wait + 's.';
        return { ...base, error: this.lastError };
      }
      if (!res.ok) {
        this.lastError = 'Spotify now-playing failed (' + res.status + ').';
        return { ...base, error: this.lastError };
      }
      const j: any = await res.json();
      this.lastError = null;
      return {
        ...base,
        track: toTrack(j.item),
        isPlaying: !!j.is_playing,
        progressMs: j.progress_ms || 0,
        volume: j.device && typeof j.device.volume_percent === 'number' ? j.device.volume_percent : null,
        device: j.device ? j.device.name || '' : '',
      };
    } catch (e: any) {
      if (!this.tokens) return null; // just got disconnected (revoked)
      this.lastError = e.message || 'Could not reach Spotify.';
      return { ...base, error: this.lastError };
    }
  }

  // ---------- playback control ----------

  /**
   * Runs a spotify.* command. On success, `patch` is what we already know changed
   * (play state, volume), so screens update before the next poll confirms it.
   */
  async control(cmd: Command, current: SpotifyState | null | undefined, now = Date.now()): Promise<CommandResult & { patch?: Partial<SpotifyState> }> {
    if (!this.configured) return { ok: false, reply: "Spotify isn't set up on the server yet." };
    if (!(await this.connected())) return { ok: false, reply: "Spotify isn't connected. Connect it from the wall editor." };
    const p = cmd.payload || {};
    let res: Response;
    let reply: string;
    let patch: Partial<SpotifyState> | undefined;
    try {
      switch (cmd.type) {
        case 'spotify.next':
          res = await this.api('POST', '/v1/me/player/next');
          reply = 'Skipped.';
          break;
        case 'spotify.previous':
          res = await this.api('POST', '/v1/me/player/previous');
          reply = 'Going back.';
          break;
        case 'spotify.pause':
          if (current && current.track && !current.isPlaying) return { ok: true, reply: 'Spotify is already paused.' };
          res = await this.api('PUT', '/v1/me/player/pause');
          reply = 'Paused.';
          if (current) patch = { isPlaying: false, progressMs: spotifyProgressAt(current, now), at: now };
          break;
        case 'spotify.play':
          if (current && current.isPlaying) return { ok: true, reply: 'Spotify is already playing.' };
          res = await this.api('PUT', '/v1/me/player/play');
          reply = 'Playing.';
          if (current) patch = { isPlaying: true, progressMs: current.progressMs, at: now };
          break;
        case 'spotify.volume': {
          let pct = typeof p.percent === 'number' ? p.percent : parseFloat(p.percent);
          if (!isFinite(pct) && typeof p.delta === 'number') {
            const base = current && current.volume !== null ? current.volume : 50;
            pct = base + p.delta;
          }
          if (!isFinite(pct)) return { ok: false, reply: 'What volume? Say a number from 0 to 100.' };
          pct = Math.round(Math.max(0, Math.min(100, pct)));
          res = await this.api('PUT', '/v1/me/player/volume?volume_percent=' + pct);
          reply = 'Volume ' + pct + '.';
          patch = { volume: pct };
          break;
        }
        case 'spotify.status': {
          const s = current;
          if (!s || !s.track) return { ok: true, reply: 'Nothing is playing on Spotify.' };
          return { ok: true, reply: (s.isPlaying ? '' : 'Paused: ') + s.track.name + (s.track.artists ? ' by ' + s.track.artists : '') + '.' };
        }
        default:
          return { ok: false, reply: "I don't know the Spotify command " + cmd.type + '.' };
      }
    } catch (e: any) {
      return { ok: false, reply: e.message || 'Could not reach Spotify.' };
    }
    if (res.ok) return { ok: true, reply, patch };
    return { ok: false, reply: await explain(res) };
  }
}

function spotifyProgressAt(s: SpotifyState, now: number): number {
  const p = s.isPlaying ? s.progressMs + (now - s.at) : s.progressMs;
  return s.track ? Math.max(0, Math.min(s.track.durationMs, p)) : 0;
}

/** Spotify error → something worth saying out loud. */
async function explain(res: Response): Promise<string> {
  let reason = '';
  try {
    const j: any = await res.json();
    reason = (j.error && (j.error.reason || j.error.message)) || '';
  } catch (e) {}
  if (res.status === 404 || reason === 'NO_ACTIVE_DEVICE') return 'Nothing is playing on Spotify. Start music on a device first.';
  if (reason === 'PREMIUM_REQUIRED' || (res.status === 403 && /premium/i.test(reason))) return 'Controlling playback needs Spotify Premium.';
  if (res.status === 403) return "Spotify didn't allow that" + (reason ? ' (' + reason.toLowerCase().replace(/_/g, ' ') + ')' : '') + '.';
  if (res.status === 429) return 'Spotify is rate limiting. Try again in a moment.';
  return 'Spotify returned an error (' + res.status + ').';
}

function pickImage(images: any[] | undefined): string {
  if (!images || !images.length) return '';
  // Images come largest first; use the smallest that's still ≥ 300px.
  let best = images[0];
  for (const im of images) if (im.width >= 300 && im.width < best.width) best = im;
  return best.url || '';
}

function toTrack(item: any): SpotifyTrack | null {
  if (!item) return null;
  if (item.type === 'episode') {
    return {
      id: item.id || item.uri || '',
      name: item.name || '',
      artists: item.show ? item.show.name || '' : '',
      album: item.show ? item.show.name || '' : '',
      art: pickImage(item.images || (item.show && item.show.images)),
      durationMs: item.duration_ms || 0,
      kind: 'episode',
    };
  }
  return {
    id: item.id || item.uri || '',
    name: item.name || '',
    artists: (item.artists || []).map((a: any) => a.name).join(', '),
    album: item.album ? item.album.name || '' : '',
    art: pickImage(item.album && item.album.images),
    durationMs: item.duration_ms || 0,
    kind: 'track',
  };
}

/** True if a fresh sample differs enough from what clients already show to be worth pushing. */
export function spotifyChanged(prev: SpotifyState | null | undefined, next: SpotifyState | null, now: number): boolean {
  if (!prev || !next) return prev !== next;
  if ((prev.track ? prev.track.id : '') !== (next.track ? next.track.id : '')) return true;
  if (prev.isPlaying !== next.isPlaying || prev.volume !== next.volume || prev.device !== next.device || prev.error !== next.error) return true;
  if (!next.track) return false;
  // Clients extrapolate progress; only resync after a seek or drift.
  const predicted = prev.isPlaying ? prev.progressMs + (now - prev.at) : prev.progressMs;
  return Math.abs(predicted - next.progressMs) > 2500;
}
