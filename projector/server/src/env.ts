export interface Env {
  WALL: DurableObjectNamespace;
  /** Comma-separated list of origins allowed to call the API with the editor cookie. */
  ALLOWED_ORIGINS: string;
  EDITOR_PASSWORD: string;
  SESSION_SECRET: string;
  /** Initial display key; can be rotated from the editor afterwards. */
  DISPLAY_KEY?: string;
  COMMAND_TOKEN?: string;
  /** Set to "true" only by `npm run dev` (wrangler dev --var). */
  LOCAL_DEV?: string;
  /** Public origin of this API, used for OAuth redirect URIs. */
  API_ORIGIN: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  /** Test-only overrides so the Spotify integration can be exercised against a mock. */
  SPOTIFY_ACCOUNTS_URL?: string;
  SPOTIFY_API_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Test-only overrides for the Google integration. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_API_URL?: string;
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * True when running under `npm run dev`. (The request URL can't tell us: wrangler dev
 * rewrites it to the production route's hostname.)
 */
export function isLocalDev(env: Env): boolean {
  return env.LOCAL_DEV === 'true';
}

/**
 * Origins in ALLOWED_ORIGINS are always allowed. During local development
 * (API on localhost) any localhost origin and port is allowed too, so the
 * editor works on :3001 or 127.0.0.1. The deployed API never allows them.
 */
export function isOriginAllowed(env: Env, req: Request): boolean {
  return originOk(env, req.headers.get('Origin'));
}

/** Same rule as isOriginAllowed, for an origin string (e.g. an OAuth return URL). */
export function originOk(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  if (allowedOrigins(env).indexOf(origin) >= 0) return true;
  return isLocalDev(env) && LOCAL_ORIGIN.test(origin);
}
