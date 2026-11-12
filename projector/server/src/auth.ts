// Editor sessions: an HMAC-signed, HTTP-only cookie. No session storage needed.

export const SESSION_COOKIE = 'wall_session';
const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i % ab.length] || 0) ^ (bb[i % bb.length] || 0);
  return diff === 0;
}

export function randomToken(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function createSession(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return exp + '.' + (await hmac(secret, 'editor.' + exp));
}

export async function verifySession(secret: string, value: string | null): Promise<boolean> {
  if (!value || !secret) return false;
  const dot = value.indexOf('.');
  if (dot < 0) return false;
  const exp = Number(value.slice(0, dot));
  if (!isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(value.slice(dot + 1), await hmac(secret, 'editor.' + exp));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * SameSite=None so the cookie also works while the API is on a different site
 * (e.g. *.workers.dev during setup). Once the API is on projector-api.sohan.website
 * it is same-site with the editor and every browser sends it.
 */
export function sessionCookie(value: string, maxAgeSeconds = SESSION_DAYS * 86400): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSeconds}`;
}

export async function isEditor(req: Request, secret: string): Promise<boolean> {
  return verifySession(secret, readCookie(req, SESSION_COOKIE));
}
