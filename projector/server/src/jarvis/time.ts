// Time-zone helpers (Workers have full Intl support).

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => +(f.find((p) => p.type === t) || { value: '0' }).value;
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Milliseconds the time zone is ahead of UTC at instant `ms`. */
export function tzOffset(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of local wall-clock time y-m-d h:mi in tz. */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz); // second pass settles DST edges
  return t;
}

/** Next occurrence (strictly after now) of "HH:MM" in tz. */
export function nextDailyTime(now: number, hhmm: string, tz: string): number {
  const [h, mi] = hhmm.split(':').map(Number);
  const p = parts(now, tz);
  let t = zonedTime(p.y, p.m, p.d, h, mi, tz);
  if (t <= now) {
    const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    t = zonedTime(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), h, mi, tz);
  }
  return t;
}

/** "YYYY-MM-DD" in tz. */
export function localDate(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d;
}

/** "Friday, 2:05 PM" */
export function speakableNow(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

export function clockTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(':00', '');
}
