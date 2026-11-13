import { apiBase } from '../shared/client';

/** JSON call to the wall API with the editor session cookie. */
export async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(apiBase() + path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
