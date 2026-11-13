# Adding a widget

Every layer on the wall is a **widget**. A widget is one object that says what it's called, what settings it has, and how to draw itself into a `<div>`. The editor and the display never need changing: the editor builds the settings panel from your schema, and both use the same renderer to mount the widget and warp it onto its quad.

## 1. Create the folder

```
projector/shared/widgets/<type>/index.ts
```

## 2. Write the definition

A small but complete example: a countdown to a fixed date.

```ts
import type { WidgetDefinition } from '../types';
import { FONT_OPTIONS } from '../types';
import { everySecond } from '../util';

export interface CountdownSettings {
  label: string;
  target: string; // e.g. "2026-12-25T00:00"
  font: string;
  size: number;
  color: string;
}

export const countdownWidget: WidgetDefinition<CountdownSettings> = {
  type: 'countdown',            // stored in saved layers: never rename it
  name: 'Countdown',            // shown in "Add layer"
  description: 'Days, hours and minutes until a date.',
  defaultSize: { w: 900, h: 260 },
  defaultSettings: {
    label: 'Winter break',
    target: '2026-12-12T17:00',
    font: FONT_OPTIONS[0].value,
    size: 110,
    color: '#ffffff',
  },
  settingsSchema: [
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'target', label: 'Date and time', type: 'text', placeholder: 'YYYY-MM-DDTHH:MM' },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'size', label: 'Size (px)', type: 'number', min: 10, max: 600 },
    { key: 'color', label: 'Color', type: 'color' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    const node = document.createElement('div');
    el.appendChild(node);

    function render() {
      node.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;font-family:' + s.font + ';color:' + s.color + ';';
      const ms = new Date(s.target).getTime() - ctx.now().getTime();
      const m = Math.max(0, Math.floor(ms / 60000));
      node.innerHTML = '';
      const big = document.createElement('div');
      big.style.fontSize = s.size + 'px';
      big.textContent = Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h ' + (m % 60) + 'm';
      const small = document.createElement('div');
      small.style.fontSize = s.size * 0.3 + 'px';
      small.textContent = s.label;
      node.appendChild(big);
      node.appendChild(small);
    }

    render();
    let stop: (() => void) | null = everySecond(render);

    return {
      update(next) { s = next; render(); },
      resize() { render(); },
      setActive(active) {
        if (stop) stop();
        stop = active ? everySecond(render) : null;
      },
      destroy() {
        if (stop) stop();
        el.removeChild(node);
      },
    };
  },
};
```

## 3. Register it

Add it to `projector/shared/widgets/registry.ts`:

```ts
import { countdownWidget } from './countdown';

const ALL: WidgetDefinition<any>[] = [ /* ... */, countdownWidget];
```

That's all. It now appears under **Add layer** in the editor, has a generated settings panel, and renders on the projector.

## The contract

### `mount(el, ctx)`

`el` is an empty, absolutely positioned box of exactly `ctx.size` pixels (the layer's *content size*, before warping). Fill it with plain DOM, or a `<canvas>` with a 2D context. The renderer warps the box onto the quad; you never deal with corners or perspective.

| `ctx` field | What it is |
|---|---|
| `settings` | Current settings, with defaults filled in for any keys a saved layer is missing. |
| `size` | `{ w, h }` content size. The same object is updated in place before `resize()` is called. |
| `now()` | Server-corrected time. Use it instead of `new Date()` so every screen agrees. |
| `state` | Shared live state: `get()` and `subscribe(fn)` (returns an unsubscribe). Timer, Spotify and so on live here from later milestones. |
| `sendCommand(cmd)` | Sends a command through the wall API (from milestone 3). |
| `theme` | Default font and colors. |
| `mode` | `'display'` on the projector, `'editor'` in the editor preview. Show hints and loading messages only in the editor; the projector should stay black. |

### What `mount` returns

| Method | When it's called | If you leave it out |
|---|---|---|
| `update(settings)` | A setting changed in the editor. | The widget is destroyed and mounted again. Fine for cheap widgets. |
| `resize(size)` | The content size changed. | Remounted. |
| `onState(state)` | Live state changed. | Nothing happens. |
| `onCommand(cmd)` | A command was routed to the widget (later milestone). | Nothing happens. |
| `setActive(active)` | The layer was hidden or shown. Stop timers and animation frames while inactive. | Keeps running while hidden. |
| `destroy()` | **Required.** The layer was removed, or is being remounted. Remove your DOM and clear every timer, listener and subscription. | — |

### Settings schema

Each entry needs a `key`, a `label` and a `type`. It can also have `help` text, and a `when: { key, is: [...] }` condition that shows the field only while another setting has one of those values.

| `type` | Editor control | Value |
|---|---|---|
| `text` | Input, or a textarea with `multiline: true` | string |
| `number` | Number input (`min`, `max`, `step`) | number |
| `color` | Color picker plus a text box (any CSS color works) | string |
| `select` | Dropdown from `options: [{ value, label }]` | string |
| `toggle` | Checkbox | boolean |
| `font` | Font picker (`FONT_OPTIONS`, system fonts only) | CSS font-family string |
| `image` | URL box plus an **Upload image** button | URL string |
| `location` | City search (Open-Meteo geocoding) | `{ name, lat, lon }` |

To add a new field type, extend `SettingsField` in `widgets/types.ts` and add a case to `projector/edit/SettingsForm.tsx`.

### Rules for the projector

The display runs on a weak, possibly old Android WebView.

- **No WebGL, React or big libraries.** Plain DOM, SVG or Canvas 2D only.
- **ES2017 only.** esbuild converts newer syntax, but it does not polyfill APIs: avoid `Object.fromEntries`, `Array.prototype.flat`, `String.prototype.replaceAll`, `structuredClone`, `ResizeObserver` and similar.
- **Animate cheaply.** Animate `transform` and `opacity` in CSS, or draw on a canvas in `requestAnimationFrame`. Cap counts (see `particles`), and stop in `setActive(false)` and while `document.hidden`.
- **Tick with `everySecond`** from `widgets/util.ts` for clocks: one shared, second-aligned timer instead of one per widget.
- **Leave empty areas transparent.** The page is black, and black is "no light" on a projector.
- **Keep the bundle small.** `npm run build:display` prints the gzipped size and fails above 150 KB.

### Data from the outside

- **Keyless public APIs** that allow cross-origin requests can be fetched directly from the widget. Share and cache them the way `projector/shared/weather.ts` does, so two widgets don't double the requests.
- **Anything with secrets or OAuth** (Spotify, Google) goes through the Worker in `projector/server/integrations/`. Its results are pushed into live state, and the widget reads them with `ctx.state`.

## Built-in widgets to copy from

| Widget | Shows how to |
|---|---|
| `shape` | Use `update()` with no remount, and `when` conditions. |
| `clock`, `text` | Tick with `everySecond` and pause in `setActive`. |
| `media` | Skip `update()` (remount on change), and pause video when hidden. |
| `particles` | Run a capped Canvas 2D animation at 30 fps and stop when hidden. |
| `sunArc`, `weather` | Use shared fetched data, the `location` field, and editor-only loading text. |
