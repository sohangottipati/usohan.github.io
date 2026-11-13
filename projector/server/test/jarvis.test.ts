// Run with `npm test` in projector/server.
import { defaultLiveState, defaultProject } from '../../shared/types';
import { sanitizeJarvisSettings } from '../../shared/jarvis';
import { parseTextDetailed } from '../src/commands/parseText';
import { buildContext } from '../src/jarvis/context';
import { extractJson, parsePlan } from '../src/jarvis/plan';
import { localDate, nextDailyTime } from '../src/jarvis/time';
import { addFact, cleanFact, forgetFact, listFacts } from '../src/jarvis/memory';
import { systemPrompt } from '../src/jarvis/prompt';
import { defaultJarvisSettings } from '../../shared/jarvis';

let failed = 0;
function eq(name: string, got: any, want: any) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
}

// ----- plans -----
eq('plain json', parsePlan('{"commands":[{"type":"timer.start","payload":{"minutes":12,"label":"Pizza"}}],"reply":"Pizza timer, twelve minutes."}'), {
  commands: [{ type: 'timer.start', payload: { minutes: 12, label: 'Pizza' } }],
  reply: 'Pizza timer, twelve minutes.',
});
eq('fenced + prose', parsePlan('Sure!\n```json\n{"commands": [], "reply": "You have a {free} hour."}\n```'), { commands: [], reply: 'You have a {free} hour.' });
eq('object response', parsePlan({ commands: [{ type: 'display.blackout' }], reply: 'Lights out.' }), { commands: [{ type: 'display.blackout' }], reply: 'Lights out.' });
eq('unknown types dropped', parsePlan('{"commands":[{"type":"rm.rf"},{"type":"spotify.next"}],"reply":"ok"}'), { commands: [{ type: 'spotify.next' }], reply: 'ok' });
eq('bad payload dropped', parsePlan('{"commands":[{"type":"spotify.next","payload":"x"}],"reply":""}'), { commands: [{ type: 'spotify.next' }], reply: '' });
eq('plain words', parsePlan('It is two fifteen.'), { commands: [], reply: 'It is two fifteen.' });
eq('garbage', parsePlan('{not json'), null);
eq('capped', parsePlan({ commands: new Array(10).fill({ type: 'timer.status' }), reply: '' })!.commands.length, 6);
eq('nested braces', extractJson('x {"a":{"b":"}"},"c":1} y'), { a: { b: '}' }, c: 1 });

// ----- time -----
const LA = 'America/Los_Angeles';
const t0 = Date.parse('2026-11-13T15:00:00Z'); // 7:00 AM PST
eq('briefing later today', new Date(nextDailyTime(t0, '07:30', LA)).toISOString(), '2026-11-13T15:30:00.000Z');
eq('briefing tomorrow', new Date(nextDailyTime(t0, '06:00', LA)).toISOString(), '2026-11-14T14:00:00.000Z');
eq('across DST (Nov 1 2026)', new Date(nextDailyTime(Date.parse('2026-10-31T16:00:00Z'), '07:30', LA)).toISOString(), '2026-11-01T15:30:00.000Z');
eq('local date', localDate(Date.parse('2026-11-14T07:00:00Z'), LA), '2026-11-13');

// ----- settings -----
eq('sanitize junk', sanitizeJarvisSettings({ provider: 'gpt', briefingTime: '25:99', timeZone: 'Mars/Base', memoryMinutes: 999 }).provider, 'off');
eq('sanitize clamps', sanitizeJarvisSettings({ memoryMinutes: 999 }).memoryMinutes, 60);
eq('sanitize tz', sanitizeJarvisSettings({ timeZone: 'Mars/Base' }).timeZone, 'America/Los_Angeles');

// ----- context -----
const live = { ...defaultLiveState(), timer: { status: 'running' as const, label: 'Tea', durationMs: 240000, endsAt: t0 + 120000, remainingMs: 0, pomodoro: null } };
const ctx = buildContext(live, defaultProject(), t0, LA);
eq('context has timer', /Timer: Tea timer, 2 min left/.test(ctx), true);
eq('context has scenes', /Scenes: Default \(on\)/.test(ctx), true);
eq('context says not connected', /Spotify: not connected/.test(ctx), true);

// ----- loose parser matches go to the brain -----
eq('say is confident', parseTextDetailed('say dinner is ready').loose, false);
eq('show is a guess', parseTextDetailed('show me something cool').loose, true);
eq('bare pause is a guess', parseTextDetailed('pause').loose, true);
eq('pause the music is confident', parseTextDetailed('pause the music').loose, false);
eq('timer is confident', parseTextDetailed('timer 10 minutes').loose, false);
eq('briefing phrase', parseTextDetailed('good morning').command, { type: 'jarvis.briefing' });
eq('several requests go to the brain', parseTextDetailed('focus mode, 25 minute timer and pause the music').loose, true);
eq('and a half is still one request', parseTextDetailed('timer for an hour and a half').loose, false);
eq('unknown', parseTextDetailed("my pizza's done in like 12 minutes").command, null);

// ----- long-term memory -----
eq('clean', cleanFact('that my mom’s birthday is March 3.'), 'My mom’s birthday is March 3');
let facts: any[] = [];
let o = addFact(facts, "that my mom's birthday is March 3", 1, 'a');
eq('add', [o.ok, o.facts.length, o.facts[0].text], [true, 1, "My mom's birthday is March 3"]);
facts = o.facts;
eq('duplicate', addFact(facts, "My mom's birthday is March 3!", 2, 'b').reply, 'I already know that.');
facts = addFact(facts, 'pizza means a 12 minute oven timer', 3, 'c').facts;
eq('forget fuzzy', forgetFact(facts, 'the pizza thing').facts.map((f) => f.id), ['a']);
eq('forget missing', forgetFact(facts, 'my car').ok, false);
eq('forget by words', forgetFact(facts, "mom's birthday").facts.map((f) => f.id), ['c']);
eq('forget needs real overlap', forgetFact(facts, 'the oven in my apartment kitchen').ok, false);
let full: any[] = [];
for (let i = 0; i < 50; i++) full = addFact(full, 'Fact number ' + i, i, 'f' + i).facts;
eq('cap by count', addFact(full, 'one more', 99, 'x').ok, false);
eq('cap by size', addFact([{ id: 'big', text: 'x'.repeat(2990), at: 0 }], 'a long-ish fact here', 1, 'y').ok, false);
eq('list', /2 facts/.test(listFacts(facts, '').reply), true);
eq('list empty', /Nothing yet/.test(listFacts([], '').reply), true);
const sp = systemPrompt({ ...defaultJarvisSettings(), aboutMe: 'UCR student' }, facts);
eq('prompt includes facts', sp.indexOf("- My mom's birthday is March 3") > 0 && sp.indexOf('About Sohan (from him):\nUCR student') > 0, true);
eq('remember phrase', parseTextDetailed("Remember that my mom's birthday is March 3").command, { type: 'memory.save', payload: { text: "my mom's birthday is March 3" } });
eq('remember to → not memory', parseTextDetailed('remember to buy milk').command === null || parseTextDetailed('remember to buy milk').command!.type !== 'memory.save', true);
eq('forget phrase', parseTextDetailed('forget the thing about pizza').command, { type: 'memory.forget', payload: { text: 'pizza' } });
eq('list phrase', parseTextDetailed('what do you know about me').command, { type: 'memory.list' });

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('jarvis: all passed');
