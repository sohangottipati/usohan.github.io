// Run with `npm test` in projector/server.
import { EXAMPLES, parseDuration, parseText } from '../src/commands/parseText';

let failed = 0;
function check(input: string, expected: any) {
  const got = parseText(input);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log('FAIL', JSON.stringify(input), '\n  got     ', JSON.stringify(got), '\n  expected', JSON.stringify(expected));
  }
}
const timer = (minutes: number, label = '') => ({ type: 'timer.start', payload: { minutes, label } });

// timers
check('wall timer 10 minutes', timer(10));
check('Wall timer ten minutes.', timer(10));
check('Hey Siri wall timer 10 minutes', timer(10));
check('set a timer for 25 minutes', timer(25));
check('start a 5 minute timer', timer(5));
check('timer for an hour and a half', timer(90));
check('timer 1 hour 30 minutes', timer(90));
check('timer for half an hour', timer(30));
check('timer 90 seconds', timer(1.5));
check('timer twenty five minutes', timer(25));
check('timer twenty-five minutes', timer(25));
check('timer 10', timer(10));
check('focus timer 25 minutes', timer(25, 'Focus'));
check('set a 4 minute tea timer', timer(4, 'Tea'));
check('timer 20 minutes called laundry', timer(20, 'Laundry'));
check('timer for 15 minutes', timer(15));
check('pause the timer', { type: 'timer.pause' });
check('resume the timer', { type: 'timer.start' });
check('stop the timer', { type: 'timer.reset' });
check('cancel timer', { type: 'timer.reset' });
check('add 5 minutes', { type: 'timer.add', payload: { minutes: 5 } });
check('how much time is left', { type: 'timer.status' });
check('start a pomodoro', { type: 'timer.start', payload: { pomodoro: true } });
check('stop pomodoro', { type: 'timer.reset' });

// display
check('blackout', { type: 'display.blackout' });
check('turn off the wall', { type: 'display.blackout' });
check('go dark', { type: 'display.blackout' });
check('wake up', { type: 'display.wake' });
check('turn on', { type: 'display.wake' });

// scenes
check('focus mode', { type: 'scene.set', payload: { name: 'focus' } });
check('switch to party scene', { type: 'scene.set', payload: { name: 'party' } });
check('scene sleep', { type: 'scene.set', payload: { name: 'sleep' } });

// to-dos
check('add buy milk to my list', { type: 'todo.add', payload: { text: 'buy milk' } });
check('Add Call Mom to my to do list', { type: 'todo.add', payload: { text: 'Call Mom' } });
check('remind me to submit the essay', { type: 'todo.add', payload: { text: 'submit the essay' } });
check('complete buy milk', { type: 'todo.complete', payload: { text: 'buy milk' } });
check('mark the essay as done', { type: 'todo.complete', payload: { text: 'essay' } });
check('check off laundry', { type: 'todo.complete', payload: { text: 'laundry' } });

// spotify
check('skip the song', { type: 'spotify.next' });
check('skip', { type: 'spotify.next' });
check('next track', { type: 'spotify.next' });
check('previous song', { type: 'spotify.previous' });
check('go back', { type: 'spotify.previous' });
check('volume 40', { type: 'spotify.volume', payload: { percent: 40 } });
check('set the volume to forty', { type: 'spotify.volume', payload: { percent: 40 } });
check('pause', { type: 'spotify.pause' });
check('pause the music', { type: 'spotify.pause' });
check('play music', { type: 'spotify.play' });

// messages
check('say dinner is ready', { type: 'text.say', payload: { text: 'dinner is ready', seconds: 10 } });
check('show Happy Birthday for 30 seconds', { type: 'text.say', payload: { text: 'Happy Birthday', seconds: 30 } });

// unknown
check('what is the meaning of life', null);
check('', null);

// durations
if (parseDuration('2 hours') !== 7200000) { failed++; console.log('FAIL duration 2 hours'); }

// every documented example parses to something
for (const e of EXAMPLES) if (!parseText(e)) { failed++; console.log('FAIL example does not parse:', e); }

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('parseText: all passed');
