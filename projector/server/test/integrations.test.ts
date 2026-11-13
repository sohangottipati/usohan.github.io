// Run with `npm test` in projector/server.
import { dueSummary, normalizeBaseUrl } from '../src/integrations/canvas';
import { describeWhen } from '../src/integrations/google';
import { parseClock, resolveWhen } from '../src/integrations/when';

let failed = 0;
function eq(name: string, got: any, want: any) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
  }
}
const LA = 'America/Los_Angeles';
const now = Date.parse('2026-11-13T20:00:00Z'); // Friday Nov 13, 12:00 PM in LA

// clock guesses
eq('3 → 3 PM', parseClock('3'), 15 * 60);
eq('9 → 9 AM', parseClock('9'), 9 * 60);
eq('12:30', parseClock('12:30'), 12 * 60 + 30);
eq('3pm', parseClock('3pm'), 15 * 60);
eq('8 a.m.', parseClock('8 a.m.'), 8 * 60);
eq('noon', parseClock('noon'), 720);
eq('end after start', parseClock('8', 18 * 60), 20 * 60);

// whole events
eq('next tuesday at 3', resolveWhen({ date: 'next tuesday', time: '3' }, now, LA), { allDay: false, date: '2026-11-17', endDate: '2026-11-17', startTime: '15:00', endTime: '16:00' });
eq('friday 6 to 8 (said on a friday → next week)', resolveWhen({ date: 'friday', time: '6', endTime: '8' }, now, LA), { allDay: false, date: '2026-11-20', endDate: '2026-11-20', startTime: '18:00', endTime: '20:00' });
eq('tomorrow 10pm to 1am', resolveWhen({ date: 'tomorrow', time: '10pm', endTime: '1am' }, now, LA), { allDay: false, date: '2026-11-14', endDate: '2026-11-15', startTime: '22:00', endTime: '01:00' });
eq('march 3 all day (next year)', resolveWhen({ date: 'march 3rd', allDay: true }, now, LA), { allDay: true, date: '2027-03-03', endDate: '2027-03-04', startTime: null, endTime: null });
eq('12/25', resolveWhen({ date: '12/25' }, now, LA), { allDay: true, date: '2026-12-25', endDate: '2026-12-26', startTime: null, endTime: null });
eq('2 hours', resolveWhen({ date: 'tomorrow', time: '2pm', durationMinutes: 120 }, now, LA), { allDay: false, date: '2026-11-14', endDate: '2026-11-14', startTime: '14:00', endTime: '16:00' });
eq('model start/end', resolveWhen({ start: '2026-11-18T09:30', end: '2026-11-18T10:15' }, now, LA), { allDay: false, date: '2026-11-18', endDate: '2026-11-18', startTime: '09:30', endTime: '10:15' });
eq('bad date', 'error' in resolveWhen({ date: 'someday' }, now, LA), true);
eq('bad time', 'error' in resolveWhen({ date: 'tomorrow', time: 'lunchish' }, now, LA), true);

// read-back
eq('describe', describeWhen({ allDay: false, date: '2026-11-17', endDate: '2026-11-17', startTime: '15:00', endTime: '16:00' }, now, LA), 'Tuesday, November 17, 3 to 4 PM');
eq('describe am-pm', describeWhen({ allDay: false, date: '2026-11-14', endDate: '2026-11-14', startTime: '11:30', endTime: '13:00' }, now, LA), 'tomorrow, November 14, 11:30 AM to 1 PM');
eq('describe all day', describeWhen({ allDay: true, date: '2026-11-13', endDate: '2026-11-14', startTime: null, endTime: null }, now, LA), 'today, all day');

// canvas
eq('url', normalizeBaseUrl('elearn.ucr.edu/'), 'https://elearn.ucr.edu');
eq('url http rejected', normalizeBaseUrl('http://elearn.ucr.edu'), null);
const items = [
  { id: '1', title: 'HW 3', course: 'CS 100 - Software Construction', due: '2026-11-14T07:59:00Z', type: 'assignment', submitted: false, missing: false, url: '' },
  { id: '2', title: 'Quiz 4', course: 'MATH 10A', due: '2026-11-17T07:59:00Z', type: 'quiz', submitted: false, missing: false, url: '' },
  { id: '3', title: 'Essay draft', course: 'ENGL 1B', due: '2026-11-15T07:59:00Z', type: 'assignment', submitted: true, missing: false, url: '' },
  { id: '4', title: 'Lab 2', course: 'CS 100', due: '2026-11-08T07:59:00Z', type: 'assignment', submitted: false, missing: true, url: '' },
];
eq('due summary', dueSummary(items, now, LA), '2 things due this week: HW 3 for CS 100 today, Quiz 4 for MATH 10A Monday. Missing: Lab 2.');
eq('nothing due', dueSummary([], now, LA), 'Nothing due in the next week.');

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('integrations: all passed');
