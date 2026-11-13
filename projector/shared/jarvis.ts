// Jarvis (the wall's assistant) settings, shared by the editor and the server.

export type BrainProvider = 'off' | 'workers-ai' | 'claude';

/** A fact Sohan asked Jarvis to remember ("remember that…"). */
export interface MemoryFact {
  id: string;
  text: string;
  at: number;
}

/** A routine step: run a wall phrase, say something aloud, or wait. */
export interface RoutineStep {
  kind: 'do' | 'speak' | 'wait';
  /** do: a phrase like "sleep mode"; speak: words; wait: minutes */
  value: string;
}

export interface Routine {
  id: string;
  name: string;
  /** What you say to run it ("goodnight", "good night"). */
  phrases: string[];
  steps: RoutineStep[];
}

export const MAX_ROUTINES = 20;
export const MAX_ROUTINE_STEPS = 15;

/** Starter routines, offered (not forced) in the editor. */
export function starterRoutines(): Omit<Routine, 'id'>[] {
  return [
    {
      name: "I'm home",
      phrases: ["i'm home", 'im home', "i'm back"],
      steps: [
        { kind: 'do', value: 'wake up' },
        { kind: 'do', value: 'default mode' },
        { kind: 'do', value: 'play music' },
        { kind: 'speak', value: 'Welcome back.' },
        { kind: 'do', value: 'brief me' },
      ],
    },
    {
      name: 'Goodnight',
      phrases: ['goodnight', 'good night', 'going to bed'],
      steps: [
        { kind: 'do', value: 'sleep mode' },
        { kind: 'do', value: 'volume 25' },
        { kind: 'speak', value: 'Goodnight. Going dark in ten minutes.' },
        { kind: 'wait', value: '10' },
        { kind: 'do', value: 'pause the music' },
        { kind: 'do', value: 'blackout' },
      ],
    },
  ];
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
  /** Show Siri/API requests and their replies on the wall. */
  showReplies: boolean;
  briefing: boolean;
  /** "07:30", local to timeZone. */
  briefingTime: string;
  timeZone: string;
  /** Lat/lon for the briefing's weather. */
  location: { name: string; lat: number; lon: number };
  announceTimers: boolean;
  announceEvents: boolean;
  eventLeadMinutes: number;
  /** "HW 3 is due in 3 hours and isn't submitted." */
  announceDeadlines: boolean;
  deadlineLeadHours: number;
  classMode: ClassModeSettings;
  /** Work sessions ("start working on HW 3"): daily study goal, and a scene to switch to (optional). */
  studyGoalMinutes: number;
  focusScene: string;
}

export interface ClassModeSettings {
  enabled: boolean;
  /** Calendars whose events are classes, comma-separated names (e.g. "School, UCR"). */
  calendars: string;
  /** Also treat events titled like a course ("CS 100", "MATH 10A") as classes. */
  courseCodes: boolean;
  /** Scene to switch to during class ('' = don't switch). */
  scene: string;
  /** No spoken replies or announcements during class. */
  quiet: boolean;
}

export type ClassKind = 'lecture' | 'lab' | 'discussion' | 'class';

// Meetings and everything else that happens to mention a course ("CS 100 office
// hours", "lab meeting", "CS 100 study group") are not classes.
const NOT_CLASS = /\b(meeting|meetings|mtg|standup|stand-up|sync|1:1|1-on-1|one on one|interview|call|office hours?|club|practice|shift|appointment|appt|coffee|lunch|dinner|party|birthday|gym|workout|study group|tutoring session|review session|exam|midterm|final|quiz|due|deadline)\b/i;
const KINDS: [ClassKind, RegExp][] = [
  ['lab', /\b(lab|labs|laboratory)\b/i],
  ['discussion', /\b(dis|disc|discussion|discussions|recitation|section|sect)\b/i],
  ['lecture', /\b(lec|lect|lecture|lectures)\b/i],
  ['class', /\b(seminar|studio|tutorial|class)\b/i],
];
const COURSE_CODE = /\b[A-Z]{2,5}\s?\d{1,3}[A-Z]{0,2}\b/;

/**
 * Is this calendar event a class (a lecture, lab or discussion), and which kind?
 * Meetings, office hours, exams and all-day events never are.
 */
export function classKind(e: { title: string; calendar: string; allDay: boolean }, c: ClassModeSettings): ClassKind | null {
  if (e.allDay || NOT_CLASS.test(e.title)) return null;
  for (const [kind, re] of KINDS) if (re.test(e.title)) return kind;
  const cals = c.calendars
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (cals.length && cals.some((x) => e.calendar.toLowerCase().indexOf(x) >= 0)) return 'class';
  return c.courseCodes && COURSE_CODE.test(e.title) ? 'class' : null;
}

/** Does this calendar event look like a class? */
export function isClassEvent(e: { title: string; calendar: string; allDay: boolean }, c: ClassModeSettings): boolean {
  return classKind(e, c) !== null;
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
    showReplies: true,
    briefing: false,
    briefingTime: '07:30',
    timeZone: 'America/Los_Angeles',
    location: { name: 'Riverside, CA', lat: 33.9533, lon: -117.3962 },
    announceTimers: true,
    announceEvents: true,
    eventLeadMinutes: 10,
    announceDeadlines: true,
    deadlineLeadHours: 3,
    classMode: { enabled: false, calendars: '', courseCodes: true, scene: '', quiet: true },
    studyGoalMinutes: 120,
    focusScene: '',
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
    showReplies: bool(s.showReplies, d.showReplies),
    briefing: bool(s.briefing, d.briefing),
    briefingTime: /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.briefingTime) ? s.briefingTime : d.briefingTime,
    timeZone: isTimeZone(s.timeZone) ? s.timeZone : d.timeZone,
    location: { name: str(loc.name, d.location.name, 80), lat: +loc.lat, lon: +loc.lon },
    announceTimers: bool(s.announceTimers, d.announceTimers),
    announceEvents: bool(s.announceEvents, d.announceEvents),
    eventLeadMinutes: num(s.eventLeadMinutes, d.eventLeadMinutes, 1, 120),
    announceDeadlines: bool(s.announceDeadlines, d.announceDeadlines),
    deadlineLeadHours: num(s.deadlineLeadHours, d.deadlineLeadHours, 1, 72),
    classMode: (() => {
      const c = s.classMode && typeof s.classMode === 'object' ? s.classMode : {};
      return {
        enabled: bool(c.enabled, d.classMode.enabled),
        calendars: typeof c.calendars === 'string' ? c.calendars.slice(0, 200) : '',
        courseCodes: bool(c.courseCodes, d.classMode.courseCodes),
        scene: typeof c.scene === 'string' ? c.scene.slice(0, 60) : '',
        quiet: bool(c.quiet, d.classMode.quiet),
      };
    })(),
    studyGoalMinutes: num(s.studyGoalMinutes, d.studyGoalMinutes, 0, 960),
    focusScene: typeof s.focusScene === 'string' ? s.focusScene.slice(0, 60) : '',
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
