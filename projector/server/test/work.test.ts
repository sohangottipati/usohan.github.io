// Run with `npm test` in projector/server.
import { freeWindow, matchWork, workItems } from '../../shared/planner';
import { defaultLiveState } from '../../shared/types';
import { dayFns, freeTime, studyStats, whatNext } from '../src/jarvis/work';

let failed = 0;
function ok(cond: boolean, what: string, got?: unknown) {
  if (!cond) {
    failed++;
    console.log('FAIL', what, got === undefined ? '' : '\n  got ' + JSON.stringify(got));
  }
}

const tz = 'America/Los_Angeles';
const f = dayFns(tz);
const now = Date.parse('2026-11-13T20:00:00Z'); // Fri 12:00 PM in LA
const iso = (h: number, m = 0) => new Date(Date.parse('2026-11-13T20:00:00Z') + ((h - 12) * 60 + m) * 60000).toISOString();
const live = defaultLiveState();
live.calendar = {
  fetchedAt: now,
  error: null,
  events: [
    { id: '1', title: 'CS 100 Lecture', start: iso(11), end: iso(12, 50), allDay: false, calendar: 'School', color: '', location: '' },
    { id: '2', title: 'MATH 10A DIS', start: iso(14), end: iso(14, 50), allDay: false, calendar: 'School', color: '', location: '' },
    { id: '3', title: 'Club meeting', start: iso(18), end: iso(19), allDay: false, calendar: 'me', color: '', location: '' },
  ],
};
live.canvas = {
  fetchedAt: now,
  error: null,
  items: [
    { id: 'a', title: 'HW 3', course: 'CS 100 - Software Construction', due: iso(23, 59), type: 'assignment', submitted: false, missing: false, url: '' },
    { id: 'b', title: 'Lab 2', course: 'CS 100', due: iso(-30), type: 'assignment', submitted: false, missing: true, url: '' },
    { id: 'c', title: 'Quiz 4', course: 'MATH 10A', due: iso(72), type: 'quiz', submitted: false, missing: false, url: '' },
    { id: 'd', title: 'Done thing', course: 'X', due: iso(20), type: 'assignment', submitted: true, missing: false, url: '' },
  ],
};
live.todos = { fetchedAt: now, error: null, items: [{ id: 't1', title: 'Check Boeing jobs', due: null, notes: '' }, { id: 't2', title: 'Email TA', due: '2026-11-13', notes: '' }] } as any;

const items = workItems(live, now, f);
ok(items.map((i) => i.title).join(',') === 'Lab 2,HW 3,Email TA,Quiz 4,Check Boeing jobs', 'ranking: missing, due tonight, to-do today, quiz, undated', items.map((i) => i.title));
ok(items[1].course === 'CS 100', 'short course name', items[1].course);

const w = freeWindow(live, now, f);
ok(w.busy !== null && w.busy.title === 'CS 100 Lecture' && w.next!.title === 'MATH 10A DIS', 'in class now, next is discussion', w);

const next = whatNext(live, now, tz);
ok(/^You're in CS 100 Lecture until 12:50 PM\. After that, start with Lab 2 for CS 100, which is missing\. Then HW 3 and Email TA\.$/.test(next), 'whatNext', next);
const later = whatNext(live, Date.parse(iso(13)), tz);
ok(/^You're free for 1 hour, until MATH 10A DIS\./.test(later), 'whatNext free window', later);

const free = freeTime(live, Date.parse(iso(13)), tz, 'today');
ok(free === "You're free now until 2 PM, from 2:50 PM to 6 PM, and after 7 PM. About 8 hours 15 minutes in all.", 'freeTime', free);

ok(matchWork('hw 3', items)!.title === 'HW 3', 'match hw 3');
ok(matchWork('the lab', items)!.title === 'Lab 2', 'match the lab');
ok(matchWork('hw 4', items) === null, 'numbers must match');
ok(matchWork('homework 3', items)!.title === 'HW 3', 'homework = hw');
ok(matchWork('boeing', items)!.title === 'Check Boeing jobs', 'match a to-do');

const log = [
  { day: '2026-11-13', task: 'HW 3', course: 'CS 100', minutes: 50 },
  { day: '2026-11-13', task: 'Lab 2', course: 'CS 100', minutes: 30 },
  { day: '2026-11-11', task: 'Quiz 4', course: 'MATH 10A', minutes: 90 },
];
const today = studyStats(log, 0, now, tz, 'today', 120);
ok(today === '1 hour 20 minutes today: 50 minutes on HW 3, 30 minutes on Lab 2. 40 minutes to your goal.', 'stats today', today);
const week = studyStats(log, 10, now, tz, 'week', 120);
ok(week === '3 hours in the last seven days. Your best day was Wednesday, with 1 hour 30 minutes.', 'stats week', week);

if (failed) {
  console.log(failed + ' failed');
  process.exit(1);
}
console.log('work: all passed');
