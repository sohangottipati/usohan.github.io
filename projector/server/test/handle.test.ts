// Run with `npm test` in projector/server.
import { defaultLiveState, defaultProject, timerRemaining, type LiveState } from '../../shared/types';
import { advanceTimer, runCommand, speakDuration } from '../src/commands/handle';

let failed = 0;
function eq(name: string, got: any, want: any) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
}

const project = { ...defaultProject(), scenes: [{ id: 'default', name: 'Default', layers: [] }, { id: 'f', name: 'Focus', layers: [] }] };
let live: LiveState = defaultLiveState();
let now = 1_000_000;
function run(type: string, payload?: any) {
  const out = runCommand({ type, payload }, { live, project, now });
  if (out.live) live = out.live;
  return out;
}

eq('speak 25m', speakDuration(25 * 60000), '25 minutes');
eq('speak 90m', speakDuration(90 * 60000), '1 hour and 30 minutes');
eq('speak 75s', speakDuration(75000), '1 minute and 15 seconds');

eq('start', run('timer.start', { minutes: 10, label: '' }).result.reply, 'Timer set for 10 minutes.');
now += 4 * 60000;
eq('status', run('timer.status').result.reply, '6 minutes left.');
eq('pause', run('timer.pause').result.reply, 'Timer paused with 6 minutes left.');
now += 60 * 60000; // paused time doesn't count
eq('paused remaining', timerRemaining(live.timer, now), 6 * 60000);
eq('resume', run('timer.start').result.reply, 'Timer resumed. 6 minutes left.');
eq('add', run('timer.add', { minutes: 5 }).result.reply, 'Added 5 minutes. 11 minutes left.');
eq('reset', run('timer.reset').result.reply, 'Timer cancelled.');
eq('reset idle', run('timer.reset').result.reply, "There's no timer to cancel.");
eq('start no duration', run('timer.start').result.ok, false);
eq('too long', run('timer.start', { minutes: 60 * 25 }).result.ok, false);
eq('label', run('timer.start', { minutes: 4, label: 'Tea' }).result.reply, 'Tea timer set for 4 minutes.');

// Pomodoro rolls over: focus → break → focus; every 4th break is long.
run('timer.start', { pomodoro: true });
eq('pomo label', live.timer.label, 'Focus');
eq('no advance early', advanceTimer(live, now + 1000), null);
now = live.timer.endsAt;
live = advanceTimer(live, now)!;
eq('break', [live.timer.label, live.timer.durationMs, live.timer.pomodoro!.round], ['Break', 5 * 60000, 1]);
now = live.timer.endsAt;
live = advanceTimer(live, now)!;
eq('focus again', live.timer.label, 'Focus');
for (let i = 0; i < 5; i++) { now = live.timer.endsAt; live = advanceTimer(live, now)!; }
eq('long break on round 4', [live.timer.label, live.timer.pomodoro!.round], ['Long break', 4]);
eq('plain timers do not roll', advanceTimer({ ...live, timer: { ...live.timer, pomodoro: null } }, now + 1e9), null);

eq('blackout', run('display.blackout').live!.blackout, true);
eq('wake', run('display.wake').result.reply, 'Wall is back on.');
const say = run('text.say', { text: 'Dinner!', seconds: 30 });
eq('say', [live.message!.text, live.message!.until - now], ['Dinner!', 30000]);
eq('scene', runCommand({ type: 'scene.set', payload: { name: 'foc' } }, { live, project, now }).project!.activeSceneId, 'f');
eq('scene missing', runCommand({ type: 'scene.set', payload: { name: 'party' } }, { live, project, now }).result.reply, "There's no party scene. You have Default, Focus.");
eq('todo later', run('todo.add', { text: 'x' }).result, { ok: false, reply: "To-dos aren't set up yet." });
eq('unknown', run('nope').result.ok, false);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('handle: all passed');
