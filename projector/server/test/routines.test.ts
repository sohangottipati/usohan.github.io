// Run with `npm test` in projector/server.
import { isClassEvent, starterRoutines } from '../../shared/jarvis';
import { findRoutine, matchRoutine, planRoutine, sanitizeRoutines } from '../src/jarvis/routines';

let failed = 0;
function eq(name: string, got: any, want: any) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
}
let n = 0;
const routines = sanitizeRoutines(starterRoutines(), () => 'r' + n++);
eq('starters kept', routines.map((r) => r.name), ["I'm home", 'Goodnight']);
eq('match exact', matchRoutine('Goodnight', routines)?.name, 'Goodnight');
eq('match with siri + wall + punctuation', matchRoutine('Hey Siri, wall, good night!', routines)?.name, 'Goodnight');
eq('match apostrophe-less', matchRoutine('im home', routines)?.name, "I'm home");
eq('match "run ... routine"', matchRoutine('run goodnight routine', routines)?.name, 'Goodnight');
eq('no partial match', matchRoutine('goodnight moon is a book', routines), null);
eq('find by name', findRoutine('the goodnight one', routines)?.name, 'Goodnight');

const plan = planRoutine(routines[1], 1000);
eq('now steps', plan.now.map((s) => s.value), ['sleep mode', 'volume 25', 'Goodnight. Going dark in ten minutes.']);
eq('later steps', plan.later.map((s) => [s.at, s.step.value]), [[601000, 'pause the music'], [601000, 'blackout']]);

eq('sanitize drops junk', sanitizeRoutines([{ name: '', steps: [] }, { name: 'X', phrases: [], steps: [{ kind: 'rm', value: 'x' }, { kind: 'wait', value: '-1' }, { kind: 'do', value: 'blackout' }] }], () => 'id'), [
  { id: 'id', name: 'X', phrases: ['X'], steps: [{ kind: 'do', value: 'blackout' }] },
]);

const cm = { enabled: true, calendars: 'School', courseCodes: true, scene: '', quiet: true };
eq('class by calendar', isClassEvent({ title: 'Lecture', calendar: 'UCR School', allDay: false }, cm), true);
eq('class by course code', isClassEvent({ title: 'CS 100 lecture', calendar: 'me', allDay: false }, cm), true);
eq('class code no space', isClassEvent({ title: 'MATH10A', calendar: 'me', allDay: false }, cm), true);
eq('not a class', isClassEvent({ title: 'Dinner with Alex', calendar: 'me', allDay: false }, cm), false);
eq('all-day never', isClassEvent({ title: 'CS 100 exam week', calendar: 'School', allDay: true }, cm), false);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('routines: all passed');
