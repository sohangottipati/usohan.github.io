// The one place widgets are registered. To add a widget: create
// widgets/<type>/index.ts exporting a WidgetDefinition, then add it below.

import type { WidgetDefinition } from './types';
import { clockWidget } from './clock';
import { mediaWidget } from './media';
import { shapeWidget } from './shape';
import { textWidget } from './text';

const ALL: WidgetDefinition<any>[] = [shapeWidget, mediaWidget, textWidget, clockWidget];

const byType: { [type: string]: WidgetDefinition<any> } = {};
for (let i = 0; i < ALL.length; i++) byType[ALL[i].type] = ALL[i];

export function getWidget(type: string): WidgetDefinition<any> | undefined {
  return byType[type];
}

export function listWidgets(): WidgetDefinition<any>[] {
  return ALL.slice();
}

/** Fill in any settings a saved layer is missing (e.g. after a widget gains a new option). */
export function withDefaults(type: string, settings: Record<string, any>): Record<string, any> {
  const def = byType[type];
  const out: Record<string, any> = {};
  if (def) {
    const d = def.defaultSettings as Record<string, any>;
    for (const k in d) out[k] = d[k];
  }
  for (const k in settings) out[k] = settings[k];
  return out;
}
