// Calls a Workers AI model through the `AI` binding. For local testing (where
// the binding needs a Cloudflare login), AI_MOCK_URL points at a stand-in that
// receives { model, input } and answers like the binding would.

import type { Env } from '../env';

export function aiAvailable(env: Env): boolean {
  return !!(env.AI || env.AI_MOCK_URL);
}

export async function aiRun(env: Env, model: string, input: Record<string, unknown>): Promise<any> {
  if (env.AI_MOCK_URL) {
    const res = await fetch(env.AI_MOCK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) throw new Error('AI mock returned ' + res.status);
    return res.json();
  }
  if (!env.AI) throw new Error('Workers AI is not available (missing [ai] binding).');
  return env.AI.run(model as any, input as any);
}
