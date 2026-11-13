// Open-Meteo (no API key) weather + sun times, shared by the weather and sun
// arc widgets. One request per location, cached and refreshed every 15 minutes.
// Runs in the browser; Open-Meteo allows cross-origin requests. ES2017-safe.

import type { LocationValue } from './widgets/types';

export interface WeatherData {
  /** °C */
  temperature: number;
  apparent: number;
  code: number;
  isDay: boolean;
  /** Epoch ms for [yesterday, today, tomorrow]. */
  sunrise: number[];
  sunset: number[];
  /** °C */
  high: number;
  low: number;
  /** Seconds east of UTC for the location, for formatting its local times. */
  utcOffset: number;
  fetchedAt: number;
}

type Listener = (d: WeatherData | null, error: string | null) => void;

interface Entry {
  data: WeatherData | null;
  error: string | null;
  listeners: Listener[];
  timer: any;
  loading: boolean;
}

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const cache: { [key: string]: Entry } = {};

function keyOf(loc: LocationValue): string {
  return loc.lat.toFixed(3) + ',' + loc.lon.toFixed(3);
}

/** "2026-11-13T06:23" in the location's local time → epoch ms. */
function localToEpoch(s: string, offsetSec: number): number {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000;
}

function load(key: string, loc: LocationValue) {
  const e = cache[key];
  if (!e || e.loading) return;
  e.timer = null;
  e.loading = true;
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&timezone=auto&past_days=1&forecast_days=2';
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('Weather HTTP ' + r.status);
      return r.json();
    })
    .then((j: any) => {
      const off = j.utc_offset_seconds || 0;
      const d = j.daily;
      e.data = {
        temperature: j.current.temperature_2m,
        apparent: j.current.apparent_temperature,
        code: j.current.weather_code,
        isDay: j.current.is_day === 1,
        sunrise: d.sunrise.map((s: string) => localToEpoch(s, off)),
        sunset: d.sunset.map((s: string) => localToEpoch(s, off)),
        high: d.temperature_2m_max[1],
        low: d.temperature_2m_min[1],
        utcOffset: off,
        fetchedAt: Date.now(),
      };
      e.error = null;
      if (cache[key] === e) e.timer = setTimeout(() => load(key, loc), REFRESH_MS);
    })
    .catch((err) => {
      e.error = err && err.message ? err.message : 'Weather unavailable';
      if (cache[key] === e) e.timer = setTimeout(() => load(key, loc), RETRY_MS);
    })
    .then(() => {
      e.loading = false;
      const list = e.listeners.slice();
      for (let i = 0; i < list.length; i++) list[i](e.data, e.error);
    });
}

/** Subscribe to weather for a location. Calls back immediately if cached. Returns unsubscribe. */
export function subscribeWeather(loc: LocationValue, fn: Listener): () => void {
  const key = keyOf(loc);
  let e = cache[key];
  if (!e) {
    e = cache[key] = { data: null, error: null, listeners: [], timer: null, loading: false };
  }
  e.listeners.push(fn);
  if (e.data || e.error) fn(e.data, e.error);
  if (!e.data && !e.loading && !e.timer) load(key, loc);
  return () => {
    const i = e.listeners.indexOf(fn);
    if (i >= 0) e.listeners.splice(i, 1);
    if (!e.listeners.length) {
      clearTimeout(e.timer);
      delete cache[key];
    }
  };
}

/** Format an epoch as the location's local wall-clock time. */
export function formatLocalTime(epoch: number, offsetSec: number, h24: boolean): string {
  const d = new Date(epoch + offsetSec * 1000);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const mm = m < 10 ? '0' + m : '' + m;
  if (h24) return (h < 10 ? '0' + h : '' + h) + ':' + mm;
  const suffix = h >= 12 ? ' PM' : ' AM';
  h = h % 12 || 12;
  return h + ':' + mm + suffix;
}

export function toUnit(c: number, unit: 'c' | 'f'): number {
  return unit === 'f' ? c * 1.8 + 32 : c;
}

// ---------- WMO weather codes ----------

export type Condition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export function condition(code: number): Condition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

const LABELS: { [k: string]: string } = {
  clear: 'Clear',
  partly: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  snow: 'Snow',
  storm: 'Thunderstorm',
};

export function conditionLabel(code: number, isDay: boolean): string {
  const c = condition(code);
  if (c === 'clear') return isDay ? 'Sunny' : 'Clear';
  return LABELS[c];
}

/** Simple line icon as an SVG string (viewBox 0 0 64 64), drawn in `color`. */
export function weatherIconSvg(code: number, isDay: boolean, color: string, accent: string): string {
  const c = condition(code);
  const sw = 'stroke="' + color + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  const sun = (cx: number, cy: number, r: number) => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rays +=
        '<line x1="' + (cx + Math.cos(a) * (r + 5)) + '" y1="' + (cy + Math.sin(a) * (r + 5)) +
        '" x2="' + (cx + Math.cos(a) * (r + 10)) + '" y2="' + (cy + Math.sin(a) * (r + 10)) + '"/>';
    }
    return '<g stroke="' + accent + '" stroke-width="3.5" stroke-linecap="round" fill="none"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' + rays + '</g>';
  };
  const moon = (cx: number, cy: number) =>
    '<path d="M' + (cx + 6) + ' ' + (cy - 14) + 'a14 14 0 1 0 10 22a11 11 0 0 1 -10 -22z" stroke="' + accent + '" stroke-width="3.5" stroke-linejoin="round" fill="none"/>';
  const cloudPath = 'M18 46h28a10 10 0 0 0 0-20a14 14 0 0 0-27-3a10 10 0 0 0-1 23z';
  const cloud = '<path d="' + cloudPath + '" ' + sw + '/>';
  // Black fill hides the sun behind the cloud; black is "no light" on a projector.
  const cloudFront = '<path d="' + cloudPath + '" fill="#000"/>' + cloud;
  let body = '';
  if (c === 'clear') body = isDay ? sun(32, 32, 11) : moon(30, 32);
  else if (c === 'partly') body = (isDay ? sun(22, 22, 8) : moon(20, 22)) + cloudFront;
  else if (c === 'cloudy') body = cloud;
  else if (c === 'fog') body = '<g ' + sw + '><line x1="12" y1="24" x2="52" y2="24"/><line x1="8" y1="34" x2="48" y2="34"/><line x1="16" y1="44" x2="56" y2="44"/></g>';
  else {
    const top = '<path d="M18 38h28a10 10 0 0 0 0-20a14 14 0 0 0-27-3a10 10 0 0 0-1 23z" ' + sw + '/>';
    let marks = '';
    if (c === 'snow') marks = '<g fill="' + accent + '"><circle cx="22" cy="48" r="2.5"/><circle cx="32" cy="54" r="2.5"/><circle cx="42" cy="48" r="2.5"/></g>';
    else if (c === 'storm') marks = '<path d="M34 40l-6 10h8l-6 10" stroke="' + accent + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    else {
      const n = c === 'drizzle' ? 2 : 3;
      marks = '<g stroke="' + accent + '" stroke-width="3.5" stroke-linecap="round">';
      for (let i = 0; i < n; i++) marks += '<line x1="' + (22 + i * 10) + '" y1="44" x2="' + (19 + i * 10) + '" y2="52"/>';
      marks += '</g>';
    }
    body = top + marks;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">' + body + '</svg>';
}
