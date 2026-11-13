# Jarvis

Jarvis is the wall's assistant. It understands requests the built-in phrases don't, does several things at once, remembers the last few minutes, answers questions about your day, talks back through the projector, and speaks up on its own when a timer finishes or a class is about to start.

> "Hey Siri, Wall… my pizza's done in like 12 minutes" → *Pizza timer set. Twelve minutes.*
> "…actually make that 30" → *Thirty minutes on the pizza.*
> "…focus mode, 25 minutes, and pause the music" → three actions, one reply.
> "…do I have time for a nap before class?" → answered from your calendar and timer.

## How a request flows

1. **Built-in phrases first.** "timer 10 minutes", "skip", "focus mode" and the rest run instantly and for free, exactly as before.
2. **Everything else goes to the brain:** anything the phrases don't know, phrases that are only a guess (a bare "pause" could mean the music or the timer), and sentences with several requests ("…, … and …").
3. The brain sees a short **snapshot** of the wall (time, scenes, timer, what's playing, upcoming events, to-dos) plus the last few exchanges. It answers with a plan: which wall commands to run, and what to say.
4. The wall runs the commands. If any of them fails (say, Spotify isn't connected), the reply says what actually happened instead of the model's guess.

The brain can only use the wall's own commands (timer, scenes, Spotify, to-dos, calendar events, messages, blackout, briefing, Canvas, memory), so it can't do anything you couldn't do yourself. Email is never in its snapshot: inbox summaries are text-only, so a malicious email can't make it act.

## Choosing a brain (editor → **Jarvis**)

| Brain | Cost | Notes |
|---|---|---|
| **Off** | Free | Built-in phrases only |
| **Workers AI** (default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) | **Free** within Cloudflare's daily allowance (10,000 "neurons" a day, shared by all Workers AI use) | Open model running on Cloudflare, next to your wall. Good at commands. To use a different text-generation model from the Workers AI catalog, paste its id. |
| **Claude** (Opus 5.5, Sonnet 5.5 or Haiku 5.5) | Paid, from your Claude API credits (separate from a Claude Pro subscription) | The smartest, especially for questions and multi-step requests. Haiku 5.5 is very cheap for this. |

You can check how much of the free allowance you've used in the Cloudflare dashboard → **AI → Workers AI**. If it runs out for the day, the built-in phrases keep working.

### Setting up Workers AI (free)

1. Deploy the latest API. The `[ai]` binding in `wrangler.toml` turns Workers AI on; there's nothing else to sign up for.
   ```bash
   cd ~/usohan.github.io/projector/server && git pull && npm install && npm run deploy
   ```
2. Editor → **Jarvis** → Brain: **Workers AI** → **Save**. The status should say **Ready**.
3. Try "my pizza's done in like 12 minutes" in the **Try it** box.

### Setting up Claude (optional, paid)

1. At https://platform.claude.com, create an account, add credit, and **set a monthly spend limit**.
2. Create an API key, then store it on the server:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
3. Editor → **Jarvis** → Brain: **Claude**, then pick a model → **Save**.

## Voice

**Speak through the projector** has three settings:

- **Announcements and briefings only** (default). Siri already reads replies on your phone, so the wall only speaks for timers, events and briefings.
- **Every reply.** Good once you have a room mic.
- **Never.**

Voice is MeloTTS on Workers AI, which costs a tiny fraction of the free allowance. The projector's browser only plays sound after **one press of a remote button** (the same press that makes it fullscreen). **Test voice** plays a line on the projector and in the editor.

**Also show what Jarvis says on the wall** puts the words up as a message. They go in your **Message** layer if you have one, otherwise in the middle of the wall.

A room mic, or any script, can ask for a spoken reply by adding `"voice": "wall"` to its `/api/command` request:

```json
{ "text": "what's next", "voice": "wall" }
```

## Announcements and briefing

- **Timers:** "Your pizza timer is done." Pomodoro: "Focus session done. Take five minutes." / "Break's over. Back to focus."
- **Events:** "Heads up: CS 100 lecture starts in 10 minutes." (Lead time is set in the panel.)
- **Canvas deadlines:** "Heads up: HW 3 for CS 100 is due in 3 hours, and it isn't submitted yet." Once per assignment, only if it's still unsubmitted. Lead time (hours) is set in the panel.
- **Morning briefing:** weather for the place you pick, today's events, and overdue or due-today to-dos, at the time you set. If the projector is off then, it waits up to 4 hours for a display to connect. Say **"good morning"** or **"brief me"** any time, or use **Brief me now** in the panel.

With a brain on, the briefing is phrased naturally; without one, it's a plain summary. All announcements show up in **Commands → Recent commands** with the source *jarvis*.

## Routines

A routine is one phrase that runs several steps. In the panel's **Routines** section, **Add starter routines** gives you:

- **I'm home:** wake up, default scene, play music, "Welcome back.", morning briefing
- **Goodnight:** sleep scene, volume 25, "Going dark in ten minutes.", wait 10 min, pause the music, blackout

Steps come in three kinds:

| Kind | Value | Example |
| --- | --- | --- |
| Do | any built-in wall phrase | `focus mode`, `volume 30`, `timer 25 minutes`, `blackout` |
| Say aloud | what Jarvis says | `Time to wind down.` |
| Wait (min) | minutes before the next step | `10` |

"Do" steps use the built-in phrase parser, not the brain, so they're instant, free and predictable. Run one by saying any of its phrases ("Hey Siri, Wall… goodnight", "run goodnight") or with **Run now** after saving. Say **"cancel the routine"** to drop steps that are still waiting. With a brain on, you can also ask loosely ("I'm heading to bed"). Limits: 20 routines, 15 steps each.

## Class mode

Turn on **Class mode** in the panel. An event counts as a class when it's on one of the calendars you list (e.g. `UCR`), or when its title looks like a course code ("CS 100", "MATH 10A"). All-day events never count.

When a class starts:

- the wall switches to the scene you picked (e.g. a "Focus" scene with an Agenda and a Class layer)
- Jarvis stays quiet until it ends (optional; captions still show)

When it ends, the wall switches back, unless you changed the scene yourself during class.

The **Class** layer shows "In class · CS 100 · 40 min left · MSE 104" with a progress bar, or the next class if it starts within a few hours.

## Agenda layer

**Agenda** puts calendar events and Canvas deadlines in one list, grouped by day (Today, Tomorrow, then weekdays). Missing Canvas work goes at the top in red. Optionally it also shows to-dos that have a due date. Events happening now get a "Now" marker, and finished events fade.

## AI usage layer

**AI usage** shows what Jarvis has used **today** and **this month**:
- requests, with tokens in and out
- spoken replies and errors
- estimated cost for Claude, plus a split between Claude and Workers AI

Workers AI shows $0 because it's free up to Cloudflare's daily allowance. Claude's cost is estimated from the token counts each reply reports, at list prices:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
| --- | --- | --- |
| Opus 5.5 | $4 | $20 |
| Sonnet 5.5 | $2 | $10 |
| Haiku 5.5 | $0.10 | $0.50 |

Set a **monthly budget** to get a bar that turns red when you pass it. Your exact bill is in the Anthropic Console.

## Answers with the projector off

Calendar, to-dos and Canvas only refresh in the background while a display or the editor is open. If you ask through Siri while everything is closed, Jarvis first refetches anything older than a few minutes (waiting at most 6 seconds), so the answer uses current data. If Canvas or the calendar can't be reached, Jarvis says so rather than claiming you have nothing due.

## Memory

Jarvis has three kinds of memory:

| | What it is | How long |
|---|---|---|
| **Conversation** | The last few exchanges, so "make that 30" works | Minutes (set in the panel; default 5) |
| **About me** | A box in the panel for standing facts: school, routines, preferences | Until you change it (up to 1,000 characters) |
| **Memories** | Facts you ask it to keep: "remember that Mom's birthday is March 3" | Until you delete them (up to 50 facts / 3,000 characters) |

- **"Remember that …"** saves a fact. **"Forget …"** removes the closest match ("forget the pizza thing"). **"What do you know about me?"** reads them back. These work even with the brain off.
- Jarvis **only saves what you ask it to**. It never quietly collects things from conversation.
- The **Memories** list in the panel shows everything saved; click a fact to edit it, or ✕ to delete it.
- About me and every saved fact go to the model with every request. That's what makes answers personal, and it's why there's a cap: a maxed-out memory still leaves room for roughly 100+ requests a day on the free default model.
- The model doesn't learn or change; the memory is just text it's shown each time, so you can always see exactly what it knows.

## Personality

Name and **house rules** are in the panel, e.g. *"Call me boss. Keep replies under 10 words."* **Memory** sets how long it remembers the conversation for follow-ups (default 5 minutes; 0 turns it off).

## Privacy

With a brain on, the request and the wall snapshot (scene names, timer, the song playing, upcoming event titles and times, open to-dos) go to the chosen provider: Cloudflare Workers AI or Anthropic. Neither trains on API traffic by default. Nothing is sent when the brain is **Off**. See `/projector/privacy`.
