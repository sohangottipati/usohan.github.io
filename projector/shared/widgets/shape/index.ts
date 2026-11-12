import type { WidgetDefinition } from '../types';

export interface ShapeSettings {
  fill: 'solid' | 'linear' | 'radial' | 'none';
  color: string;
  color2: string;
  angle: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  glow: boolean;
  glowColor: string;
  glowSize: number;
}

function apply(box: HTMLElement, s: ShapeSettings) {
  let bg = 'transparent';
  if (s.fill === 'solid') bg = s.color;
  else if (s.fill === 'linear') bg = 'linear-gradient(' + (s.angle || 0) + 'deg, ' + s.color + ', ' + s.color2 + ')';
  else if (s.fill === 'radial') bg = 'radial-gradient(circle, ' + s.color + ', ' + s.color2 + ')';
  box.style.background = bg;
  box.style.borderRadius = (s.radius || 0) + 'px';
  box.style.border = s.borderWidth > 0 ? s.borderWidth + 'px solid ' + s.borderColor : 'none';
  box.style.boxShadow = s.glow
    ? '0 0 ' + s.glowSize + 'px ' + s.glowColor + ', inset 0 0 ' + s.glowSize + 'px ' + s.glowColor
    : 'none';
}

export const shapeWidget: WidgetDefinition<ShapeSettings> = {
  type: 'shape',
  name: 'Shape / color',
  description: 'Solid, gradient or glowing outline. Good for lighting real objects.',
  defaultSize: { w: 400, h: 300 },
  defaultSettings: {
    fill: 'solid',
    color: '#ffffff',
    color2: '#1877ae',
    angle: 90,
    radius: 0,
    borderWidth: 0,
    borderColor: '#ffffff',
    glow: false,
    glowColor: '#5ac0f2',
    glowSize: 30,
  },
  settingsSchema: [
    {
      key: 'fill',
      label: 'Fill',
      type: 'select',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'linear', label: 'Linear gradient' },
        { value: 'radial', label: 'Radial gradient' },
        { value: 'none', label: 'None (outline only)' },
      ],
    },
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'color2', label: 'Gradient end', type: 'color' },
    { key: 'angle', label: 'Gradient angle', type: 'number', min: 0, max: 360, step: 5 },
    { key: 'radius', label: 'Corner radius', type: 'number', min: 0, max: 2000 },
    { key: 'borderWidth', label: 'Border width', type: 'number', min: 0, max: 200 },
    { key: 'borderColor', label: 'Border color', type: 'color' },
    { key: 'glow', label: 'Glow', type: 'toggle' },
    { key: 'glowColor', label: 'Glow color', type: 'color' },
    { key: 'glowSize', label: 'Glow size', type: 'number', min: 0, max: 300 },
  ],
  mount(el, ctx) {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;';
    el.appendChild(box);
    apply(box, ctx.settings);
    return {
      update(s) {
        apply(box, s);
      },
      resize() {},
      destroy() {
        el.removeChild(box);
      },
    };
  },
};
