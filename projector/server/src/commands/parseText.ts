// Turns dictated text ("wall timer ten minutes", "skip the song") into a
// structured Command. Rules run top to bottom; the first match wins.
// To support a new phrase, add a rule to RULES. Keep this file pure (no I/O)
// so it can be tested in isolation.

import type { Command } from '../../../shared/types';

// ---------- numbers and durations ----------

const UNITS: { [w: string]: number } = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: { [w: string]: number } = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "25", "2.5", "twenty five", "twenty-five", "a", "half" → number. */
function wordNumber(s: string): number | null {
  s = s.trim().replace(/-/g, ' ');
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if (s === 'half' || s === 'a half') return 0.5;
  if (s === 'quarter' || s === 'a quarter') return 0.25;
  const parts = s.split(/\s+/);
  let total = 0;
  let any = false;
  for (const p of parts) {
    if (p in UNITS) total += UNITS[p];
    else if (p in TENS) total += TENS[p];
    else if (p === 'and') continue;
    else return null;
    any = true;
  }
  return any ? total : null;
}

const NUM = String.raw`(\d+(?:\.\d+)?|(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|an?|half|a half|a quarter|quarter)`;
const UNIT = String.raw`(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b`;
const DURATION_PART = new RegExp(NUM + String.raw`\s*` + UNIT, 'g');

/** Sums every "<number> <unit>" in the text, plus "and a half" / "half an hour". Returns ms or null. */
export function parseDuration(text: string): number | null {
  let ms = 0;
  let found = false;
  let lastUnit = 0;
  const t = text.replace(/half an hour/g, '30 minutes').replace(/quarter of an hour|quarter hour/g, '15 minutes');
  DURATION_PART.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DURATION_PART.exec(t))) {
    const n = wordNumber(m[1]);
    if (n === null) continue;
    const u = m[2][0];
    lastUnit = u === 'h' ? 3600000 : u === 'm' ? 60000 : 1000;
    ms += n * lastUnit;
    found = true;
  }
  if (found && /and a half/.test(t)) ms += lastUnit / 2;
  if (!found) {
    // A bare number next to the word timer means minutes: "timer 10", "10 timer".
    const bare = new RegExp(String.raw`(?:timer|countdown)\s+(?:for\s+)?` + NUM + String.raw`$|^` + NUM + String.raw`\s+(?:timer|countdown)`).exec(t);
    const n = bare ? wordNumber(bare[1] || bare[2]) : null;
    if (n !== null) {
      ms = n * 60000;
      found = true;
    }
  }
  return found && ms > 0 ? Math.round(ms) : null;
}

// ---------- normalising ----------

/** Lowercase, strip wake words, politeness and punctuation. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?,;:"“”]/g, ' ')
    .replace(/^\s*(hey|ok|okay)\s+(siri|alexa|google)\b/, ' ')
    .replace(/^\s*(tell|ask)\s+(the\s+)?wall\s+(to\s+)?/, ' ')
    .replace(/^\s*(the\s+)?wall\b/, ' ')
    .replace(/\b(please|could you|can you|would you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text after the first matching lead-in, with the original casing kept. */
function tail(original: string, re: RegExp): string {
  const m = re.exec(original);
  return m ? original.slice(m.index + m[0].length).trim() : '';
}

// ---------- due dates (to-dos) ----------

const DUE = String.raw`(today|tonight|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))`;

/** "call mom tomorrow" → { text: "call mom", due: "tomorrow" }. */
function splitDue(text: string): { text: string; due?: string } {
  const m = new RegExp(String.raw`\s+(?:(?:due|by|on|for)\s+)?` + DUE + '$', 'i').exec(text);
  return m ? { text: text.slice(0, m.index).trim(), due: m[1].toLowerCase().replace(/\s+/g, ' ') } : { text: text.trim() };
}

function todoAdd(text: string, due?: string): Command | null {
  const t = text.replace(/^["“]|["”]$/g, '').trim();
  if (!t) return null;
  return due ? { type: 'todo.add', payload: { text: t, due: due.toLowerCase().replace(/\s+/g, ' ') } } : { type: 'todo.add', payload: { text: t } };
}

/** The original text (keeping its casing) without wake words or trailing punctuation. */
function stripLead(original: string): string {
  return original
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^\W*(hey|ok|okay)\s+(siri|alexa|google)\W*/i, '')
    .replace(/^(tell|ask)\s+(the\s+)?wall\s+(to\s+)?/i, '')
    .replace(/^(the\s+)?wall\s+/i, '')
    .replace(/^please\s+/i, '')
    .trim();
}

// ---------- rules ----------

interface Rule {
  /** Shown in docs/tests; not used at runtime. */
  example: string;
  /**
   * The match is a guess (e.g. a bare "pause" could mean the music or the timer).
   * With Jarvis on, loose matches go to the brain, which can see what's going on.
   */
  loose?: (t: string) => boolean;
  test: RegExp;
  build(t: string, original: string, m: RegExpExecArray): Command | null;
}

function timerLabel(t: string): string {
  const named = /\b(?:called|named|labell?ed|for)\s+(?!\d)([a-z][a-z ]{1,30}?)(?:\s+(?:timer|for)\b|$)/.exec(t);
  if (named && !/^(an?|the|half|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|minutes?|hours?|seconds?)\b/.test(named[1])) {
    return named[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/\bfocus\b/.test(t)) return 'Focus';
  if (/\bbreak\b/.test(t)) return 'Break';
  if (/\b(tea|coffee|laundry|oven|nap|study|workout|stretch)\b/.test(t)) {
    const w = /\b(tea|coffee|laundry|oven|nap|study|workout|stretch)\b/.exec(t)![1];
    return w[0].toUpperCase() + w.slice(1);
  }
  return '';
}

const RULES: Rule[] = [
  // ----- jarvis -----
  {
    example: 'good morning',
    test: /^(good morning|morning briefing|brief me|daily briefing|give me (a|my|the) (briefing|rundown)|what('s| does) my day look like)\b/,
    build: () => ({ type: 'jarvis.briefing' }),
  },

  // ----- timer -----
  {
    example: 'pomodoro',
    test: /\bpomodoro\b/,
    build: (t) => {
      if (/\b(stop|cancel|end|reset)\b/.test(t)) return { type: 'timer.reset' };
      return { type: 'timer.start', payload: { pomodoro: true } };
    },
  },
  {
    example: 'how much time is left',
    test: /\bhow (much|long)\b.*\b(left|remaining|to go)\b|\btime left\b/,
    build: () => ({ type: 'timer.status' }),
  },
  {
    example: 'pause the timer',
    test: /\b(pause|hold)\b.*\b(timer|countdown)\b|\b(timer|countdown)\b.*\bpause\b/,
    build: () => ({ type: 'timer.pause' }),
  },
  {
    example: 'resume the timer',
    test: /\b(resume|continue|unpause|restart)\b.*\b(timer|countdown)\b|\b(timer|countdown)\b.*\b(resume|continue)\b/,
    build: () => ({ type: 'timer.start' }),
  },
  {
    example: 'cancel the timer',
    test: /\b(stop|cancel|reset|clear|end|kill|turn off|remove|dismiss)\b.*\b(timer|countdown)\b|\b(timer|countdown)\b.*\b(off|stop|cancel|reset)\b/,
    build: () => ({ type: 'timer.reset' }),
  },
  {
    example: 'add 5 minutes',
    test: /^(add|plus|another|extend( the timer)?( by)?)\b/,
    build: (t) => {
      const ms = parseDuration(t);
      return ms ? { type: 'timer.add', payload: { minutes: ms / 60000 } } : null;
    },
  },
  // ----- messages (before timers: "show X for 30 seconds" is not a timer) -----
  {
    example: 'say dinner is ready',
    loose: (t) => !/^say\b/.test(t),
    test: /^(say|show|display|write|put up|post)\s+(?!(the\s+)?(wall|display|everything)$)(.+)$/,
    build: (t, original) => {
      let text = tail(original, /\b(say|show|display|write|put up|post)\s+/i);
      let seconds = 10;
      const dur = /\s+for\s+(.+?)$/i.exec(text);
      if (dur) {
        const ms = parseDuration(dur[1].toLowerCase());
        if (ms) {
          seconds = Math.round(ms / 1000);
          text = text.slice(0, dur.index);
        }
      }
      text = text.replace(/^["“]|["”.]$/g, '').trim();
      return text ? { type: 'text.say', payload: { text, seconds } } : null;
    },
  },
  {
    example: 'timer 10 minutes',
    test: /\b(timer|countdown)\b|\b(set|start)\b.*\d|\bfor \d+ (minutes?|hours?|seconds?)\b/,
    build: (t) => {
      const ms = parseDuration(t);
      if (!ms) return null;
      return { type: 'timer.start', payload: { minutes: ms / 60000, label: timerLabel(t) } };
    },
  },

  // ----- scenes -----
  {
    example: 'next scene',
    test: /^(next|previous|last) (scene|mode|preset)$|^(switch|go|change) to the (next|previous|last) (scene|mode|preset)$/,
    build: (t) => ({ type: /next/.test(t) ? 'scene.next' : 'scene.previous' }),
  },
  {
    example: 'what scenes do I have',
    test: /\bwhat (scenes|modes|presets)\b|\b(list|which) (the )?(scenes|modes|presets)\b|^(scenes|my scenes)$/,
    build: () => ({ type: 'scene.list' }),
  },
  {
    example: 'focus scene',
    test: /^(?:(?:switch|change|go|set|turn|put)\s+(?:it\s+)?(?:to|on)?\s*)?(?:the\s+)?(.+?)\s+(scene|mode|preset)$|^(?:scene|preset)\s+(.+)$/,
    build: (_t, _o, m) => {
      const name = (m[1] || m[3] || '').trim();
      return name ? { type: 'scene.set', payload: { name } } : null;
    },
  },

  // ----- display -----
  {
    example: 'blackout',
    test: /\b(black ?out|go dark|lights off|turn off|switch off|shut off|sleep|blank)\b(\s+(the\s+)?(wall|display|projector|screen))?$/,
    build: () => ({ type: 'display.blackout' }),
  },
  {
    example: 'wake up',
    test: /^(wake( up)?|lights on|turn on|switch on|come back|show (the )?(wall|display|everything)|unblank)\b/,
    build: () => ({ type: 'display.wake' }),
  },

  // ----- to-dos and calendar (before spotify: "what's next" is not "next song") -----
  {
    example: 'add buy milk to my list',
    test: new RegExp(String.raw`^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+|the\s+)?(?:to ?do|todo|to-do|task|tasks|list)(?:\s+list)?(?:\s+(?:(?:due|by|on|for)\s+)?` + DUE + ')?$'),
    build: (_t, original) => {
      const m = new RegExp(String.raw`^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+|the\s+)?(?:to ?do|todo|to-do|task|tasks|list)(?:\s+list)?(?:\s+(?:(?:due|by|on|for)\s+)?` + DUE + ')?$', 'i').exec(stripLead(original));
      if (!m) return null;
      return todoAdd(m[1], m[2]);
    },
  },
  {
    example: 'remind me to call mom tomorrow',
    test: new RegExp('^remind me (?:(?:on )?' + DUE + ' )?to\\s+(.+)$'),
    build: (_t, original) => {
      const m = new RegExp('^remind me (?:(?:on )?' + DUE + ' )?to\\s+(.+)$', 'i').exec(stripLead(original));
      if (!m) return null;
      const split = splitDue(m[2]);
      return todoAdd(split.text, m[1] || split.due);
    },
  },
  {
    example: 'complete buy milk',
    test: /^(?:complete|finish(?:ed)?|check off|cross off|tick off|mark)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed))?$|^(?:i\s+)?(?:did|done with|finished)\s+(.+)$/,
    build: (_t, _o, m) => {
      const text = (m[1] || m[2] || '').replace(/^(the|my)\s+/, '').trim();
      return text ? { type: 'todo.complete', payload: { text } } : null;
    },
  },
  {
    example: "what's on my list",
    test: /\bwhat('s| is)? on (my|the) (to ?do |todo |to-do |task )?(list|tasks)\b|\bread (me )?my (to ?do |todo |to-do )?(list|tasks)\b|\bwhat do i (have|need) to do\b|^(my )?(to ?do|todo|to-do) list$/,
    build: () => ({ type: 'todo.list' }),
  },
  {
    example: "what's on my calendar",
    test: /\bwhat('s| is)? on my (calendar|schedule|agenda)\b|\bwhat do i have (today|on today)\b|^(my )?(calendar|schedule|agenda)( today)?$/,
    build: () => ({ type: 'calendar.today' }),
  },
  {
    example: "what's next",
    test: /\bwhat('s| is) (up )?next\b|\bnext (event|meeting|class)\b|\bwhat('s| is) my next\b|\bwhen is my next\b/,
    build: () => ({ type: 'calendar.next' }),
  },

  // ----- spotify -----
  {
    example: 'skip the song',
    test: /\b(skip|next)\b(\s+(this|the))?(\s+(song|track|one))?$|\bnext (song|track)\b/,
    build: () => ({ type: 'spotify.next' }),
  },
  {
    example: 'previous song',
    test: /\b(previous|last|go back|back)\b\s*(song|track|one)?$/,
    build: () => ({ type: 'spotify.previous' }),
  },
  {
    example: "what's playing",
    test: /\bwhat('s| is)? (playing|this song|the song|song is this)\b|\bwhat song\b|\bwho is this\b|\bwho sings\b/,
    build: () => ({ type: 'spotify.status' }),
  },
  {
    example: 'turn it up',
    test: /^(turn (it|the music|this|spotify) (up|down)|louder|quieter|softer|crank it|volume (up|down))$/,
    build: (t) => ({ type: 'spotify.volume', payload: { delta: /up|louder|crank/.test(t) ? 10 : -10 } }),
  },
  {
    example: 'volume 40',
    test: /\bvolume\b/,
    build: (t) => {
      if (/\b(up|louder|raise|increase)\b/.test(t) && !/\d/.test(t)) return { type: 'spotify.volume', payload: { delta: 10 } };
      if (/\b(down|quieter|lower|decrease)\b/.test(t) && !/\d/.test(t)) return { type: 'spotify.volume', payload: { delta: -10 } };
      const m = /(\d+)/.exec(t);
      if (m) return { type: 'spotify.volume', payload: { percent: Math.max(0, Math.min(100, +m[1])) } };
      const n = /volume (?:to )?([a-z -]+?)(?: percent)?$/.exec(t);
      const v = n ? wordNumber(n[1]) : null;
      return v !== null ? { type: 'spotify.volume', payload: { percent: Math.max(0, Math.min(100, v)) } } : null;
    },
  },
  {
    example: 'pause the music',
    loose: (t) => !/(music|song|spotify|playback|track)/.test(t),
    test: /^(pause|stop)(\s+(the\s+)?(music|song|spotify|playback|track))?$/,
    build: () => ({ type: 'spotify.pause' }),
  },
  {
    example: 'play music',
    loose: (t) => !/(music|song|spotify|playback|track)/.test(t),
    test: /^(play|resume|unpause)(\s+(the\s+)?(music|song|spotify|playback|track))?$/,
    build: () => ({ type: 'spotify.play' }),
  },

];

/** Parses free text into a command, or null if nothing matched. */
export function parseText(input: string): Command | null {
  return parseTextDetailed(input).command;
}

/** Like parseText, plus whether the match was only a guess (see Rule.loose). */
export function parseTextDetailed(input: string): { command: Command | null; loose: boolean } {
  const t = normalize(input);
  if (!t) return { command: null, loose: false };
  // "focus mode, 25 minute timer and pause the music" is several requests; one rule would catch only one.
  const several = /[,;]/.test(input) || /\band\b(?! a half)/.test(t);
  for (const rule of RULES) {
    const m = rule.test.exec(t);
    if (!m) continue;
    const cmd = rule.build(t, input.trim(), m);
    if (cmd) return { command: cmd, loose: several || !!(rule.loose && rule.loose(t)) };
  }
  return { command: null, loose: false };
}

/** Example phrases, one per rule (used by the tests and the docs). */
export const EXAMPLES = RULES.map((r) => r.example);
