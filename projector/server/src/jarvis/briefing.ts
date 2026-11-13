// The morning briefing: weather, the day's events, and to-dos, said in one go.
// Facts are gathered here; the brain (if on) turns them into natural speech,
// otherwise a plain template is used.

import type { JarvisSettings } from '../../../shared/jarvis';
import type { LiveState } from '../../../shared/types';
import type { Env } from '../env';
import { write, type UsageSink } from './brain';
import { clockTime, localDate } from './time';

const WMO: { [code: number]: string } = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'foggy', 48: 'foggy',
  51: 'drizzly', 53: 'drizzly', 55: 'drizzly', 61: 'rainy', 63: 'rainy', 65: 'pouring',
  71: 'snowy', 73: 'snowy', 75: 'snowy', 80: 'showery', 81: 'showery', 82: 'stormy', 95: 'stormy',
};

async function weatherLine(s: JarvisSettings, env: Env): Promise<string | null> {
  const base = env.WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
  const url = base + '?latitude=' + s.location.lat + '&longitude=' + s.location.lon +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=1';
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j: any = await r.json();
    const now = Math.round(j.current.temperature_2m);
    const hi = Math.round(j.daily.temperature_2m_max[0]);
    const lo = Math.round(j.daily.temperature_2m_min[0]);
    const rain = j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[0] : null;
    const sky = WMO[j.current.weather_code] || 'mixed';
    return `It's ${now} degrees and ${sky} in ${s.location.name.split(',')[0]}, with a high of ${hi} and a low of ${lo}` + (rain !== null && rain >= 30 ? `, and a ${rain} percent chance of rain.` : '.');
  } catch (e) {
    return null;
  }
}

export async function composeBriefing(s: JarvisSettings, env: Env, live: LiveState, now: number, extra: string[] = [], track?: UsageSink): Promise<string> {
  const tz = s.timeZone;
  const today = localDate(now, tz);
  const facts: string[] = [];

  const weather = await weatherLine(s, env);
  if (weather) facts.push(weather);

  if (live.calendar) {
    const todays = live.calendar.events.filter((e) => (e.allDay ? e.start <= today && today < e.end : localDate(Date.parse(e.start), tz) === today && Date.parse(e.end) > now));
    if (!todays.length) facts.push('Nothing on the calendar today.');
    else {
      const named = todays.slice(0, 4).map((e) => (e.allDay ? e.title + ' (all day)' : e.title + ' at ' + clockTime(Date.parse(e.start), tz)));
      facts.push('Today: ' + named.join(', ') + (todays.length > 4 ? ', and ' + (todays.length - 4) + ' more' : '') + '.');
    }
  }
  if (live.todos) {
    const overdue = live.todos.items.filter((i) => i.due && i.due < today);
    const dueToday = live.todos.items.filter((i) => i.due === today);
    if (overdue.length) facts.push(overdue.length + ' overdue: ' + overdue.slice(0, 3).map((i) => i.title).join(', ') + '.');
    if (dueToday.length) facts.push('Due today: ' + dueToday.slice(0, 3).map((i) => i.title).join(', ') + '.');
    if (!overdue.length && !dueToday.length && live.todos.items.length) facts.push(live.todos.items.length + ' things on the list, nothing urgent.');
  }

  facts.push(...extra);

  const hour = +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now));
  const greeting = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
  const plain = [greeting, ...facts].join(' ');
  if (!facts.length) return greeting + " I don't have anything connected to brief you on yet.";

  const polished = await write(
    s,
    env,
    'Turn these facts into a short spoken briefing (3 to 4 sentences, under 70 words). Start with a greeting suited to the time of day (' +
      greeting + '). Keep every number and name exactly. Facts:\n' + facts.join('\n'),
    track,
  );
  return polished || plain;
}
