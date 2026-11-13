import { formatLocalTime, subscribeWeather, type WeatherData } from '../../weather';
import { DEFAULT_LOCATION, FONT_OPTIONS, type LocationValue, type WidgetDefinition } from '../types';

export interface SunArcSettings {
  location: LocationValue;
  arcColor: string;
  sunColor: string;
  lineWidth: number;
  showTimes: boolean;
  format: '12' | '24';
  font: string;
  labelSize: number;
  labelColor: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
}

/** Today's sunrise/sunset for the location, and where now falls. */
export function sunPhase(d: WeatherData, now: number) {
  // Index 1 is "today" in the location's timezone; check yesterday/tomorrow too
  // in case the projector's clock and the cached data straddle midnight.
  for (let i = 0; i < d.sunrise.length; i++) {
    if (now >= d.sunrise[i] && now < d.sunset[i]) {
      return { day: true, rise: d.sunrise[i], set: d.sunset[i], t: (now - d.sunrise[i]) / (d.sunset[i] - d.sunrise[i]), next: d.sunset[i] };
    }
  }
  let next = NaN;
  for (let i = 0; i < d.sunrise.length; i++) {
    if (d.sunrise[i] > now) {
      next = d.sunrise[i];
      break;
    }
  }
  // Show the upcoming day's times at night (after sunset: tomorrow's).
  let idx = 1;
  for (let i = 0; i < d.sunrise.length; i++) if (d.sunrise[i] === next) idx = i;
  return { day: false, rise: d.sunrise[idx], set: d.sunset[idx], t: -1, next };
}

export const sunArcWidget: WidgetDefinition<SunArcSettings> = {
  type: 'sunArc',
  name: 'Sun arc',
  description: 'Sunrise to sunset arc with where the sun is right now.',
  defaultSize: { w: 900, h: 420 },
  requires: ['weather'],
  defaultSettings: {
    location: DEFAULT_LOCATION,
    arcColor: '#ffffff',
    sunColor: '#ffd60a',
    lineWidth: 4,
    showTimes: true,
    format: '12',
    font: FONT_OPTIONS[0].value,
    labelSize: 34,
    labelColor: '#ffffff',
  },
  settingsSchema: [
    { key: 'location', label: 'Location', type: 'location' },
    { key: 'arcColor', label: 'Arc color', type: 'color' },
    { key: 'sunColor', label: 'Sun color', type: 'color' },
    { key: 'lineWidth', label: 'Line width', type: 'number', min: 1, max: 30 },
    { key: 'showTimes', label: 'Sunrise / sunset times', type: 'toggle' },
    {
      key: 'format',
      label: 'Time format',
      type: 'select',
      options: [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
      when: { key: 'showTimes', is: [true] },
    },
    { key: 'font', label: 'Font', type: 'font', when: { key: 'showTimes', is: [true] } },
    { key: 'labelSize', label: 'Label size (px)', type: 'number', min: 8, max: 200, when: { key: 'showTimes', is: [true] } },
    { key: 'labelColor', label: 'Label color', type: 'color', when: { key: 'showTimes', is: [true] } },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let data: WeatherData | null = null;
    let error: string | null = null;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    el.appendChild(box);

    function render() {
      const w = ctx.size.w;
      const h = ctx.size.h;
      if (!data) {
        box.innerHTML =
          ctx.mode === 'editor'
            ? '<div style="color:#888;font:32px sans-serif;padding:20px">' + esc(error ? 'Sun arc: ' + error : 'Loading sun times…') + '</div>'
            : '';
        return;
      }
      const now = ctx.now().getTime();
      const ph = sunPhase(data, now);
      const label = s.showTimes ? s.labelSize * 1.6 : 0;
      const sun = Math.max(10, Math.min(w, h) * 0.06);
      const pad = sun * 2 + s.lineWidth; // room for the glow at the top of the arc
      const hy = h - label - s.lineWidth;
      const cx = w / 2;
      const rx = w / 2 - pad;
      const ry = Math.max(10, hy - pad);
      const lw = s.lineWidth;

      let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">';
      // Horizon and the full arc (faint), then the travelled part (solid).
      svg += '<line x1="0" y1="' + hy + '" x2="' + w + '" y2="' + hy + '" stroke="' + s.arcColor + '" stroke-width="' + lw + '" opacity="0.35" stroke-linecap="round"/>';
      svg +=
        '<path d="M' + (cx - rx) + ' ' + hy + ' A' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + hy + '" fill="none" stroke="' + s.arcColor +
        '" stroke-width="' + lw + '" stroke-dasharray="' + lw * 2 + ' ' + lw * 3 + '" opacity="0.5" stroke-linecap="round"/>';
      if (ph.day) {
        const t = Math.max(0, Math.min(1, ph.t));
        const a = Math.PI * (1 - t);
        const x = cx + rx * Math.cos(a);
        const y = hy - ry * Math.sin(a);
        // Elliptical arc from sunrise to the sun's position (always the short, upper way).
        svg +=
          '<path d="M' + (cx - rx) + ' ' + hy + ' A' + rx + ' ' + ry + ' 0 0 1 ' + x + ' ' + y + '" fill="none" stroke="' + s.arcColor +
          '" stroke-width="' + lw + '" stroke-linecap="round"/>';
        svg += '<circle cx="' + x + '" cy="' + y + '" r="' + sun * 1.9 + '" fill="' + s.sunColor + '" opacity="0.18"/>';
        svg += '<circle cx="' + x + '" cy="' + y + '" r="' + sun + '" fill="' + s.sunColor + '"/>';
      }
      if (s.showTimes) {
        const fs = s.labelSize;
        const ty = hy + lw + fs * 1.1;
        const txt = 'font-family="' + esc(s.font).replace(/"/g, '&quot;') + '" font-size="' + fs + '" fill="' + s.labelColor + '"';
        const fmt = (e: number) => formatLocalTime(e, data!.utcOffset, s.format === '24');
        svg += '<text x="' + (cx - rx) + '" y="' + ty + '" text-anchor="start" ' + txt + '>↑ ' + fmt(ph.rise) + '</text>';
        svg += '<text x="' + (cx + rx) + '" y="' + ty + '" text-anchor="end" ' + txt + '>' + fmt(ph.set) + ' ↓</text>';
        const mid = ph.day ? duration(ph.set - now) + ' of daylight left' : isNaN(ph.next) ? '' : 'Sunrise in ' + duration(ph.next - now);
        if (mid) svg += '<text x="' + cx + '" y="' + ty + '" text-anchor="middle" opacity="0.7" ' + txt.replace('font-size="' + fs, 'font-size="' + fs * 0.75) + '>' + mid + '</text>';
      }
      svg += '</svg>';
      box.innerHTML = svg;
    }

    let unsub = subscribeWeather(s.location || DEFAULT_LOCATION, (d, e) => {
      data = d;
      error = e;
      render();
    });
    let timer: any = setInterval(render, 30000);
    render();

    return {
      update(next) {
        const moved = !next.location || !s.location || next.location.lat !== s.location.lat || next.location.lon !== s.location.lon;
        s = next;
        if (moved) {
          unsub();
          data = null;
          unsub = subscribeWeather(s.location || DEFAULT_LOCATION, (d, e) => {
            data = d;
            error = e;
            render();
          });
        }
        render();
      },
      resize() {
        render();
      },
      setActive(a) {
        clearInterval(timer);
        timer = null;
        if (a) {
          render();
          timer = setInterval(render, 30000);
        }
      },
      destroy() {
        unsub();
        clearInterval(timer);
        el.removeChild(box);
      },
    };
  },
};
