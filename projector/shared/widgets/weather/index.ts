import { conditionLabel, subscribeWeather, toUnit, weatherIconSvg, type WeatherData } from '../../weather';
import { DEFAULT_LOCATION, FONT_OPTIONS, type LocationValue, type WidgetDefinition } from '../types';

export interface WeatherSettings {
  location: LocationValue;
  unit: 'f' | 'c';
  showIcon: boolean;
  showCondition: boolean;
  showHighLow: boolean;
  showLocation: boolean;
  font: string;
  size: number;
  color: string;
  iconColor: string;
  align: 'left' | 'center' | 'right';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const weatherWidget: WidgetDefinition<WeatherSettings> = {
  type: 'weather',
  name: 'Weather',
  description: 'Current temperature and conditions (Open-Meteo, no key).',
  defaultSize: { w: 800, h: 300 },
  requires: ['weather'],
  defaultSettings: {
    location: DEFAULT_LOCATION,
    unit: 'f',
    showIcon: true,
    showCondition: true,
    showHighLow: true,
    showLocation: false,
    font: FONT_OPTIONS[0].value,
    size: 150,
    color: '#ffffff',
    iconColor: '#ffd60a',
    align: 'center',
  },
  settingsSchema: [
    { key: 'location', label: 'Location', type: 'location' },
    {
      key: 'unit',
      label: 'Units',
      type: 'select',
      options: [
        { value: 'f', label: '°F' },
        { value: 'c', label: '°C' },
      ],
    },
    { key: 'showIcon', label: 'Icon', type: 'toggle' },
    { key: 'showCondition', label: 'Condition', type: 'toggle' },
    { key: 'showHighLow', label: 'High / low', type: 'toggle' },
    { key: 'showLocation', label: 'Place name', type: 'toggle' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Temperature size (px)', type: 'number', min: 10, max: 800 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'iconColor', label: 'Icon accent', type: 'color', when: { key: 'showIcon', is: [true] } },
    {
      key: 'align',
      label: 'Align',
      type: 'select',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let data: WeatherData | null = null;
    let error: string | null = null;
    const box = document.createElement('div');
    el.appendChild(box);

    function render() {
      const justify = s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center';
      box.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:' + justify + ';' +
        'font-family:' + s.font + ';color:' + s.color + ';white-space:nowrap;line-height:1;';
      if (!data) {
        box.innerHTML = ctx.mode === 'editor' ? '<span style="color:#888;font-size:32px">' + esc(error ? 'Weather: ' + error : 'Loading weather…') + '</span>' : '';
        return;
      }
      const temp = Math.round(toUnit(data.temperature, s.unit));
      const small = Math.round(s.size * 0.28);
      let html = '';
      if (s.showIcon) {
        html +=
          '<div style="width:' + s.size + 'px;height:' + s.size + 'px;margin-right:' + Math.round(s.size * 0.15) + 'px;flex:none">' +
          weatherIconSvg(data.code, data.isDay, s.color, s.iconColor) + '</div>';
      }
      html += '<div style="display:flex;flex-direction:column;text-align:' + s.align + '">';
      html += '<div style="font-size:' + s.size + 'px;font-weight:600">' + temp + '°</div>';
      const lines: string[] = [];
      if (s.showCondition) lines.push(conditionLabel(data.code, data.isDay));
      if (s.showHighLow) lines.push('H ' + Math.round(toUnit(data.high, s.unit)) + '°  L ' + Math.round(toUnit(data.low, s.unit)) + '°');
      if (s.showLocation && s.location) lines.push(s.location.name);
      for (let i = 0; i < lines.length; i++) {
        html += '<div style="font-size:' + small + 'px;opacity:' + (i ? 0.7 : 0.9) + ';margin-top:' + Math.round(small * 0.35) + 'px">' + esc(lines[i]) + '</div>';
      }
      html += '</div>';
      box.innerHTML = html;
    }

    const listener = (d: WeatherData | null, e: string | null) => {
      data = d;
      error = e;
      render();
    };
    let unsub = subscribeWeather(s.location || DEFAULT_LOCATION, listener);
    render();

    return {
      update(next) {
        const moved = !next.location || !s.location || next.location.lat !== s.location.lat || next.location.lon !== s.location.lon;
        s = next;
        if (moved) {
          unsub();
          data = null;
          unsub = subscribeWeather(s.location || DEFAULT_LOCATION, listener);
        }
        render();
      },
      resize() {
        render();
      },
      destroy() {
        unsub();
        el.removeChild(box);
      },
    };
  },
};
