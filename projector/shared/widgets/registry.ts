// The one place widgets are registered. To add a widget: create
// widgets/<type>/index.ts exporting a WidgetDefinition, then add it below.

import type { WidgetDefinition } from './types';
import { agendaWidget } from './agenda';
import { aiUsageWidget } from './aiUsage';
import { studyTimeWidget } from './studyTime';
import { upNextWidget } from './upNext';
import { calendarWidget } from './calendar';
import { classNowWidget } from './classNow';
import { canvasDueWidget } from './canvasDue';
import { clockWidget } from './clock';
import { mediaWidget } from './media';
import { messageWidget } from './message';
import { particlesWidget } from './particles';
import { shapeWidget } from './shape';
import { spotifyNowPlayingWidget } from './spotifyNowPlaying';
import { sunArcWidget } from './sunArc';
import { textWidget } from './text';
import { timerWidget } from './timer';
import { todoWidget } from './todo';
import { weatherWidget } from './weather';

const ALL: WidgetDefinition<any>[] = [
  shapeWidget,
  mediaWidget,
  textWidget,
  clockWidget,
  timerWidget,
  messageWidget,
  particlesWidget,
  sunArcWidget,
  weatherWidget,
  spotifyNowPlayingWidget,
  calendarWidget,
  todoWidget,
  canvasDueWidget,
  agendaWidget,
  classNowWidget,
  upNextWidget,
  studyTimeWidget,
  aiUsageWidget,
];

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
