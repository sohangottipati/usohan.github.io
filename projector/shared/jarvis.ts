// Jarvis (the wall's assistant) settings, shared by the editor and the server.

export type BrainProvider = 'off' | 'workers-ai' | 'claude';

/** A fact Sohan asked Jarvis to remember ("remember that…"). */
export interface MemoryFact {
  id: string;
  text: string;
  at: number;
}

// Everything here is sent with every brain request, so it's capped.
export const MAX_FACTS = 50;
export const MAX_FACT_CHARS = 300;
export const MAX_MEMORY_CHARS = 3000;
export const MAX_ABOUT_ME_CHARS = 1000;
export type VoiceMode = 'off' | 'announcements' | 'all';

export interface JarvisSettings {
  /** Who understands requests the built-in phrases don't. */
  provider: BrainProvider;
  workersModel: string;
  claudeModel: string;
  name: string;
  /** Extra personality / house rules, appended to the system prompt. */
  personality: string;
  /** Standing facts about Sohan (school, routines, preferences). */
  aboutMe: string;
  /** How long Jarvis remembers the conversation, for follow-ups like "make that 30". */
  memoryMinutes: number;
  /** Speak replies through the projector: never, only for announcements, or every reply. */
  voice: VoiceMode;
  voiceModel: string;
  /** Also show spoken replies / announcements as text on the wall. */
  captions: boolean;
  briefing: boolean;
  /** "07:30", local to timeZone. */
  briefingTime: string;
  timeZone: string;
  /** Lat/lon for the briefing's weather. */
  location: { name: string; lat: number; lon: number };
  announceTimers: boolean;
  announceEvents: boolean;
  eventLeadMinutes: number;
}

export const WORKERS_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

export function defaultJarvisSettings(): JarvisSettings {
  return {
    provider: 'off',
    workersModel: WORKERS_MODELS[0],
    claudeModel: CLAUDE_MODELS[0],
    name: 'Jarvis',
    personality: '',
    aboutMe: '',
    memoryMinutes: 5,
    voice: 'announcements',
    voiceModel: '@cf/myshell-ai/melotts',
    captions: false,
    briefing: false,
    briefingTime: '07:30',
    timeZone: 'America/Los_Angeles',
    location: { name: 'Riverside, CA', lat: 33.9533, lon: -117.3962 },
    announceTimers: true,
    announceEvents: true,
    eventLeadMinutes: 10,
  };
}

/** Clamp and fill a settings object from untrusted input. */
export function sanitizeJarvisSettings(input: any): JarvisSettings {
  const d = defaultJarvisSettings();
  const s = input && typeof input === 'object' ? input : {};
  const str = (v: any, fallback: string, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
  const num = (v: any, fallback: number, min: number, max: number) => (typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
  const bool = (v: any, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const loc = s.location && typeof s.location === 'object' && isFinite(s.location.lat) && isFinite(s.location.lon) ? s.location : d.location;
  return {
    provider: ['off', 'workers-ai', 'claude'].indexOf(s.provider) >= 0 ? s.provider : d.provider,
    workersModel: str(s.workersModel, d.workersModel, 120),
    claudeModel: str(s.claudeModel, d.claudeModel, 80),
    name: str(s.name, d.name, 30),
    personality: typeof s.personality === 'string' ? s.personality.slice(0, 1500) : '',
    aboutMe: typeof s.aboutMe === 'string' ? s.aboutMe.slice(0, MAX_ABOUT_ME_CHARS) : '',
    memoryMinutes: num(s.memoryMinutes, d.memoryMinutes, 0, 60),
    voice: ['off', 'announcements', 'all'].indexOf(s.voice) >= 0 ? s.voice : d.voice,
    voiceModel: str(s.voiceModel, d.voiceModel, 120),
    captions: bool(s.captions, d.captions),
    briefing: bool(s.briefing, d.briefing),
    briefingTime: /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.briefingTime) ? s.briefingTime : d.briefingTime,
    timeZone: isTimeZone(s.timeZone) ? s.timeZone : d.timeZone,
    location: { name: str(loc.name, d.location.name, 80), lat: +loc.lat, lon: +loc.lon },
    announceTimers: bool(s.announceTimers, d.announceTimers),
    announceEvents: bool(s.announceEvents, d.announceEvents),
    eventLeadMinutes: num(s.eventLeadMinutes, d.eventLeadMinutes, 1, 120),
  };
}

function isTimeZone(tz: any): boolean {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}
