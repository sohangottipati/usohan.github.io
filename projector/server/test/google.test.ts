// Run with `npm test` in projector/server.
import { bestMatch, dateInTz, resolveDue } from '../src/integrations/google';

let failed = 0;
function eq(name: string, got: any, want: any) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
}

// Friday 2026-11-13, 11pm in Los Angeles = Saturday 07:00 UTC.
const lateFriLA = Date.parse('2026-11-14T07:00:00Z');
const LA = 'America/Los_Angeles';
eq('date in LA', dateInTz(lateFriLA, LA), '2026-11-13');
eq('date in UTC', dateInTz(lateFriLA, 'UTC'), '2026-11-14');
eq('today', resolveDue('today', lateFriLA, LA), '2026-11-13');
eq('tomorrow', resolveDue('tomorrow', lateFriLA, LA), '2026-11-14');
eq('monday', resolveDue('monday', lateFriLA, LA), '2026-11-16');
eq('friday on a friday', resolveDue('friday', lateFriLA, LA), '2026-11-20');
eq('next monday', resolveDue('next monday', lateFriLA, LA), '2026-11-16');
eq('iso', resolveDue('2026-12-01', lateFriLA, LA), '2026-12-01');
eq('nonsense', resolveDue('someday', lateFriLA, LA), null);
eq('month end', resolveDue('tomorrow', Date.parse('2026-12-31T20:00:00Z'), LA), '2027-01-01');

const items = [
  { id: '1', title: 'Buy milk', due: null, notes: '' },
  { id: '2', title: 'Submit CS 100 essay', due: null, notes: '' },
  { id: '3', title: 'Call mom', due: null, notes: '' },
  { id: '4', title: 'Laundry', due: null, notes: '' },
];
eq('exact', bestMatch('buy milk', items)?.id, '1');
eq('case/punct', bestMatch('Call Mom.', items)?.id, '3');
eq('partial', bestMatch('the essay', items)?.id, '2');
eq('words', bestMatch('submit essay', items)?.id, '2');
eq('plural-ish', bestMatch('do the laundry', items)?.id, '4');
eq('no match', bestMatch('walk the dog', items), null);
eq('empty', bestMatch('', items), null);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('google: all passed');
