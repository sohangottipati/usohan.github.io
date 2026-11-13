// Text-to-speech through Workers AI (MeloTTS by default: about 19 neurons per
// minute of audio, so speech barely touches the free daily allowance).

import type { JarvisSettings } from '../../../shared/jarvis';
import type { Env } from '../env';
import { aiAvailable, aiRun } from './ai';
import type { UsageSink } from './brain';

export interface Speech {
  /** base64-encoded audio */
  audio: string;
  mime: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Spoken audio for `text`, or null if voice isn't available. Never throws. */
export async function synthesize(s: JarvisSettings, env: Env, text: string, track?: UsageSink): Promise<Speech | null> {
  if (!aiAvailable(env) || !text.trim()) return null;
  const report = (ok: boolean) => track && track({ provider: 'workers-ai', model: s.voiceModel, kind: 'speech', tokensIn: 0, tokensOut: 0, ok });
  try {
    const out = await aiRun(env, s.voiceModel, { prompt: text.slice(0, 600), text: text.slice(0, 600), lang: 'en' });
    let speech: Speech | null = null;
    if (out && typeof out.audio === 'string') speech = { audio: out.audio, mime: 'audio/mpeg' };
    else if (out instanceof ArrayBuffer) speech = { audio: toBase64(new Uint8Array(out)), mime: 'audio/mpeg' };
    else if (out instanceof Uint8Array) speech = { audio: toBase64(out), mime: 'audio/mpeg' };
    else if (out && typeof out.getReader === 'function') speech = { audio: toBase64(await streamToBytes(out)), mime: 'audio/mpeg' };
    report(!!speech);
    return speech;
  } catch (e) {
    report(false);
    return null;
  }
}
