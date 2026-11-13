// Asks the configured model for a plan. Workers AI (free, open models on
// Cloudflare) or Claude (paid, needs ANTHROPIC_API_KEY). Never throws: returns
// a plan or an error string.

import Anthropic from '@anthropic-ai/sdk';
import type { JarvisSettings, MemoryFact } from '../../../shared/jarvis';
import type { Env } from '../env';
import { aiAvailable, aiRun } from './ai';
import { parsePlan, type Plan } from './plan';
import { systemPrompt, userMessage, type Exchange } from './prompt';

export type ThinkResult = { plan: Plan; ms: number } | { error: string; ms: number };

export function brainReady(s: JarvisSettings, env: Env): string | null {
  if (s.provider === 'off') return 'Jarvis is off.';
  if (s.provider === 'workers-ai' && !aiAvailable(env)) return 'Workers AI is not available on this server.';
  if (s.provider === 'claude' && !env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY is not set on the server.';
  return null;
}

export async function think(s: JarvisSettings, env: Env, request: string, context: string, memory: Exchange[], facts: MemoryFact[] = []): Promise<ThinkResult> {
  const started = Date.now();
  const notReady = brainReady(s, env);
  if (notReady) return { error: notReady, ms: 0 };
  const system = systemPrompt(s, facts);
  const user = userMessage(request, context, memory);
  try {
    const raw = s.provider === 'claude' ? await askClaude(s, env, system, user) : await askWorkersAI(s, env, system, user);
    const plan = parsePlan(raw);
    if (!plan) return { error: 'The model answered in a format I could not use.', ms: Date.now() - started };
    return { plan, ms: Date.now() - started };
  } catch (e: any) {
    return { error: (e && e.message) || 'The model call failed.', ms: Date.now() - started };
  }
}

/** Free-form text from the model (used for the briefing). */
export async function write(s: JarvisSettings, env: Env, instruction: string): Promise<string | null> {
  if (brainReady(s, env)) return null;
  const system = 'You are ' + s.name + ', the calm, dry-witted voice of a projector wall. Write exactly what to say aloud: plain sentences, no markdown, no lists, no emoji.';
  try {
    const raw = s.provider === 'claude' ? await askClaude(s, env, system, instruction) : await askWorkersAI(s, env, system, instruction);
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text ? text.slice(0, 900) : null;
  } catch (e) {
    return null;
  }
}

async function askWorkersAI(s: JarvisSettings, env: Env, system: string, user: string): Promise<unknown> {
  const out = await aiRun(env, s.workersModel, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 500,
    temperature: 0.2,
  });
  // Text-generation models answer { response: string }; some return the parsed JSON object directly.
  return out && out.response !== undefined ? out.response : out;
}

async function askClaude(s: JarvisSettings, env: Env, system: string, user: string): Promise<unknown> {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.CLAUDE_MOCK_URL || undefined,
    timeout: 30_000,
    maxRetries: 1,
  });
  // Opus/Sonnet 5.5: opt into server-side refusal fallbacks (Haiku 5.5 has none).
  const fallback = s.claudeModel.indexOf('haiku') < 0;
  const params: any = {
    model: s.claudeModel,
    max_tokens: 2048,
    // Commands are a light task; low effort keeps the wall snappy.
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  if (fallback) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const response: any = fallback ? await client.beta.messages.create(params) : await client.messages.create(params);
  if (response.stop_reason === 'refusal') throw new Error('Claude declined that request.');
  let text = '';
  for (const block of response.content || []) if (block.type === 'text') text += block.text;
  return text;
}
