# Control the wall with Siri (iOS Shortcut)

One shortcut called **Wall** listens to what you say, sends it to the wall, and reads back the reply:

> "Hey Siri, Wall" → *(Siri listens)* → "timer ten minutes" → the countdown appears on the wall, and Siri says "Timer set for 10 minutes."

Siri can't pass extra words to a shortcut in the same sentence, so it's two parts. If you pause briefly after "Wall", it feels like one sentence: "Hey Siri, Wall … timer ten minutes."

## What you need

From the editor at https://sohan.website/projector/edit, open **Commands** in the toolbar and copy:

- the **URL**: `https://projector-api.sohan.website/api/command`
- the **token** (click **Show**, then **Copy**)

## Build the shortcut (about 3 minutes)

1. Open the **Shortcuts** app, tap **+**, and rename the shortcut **Wall** (tap the name at the top).
2. **Add Action → Dictate Text.** Tap the arrow on the action and set *Stop Listening* to **After Pause**.
3. **Add Action → Get Contents of URL.**
   - Replace `URL` with `https://projector-api.sohan.website/api/command`.
   - Tap the arrow to show more options:
     - **Method:** `POST`
     - **Token (pick one):** either **Headers → Add new header** with key `Authorization` and text `Bearer YOUR_TOKEN` (the word *Bearer*, a space, then the token), or, simpler, add a second **Text** field to the JSON body below with key `token` and your token as the value.
     - **Request Body:** `JSON`. **Add new field → Text**, key `text`. For the value, tap it and choose the **Dictated Text** variable.
4. **Add Action → Get Dictionary Value.** Set it to *Get* **Value** *for* `reply` *in* **Contents of URL**.
5. **Add Action → Speak Text**, with **Dictionary Value** as the text. (Use **Show Result** instead if you'd rather read it than hear it.)
6. Tap **Done**. Then say **"Hey Siri, Wall"** and try "timer one minute".

It also works from the Apple Watch and the Mac, and from a HomePod if *Personal Requests* is on.

### One-tap buttons (no voice)

Duplicate the shortcut, delete **Dictate Text**, and set the `text` field to fixed words such as `start a pomodoro` or `blackout`. Add it to the Home Screen, a widget, the Action button, or **Back Tap** (Settings → Accessibility → Touch → Back Tap).

## Things to say

| Say | Does |
|---|---|
| timer 10 minutes · set a timer for an hour and a half · 5 minute tea timer · focus timer 25 minutes | Starts a countdown (with a label if you name one) |
| pause the timer · resume the timer · add 5 minutes · cancel the timer | Controls the running timer |
| how much time is left | Siri reads the remaining time |
| start a pomodoro · stop pomodoro | 25 min focus / 5 min break, with a 15 min break every 4th round, until stopped |
| say dinner is ready · show Happy Birthday for 30 seconds | Shows a message on the wall (10 s by default) |
| blackout · turn off the wall · go dark / wake up · turn on | Blacks out the projector / brings it back |
| focus mode · switch to party scene · next scene · what scenes do I have | Scenes (see [scenes.md](scenes.md)) |
| skip the song · previous song · pause · play · volume 40 · turn it up · what's playing | Spotify (see [spotify.md](spotify.md)) |
| add buy milk to my list · remind me to call mom tomorrow · complete buy milk · what's on my list | Google Tasks (see [google.md](google.md)) |
| what's on my calendar today · what's next | Google Calendar |
| add dentist next tuesday at 3 · undo that | Add calendar events (see [google.md](google.md)) |
| check my email · any new emails? | Gmail summary (optional) |
| what's due this week · any homework due tomorrow | Canvas (see [canvas.md](canvas.md)) |

"Wall", "Hey Siri", "please" and punctuation are ignored, and numbers can be digits or words. With **Jarvis** turned on (editor → Jarvis), you can also say things any way you like, ask questions, or chain requests. See [jarvis.md](jarvis.md). The phrases live in [`projector/server/src/commands/parseText.ts`](../server/src/commands/parseText.ts); add a rule there to teach it new ones.

## API reference (for scripts, Alexa, a Raspberry Pi…)

`POST https://projector-api.sohan.website/api/command`, with the header `Authorization: Bearer <COMMAND_TOKEN>`.

The body can be any of these:

```json
{ "text": "timer 10 minutes" }
```

```json
{ "type": "timer.start", "payload": { "minutes": 25, "label": "Focus" } }
```

or plain text (`Content-Type: text/plain`): `timer 10 minutes`.

Add `"voice": "wall"` to have Jarvis also speak the reply through the projector (useful for room mics).

The reply is always JSON:

```json
{ "ok": true, "reply": "Timer set for 10 minutes.", "command": { "type": "timer.start", "payload": { "minutes": 10, "label": "" } } }
```

`ok` is `false` (still with HTTP 200, so the assistant reads the reply aloud) when the text wasn't understood, or the command couldn't run.

| Status | Meaning |
|---|---|
| 200 | Handled; read `ok` and `reply` |
| 400 | Body wasn't text or JSON |
| 401 | Missing or wrong token |
| 429 | More than 30 commands a minute, or 10 bad tokens a minute (wait a minute) |

### Command types

| Type | Payload |
|---|---|
| `timer.start` | `{ "minutes", "seconds"?, "label"? }`; with no payload it resumes a paused timer; `{ "pomodoro": true, "focusMinutes"?, "breakMinutes"? }` |
| `timer.pause` · `timer.reset` · `timer.status` | — |
| `timer.add` | `{ "minutes" }` |
| `text.say` | `{ "text", "seconds"? }` (1–3600, default 10) |
| `display.blackout` · `display.wake` | — |
| `scene.set` | `{ "name" }` (case-insensitive, prefix match is fine) |
| `scene.next` · `scene.previous` · `scene.list` | — |
| `spotify.next` · `spotify.previous` · `spotify.play` · `spotify.pause` · `spotify.status` | — |
| `spotify.volume` | `{ "percent" }` or `{ "delta": 10 }` |
| `todo.add` | `{ "text", "due"? }` (`today`, `tomorrow`, `friday`, `next monday` or `YYYY-MM-DD`) |
| `todo.complete` | `{ "text" }` (fuzzy match) or `{ "id" }` |
| `todo.list` · `calendar.today` · `calendar.next` | — |

### curl

```bash
curl -X POST https://projector-api.sohan.website/api/command -H "Authorization: Bearer $COMMAND_TOKEN" -H "Content-Type: application/json" -d '{"text": "timer 10 minutes"}'
```

## The token

The editor's **Commands** panel shows the token and can **rotate** it. After rotating, update the header in every shortcut or script. The last 50 commands, from any source, are listed in the same panel.

To pick the token yourself instead, run `npx wrangler secret put COMMAND_TOKEN` in `projector/server`. It's used until you first rotate from the editor.
