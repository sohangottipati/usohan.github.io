// Run with `npm test` in projector/server.
import { eventCost, recordUsage } from '../../shared/usage';
import { buildContext } from '../src/jarvis/context';
import { defaultJarvisSettings } from '../../shared/jarvis';
import { defaultLiveState, type Project } from '../../shared/types';

let failed = 0;
function ok(cond: boolean, what: string) {
  if (!cond) {
    failed++;
    console.log('FAIL', what);
  }
}

// Cost: Opus 5.5 at $4 in / $20 out per million.
const opus = { provider: 'claude' as const, model: 'claude-opus-5-5', kind: 'think' as const, tokensIn: 1_000_000, tokensOut: 100_000, ok: true };
ok(Math.abs(eventCost(opus) - 6) < 1e-9, 'opus cost 1M in + 100k out = $6');
ok(eventCost({ ...opus, provider: 'workers-ai' }) === 0, 'workers AI is free');
ok(Math.abs(eventCost({ ...opus, tokensIn: 0, tokensOut: 0, cacheRead: 1_000_000 }) - 0.2) < 1e-9, 'cache reads $0.20/M');

// Totals, split and day/month rollover.
let u = recordUsage(null, opus, '2026-11-13', 1);
u = recordUsage(u, { provider: 'workers-ai', model: 'm', kind: 'speech', tokensIn: 0, tokensOut: 0, ok: true }, '2026-11-13', 2);
ok(u.today.calls === 2 && u.today.speech === 1 && u.todayClaude.calls === 1 && u.todayWorkers.calls === 1, 'today counts and split');
u = recordUsage(u, { ...opus, ok: false, tokensIn: 0, tokensOut: 0 }, '2026-11-14', 3);
ok(u.today.calls === 1 && u.today.errors === 1 && u.thisMonth.calls === 3, 'new day resets today, keeps month');
u = recordUsage(u, opus, '2026-12-01', 4);
ok(u.thisMonth.calls === 1 && Math.abs(u.thisMonth.costUsd - 6) < 1e-9, 'new month resets month');

// Context: honest about Canvas and marks classes.
const project = { scenes: [{ id: 's', name: 'Default', layers: [] }], activeSceneId: 's' } as unknown as Project;
const now = Date.parse('2026-11-13T18:00:00Z');
const live = defaultLiveState();
const s = defaultJarvisSettings();
let ctx = buildContext(live, project, now, 'America/Los_Angeles');
ok(/Canvas \(coursework\): not connected/.test(ctx), 'canvas not connected is stated');
live.canvas = { items: [], fetchedAt: now, error: 'Canvas answered 403.' };
live.calendar = {
  fetchedAt: now,
  error: null,
  events: [{ id: 'e', title: 'CS 100 Lecture', start: '2026-11-13T19:00:00Z', end: '2026-11-13T20:00:00Z', allDay: false, location: '', color: '#fff', calendar: 'Main' } as any],
};
ctx = buildContext(live, project, now, 'America/Los_Angeles', [], { ...s.classMode, enabled: true });
ok(/couldn't load \(Canvas answered 403\.\)/.test(ctx), 'canvas error is stated');
ok(/CS 100 Lecture \[class\]/.test(ctx), 'class events are marked');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('usage: all passed');
