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
- **Morning briefing:** weather for the place you pick, today's events, and overdue or due-today to-dos, at the time you set. If the projector is off then, it waits up to 4 hours for a display to connect. Say **"good morning"** or **"brief me"** any time, or use **Brief me now** in the panel.

With a brain on, the briefing is phrased naturally; without one, it's a plain summary. All announcements show up in **Commands → Recent commands** with the source *jarvis*.

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
