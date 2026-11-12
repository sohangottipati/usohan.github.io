# Projector Wall — `sohan.website/projector`

A browser-based projection-mapping tool for my room projector, plus a plugin system for live widgets (Spotify, Google Calendar, timers, to-dos, and more). It works like MapClub-style mapping tools: you drag shapes onto real objects on the wall. On top of that it adds live, controllable widgets and a command API, so voice assistants and other devices can control the wall.

> **For Claude Code:** read this whole file before writing code. Inspect the existing `sohan.website` repo first and match its framework, hosting and deploy setup. If something here conflicts with how the site is built, ask me before choosing. Build in the milestone order at the bottom and stop after each milestone so I can test it.

---

## 1. How it's used

- **Display (projector):** the projector has its own built-in browser. It opens `sohan.website/projector/display`, goes fullscreen and shows only the mapped scene, with no UI. The browser is **weak and possibly outdated**, so this page must be very lightweight (see §8).
- **Editor (laptop or desktop):** `sohan.website/projector/edit`. I drag, resize and warp layers here, and **the projector updates live** as I edit. I never edit on the projector itself; I only have its remote.
- **Commands (voice, scripts, other devices):** a small authenticated HTTP API, so Siri Shortcuts, an Alexa skill, a Raspberry Pi, or a tiny wake-word listener on my PC can send commands like "skip song" or "start a 25-minute timer".
- **No heavy local processing.** Everything runs in the browser plus free-tier cloud services. My PC is not required for the wall to work.

---

## 2. Core mapping features (MapClub-like)

### Layers
- A scene is an ordered list of **layers**. Each layer has a 4-corner quad (top-left, top-right, bottom-right, bottom-left) in display pixels, and content (a widget).
- Content is warped onto the quad with a **perspective transform**. Use CSS `matrix3d` computed from the 4 corners (a homography). Don't use WebGL, so it runs on weak browsers.
- Per-layer controls: visible, locked, opacity, z-order (up/down, front/back), duplicate, delete, rename.

### Editing (in the editor, mirrored live to the display)
- **Drag the middle** of a layer to move it.
- **Drag a corner handle** to resize or warp it.
  - **Ratio lock ON:** a corner drag scales the whole quad uniformly about the opposite corner and keeps its shape.
  - **Ratio lock OFF:** free corner pin, so a layer can be fit exactly to a real object like an AC vent or a frame.
  - Global toggle, plus a per-layer override.
- Hold **Shift** to temporarily flip ratio lock.
- **Arrow keys** nudge the selected corner or layer by 1px (Shift + arrow = 10px).
- **Snap** to other layers' edges and corners and to the display edges (toggleable).
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z).
- **Calibration aids:** a grid / test-pattern overlay, plus a "highlight" mode that fills each quad with a bright solid color so it's easy to line up on the wall. These show on the projector too while toggled on.
- **Mapping-only mode:** a layer can be a plain shape (solid color, gradient, image or video) used just to light up a real object.

### Display canvas
- Logical canvas size is configurable (default 1920×1080). The display page scales it to fit the projector's actual resolution and keeps the aspect ratio.
- **Global keystone / corner pin:** one master quad for the whole output, to correct projector angle before per-layer mapping.

### Scenes / presets
- Multiple named scenes, e.g. "Default", "Focus", "Party", "Sleep". Switch them from the editor or by command.
- Scenes can share layers or have their own.
- **Import / export** scenes as JSON for backups.

### Saving
- Autosave on every change (debounced). Changes sync to the display in real time.

---

## 3. Widget (plugin) system — the important part

Every piece of content is a **widget** implementing one interface, so new integrations can be added without touching the editor or display code.

```ts
interface WidgetDefinition<Settings = any, State = any> {
  type: string;                     // "clock", "spotify.nowPlaying", ...
  name: string;                     // shown in the "Add layer" menu
  defaultSize: { w: number; h: number };
  settingsSchema: SettingsField[];  // auto-generates the settings panel in the editor
  defaultSettings: Settings;
  requires?: ("spotify" | "google" | "weather")[];  // integrations it needs
  mount(el: HTMLElement, ctx: WidgetContext<Settings, State>): WidgetInstance;
}

interface WidgetInstance {
  update?(settings: any): void;     // settings changed in the editor
  onState?(state: any): void;       // shared live state changed (e.g. timer, now playing)
  onCommand?(cmd: Command): void;   // command routed to this widget
  destroy(): void;
}

interface WidgetContext<S, T> {
  settings: S;
  size: { w: number; h: number };   // pre-warp content size
  now(): Date;
  state: LiveState;                 // read/subscribe to shared synced state
  sendCommand(cmd: Command): Promise<void>;
  theme: Theme;
}
```

- Widgets render plain DOM/CSS (Canvas 2D is allowed if needed). No WebGL and no heavy libraries on the display page.
- Each widget lives in its own folder: `widgets/<type>/index.ts` plus optional styles. Register it in one `widgets/registry.ts`.
- The editor builds each widget's settings panel automatically from `settingsSchema` (text, number, color, select, toggle, font, image upload).

### Built-in widgets (first set)
| Widget | Notes |
|---|---|
| Clock | 12/24h, date line, font/size/color |
| Text | Static or templated text (`{time}`, `{date}`) |
| Shape / color | Solid, gradient, glow border. For lighting real objects |
| Image / video | Uploaded or URL, fit/cover, loop |
| Starfield / particles | Light background ambience, shooting stars on a random interval |
| Sun arc | Sunrise → sunset arc with the current sun position (Open-Meteo, no key) |
| Weather | Current temperature + condition icon (Open-Meteo) |
| Timer / Pomodoro | Countdown ring; start/pause/reset by command; optional chime |
| To-do list | Synced with Google Tasks; add/complete by command; overdue highlighting |
| Calendar agenda | Today/tomorrow events from Google Calendar |
| Spotify now playing | Album art, title, artist, progress bar that resets each track, play state |

Design the system so these can be added later without core changes: an animated "hand" that reaches and presses the Spotify skip button, a music visualizer, focus mode, a sleep wind-down scene, mini games, and gesture/camera input.

---

## 4. Integrations (server side)

All secrets and OAuth tokens live on the server, never in the browser.

- **Spotify:** OAuth with refresh tokens stored server-side. Server routes:
  - `GET /api/spotify/now-playing` (or polled and pushed into live state every ~3s while the display is connected)
  - `POST /api/spotify/{next|previous|play|pause|volume}`
  - Playback control needs Spotify Premium. If it fails, show a clear error in the editor rather than crashing.
- **Google:** one OAuth connection with Calendar (read) and Tasks (read/write) scopes.
- **Weather / sun:** Open-Meteo (no key). Location is set in settings; default Riverside, CA.
- An **Integrations page** in the editor shows connect/disconnect buttons and status for each service.
- Write each integration as its own module, `server/integrations/<name>.ts`, so new ones (Home Assistant, Discord, GitHub, etc.) slot in the same way.

---

## 5. Command API (for voice and other devices)

`POST /api/command` with header `Authorization: Bearer <COMMAND_TOKEN>`.

```json
{ "type": "timer.start", "payload": { "minutes": 25, "label": "Focus" } }
```

Initial command types:

| Type | Payload |
|---|---|
| `spotify.next` / `spotify.previous` / `spotify.pause` / `spotify.play` | — |
| `spotify.volume` | `{ "percent": 40 }` |
| `timer.start` / `timer.pause` / `timer.reset` | `{ "minutes", "label" }` |
| `todo.add` | `{ "text", "due"? }` |
| `todo.complete` | `{ "text" }` (fuzzy match) or `{ "id" }` |
| `scene.set` | `{ "name": "Focus" }` |
| `display.blackout` / `display.wake` | — |
| `text.say` | `{ "text", "seconds" }` shows a temporary message on the wall |

- Also accept **plain text**, `{ "text": "skip the song" }`, and parse it with simple keyword/regex rules into the commands above. This is so Siri Shortcuts can just send dictated text. Keep the parser in one file so it's easy to extend.
- Return a short spoken-friendly reply, e.g. `{ "ok": true, "reply": "Timer set for 25 minutes" }`, so Siri/Alexa can read it back.
- Rate-limit, and log the last ~50 commands (viewable in the editor).
- Document in this repo how to make an iOS Shortcut that calls this endpoint.

---

## 6. Live sync

- The editor, display and server share one **live state**: scenes, layers, timer, Spotify now-playing, to-dos, etc.
- Use real-time push (WebSocket or a hosted realtime DB). Pick whatever fits the existing hosting. Suggestions: Cloudflare Workers + Durable Objects, or Firebase Realtime Database / Supabase Realtime (free tiers).
- The display must **auto-reconnect** after Wi-Fi drops, and do a full page reload if it's been disconnected for more than ~60s.
- Timers are computed from a server timestamp (`endsAt`), not by counting in the browser, so they stay correct after a reconnect.

---

## 7. Security

- **Editor:** only I can access it. Simple password login with an HTTP-only session cookie, or Cloudflare Access if the site is on Cloudflare.
- **Display:** read-only. Opened via `/projector/display?k=<DISPLAY_KEY>` so it doesn't need a login typed on a projector remote. The key can be rotated from the editor.
- **Command API:** bearer token (`COMMAND_TOKEN`), rotatable.
- No secrets in client bundles. Use env vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EDITOR_PASSWORD`, `DISPLAY_KEY`, `COMMAND_TOKEN`, `SESSION_SECRET`.

---

## 8. Display performance rules (weak projector browser)

- Target an **old Android WebView / Chromium**. Transpile to **ES2017**, include only needed polyfills, and avoid newer APIs without fallbacks.
- **Display bundle under ~150 KB gzipped.** No React on the display page unless the existing site forces it; vanilla TS is preferred there. The editor can use any framework.
- Animate only `transform` and `opacity`. Cap particle counts. Use `requestAnimationFrame`, and pause animations for hidden layers.
- Request a Screen Wake Lock if available, and also fall back to a tiny looping muted video to keep the projector from sleeping.
- Black background (`#000`) everywhere that's empty, so a projector shows nothing there.
- Provide a `?debug=1` mode on the display that shows FPS and connection status.

---

## 9. Suggested structure (adapt to the existing repo)

```
projector/
  display/            # lightweight output page
  edit/               # editor UI
  shared/
    homography.ts     # 4-corner → matrix3d
    types.ts          # Scene, Layer, Quad, Command, LiveState
    widgets/
      registry.ts
      clock/  text/  shape/  media/  particles/  sunArc/  weather/
      timer/  todo/  calendar/  spotifyNowPlaying/
  server/
    api/command.ts
    api/state.ts
    integrations/spotify.ts  google.ts  weather.ts
    commands/parseText.ts
  docs/
    ios-shortcut.md
    adding-a-widget.md
```

Data model sketch:

```ts
type Quad = [[number,number],[number,number],[number,number],[number,number]]; // TL, TR, BR, BL

interface Layer {
  id: string; name: string;
  widget: string; settings: Record<string, any>;
  quad: Quad; contentSize: { w: number; h: number };
  visible: boolean; locked: boolean; opacity: number; ratioLock?: boolean;
}

interface Scene { id: string; name: string; layers: Layer[]; }

interface Project {
  canvas: { w: number; h: number };
  masterQuad: Quad;
  scenes: Scene[]; activeSceneId: string;
  ratioLock: boolean; snap: boolean;
}
```

---

## 10. Milestones (build in this order and stop after each one)

1. **Mapping core.** Display + editor pages, layers with shape/image/text/clock widgets, drag/warp/ratio lock/snap/nudge/undo, grid + highlight calibration, autosave, live sync to the display. *Acceptance:* I can line up a rectangle exactly on my AC vent from my laptop, and the projector updates live.
2. **Widget system.** Settings panels generated from the schema, the registry, `docs/adding-a-widget.md`, plus the particles, sun arc and weather widgets.
3. **Command API + timer.** `/api/command` with the token, the text parser, the timer widget, the command log, and `docs/ios-shortcut.md`. *Acceptance:* "Hey Siri, wall timer 10 minutes" shows a countdown on the wall.
4. **Spotify.** OAuth, now-playing widget (progress resets per track), skip/pause by command.
5. **Google.** Calendar agenda + Tasks to-do widget, `todo.add` / `todo.complete` by command.
6. **Scenes.** Named scenes, `scene.set` by command, import/export JSON.
7. **Polish.** Display hardening (reconnect, wake lock, debug mode), performance check on a low-end browser, a mobile-friendly editor layout.

---

## 11. Out of scope for now (but keep it possible)

- Running voice recognition in the browser. Voice comes in through the command API from Siri, Alexa, or a small listener on another device.
- Camera/gesture input. Later, a separate page could run hand tracking on a device with a webcam and send commands through the same API.
- Multi-user accounts. This is a single-owner tool.
