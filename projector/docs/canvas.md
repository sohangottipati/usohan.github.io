# Canvas

Read-only Canvas: what's due, what's submitted, what's missing. It powers the **Canvas: due soon** widget, the "what's due" voice command, the morning briefing, and what Jarvis knows when you ask "what should I work on?".

## Connect (2 minutes)

1. Open Canvas (at UCR, https://elearn.ucr.edu) and go to **Account → Settings**.
2. Under **Approved Integrations**, click **+ New Access Token**. Purpose: `Projector wall`. Leave the expiry empty, or pick a date (you'll reconnect then). Click **Generate Token**.
3. Copy the token. Canvas only shows it once.
4. In the wall editor → **Integrations** → **Canvas**: put your Canvas address (e.g. `elearn.ucr.edu`), paste the token, and click **Connect Canvas**.

It checks the token with Canvas right away, then says **Connected as …** with how many items are upcoming and missing.

> If **+ New Access Token** isn't there, your school has turned off student tokens. Tell me and we'll look at other options.

The token is stored on your server (in the Durable Object) and never shown again in the editor. **Disconnect** deletes it. You can also delete it in Canvas (**Account → Settings → Approved Integrations**) at any time.

## What it reads

The Canvas planner from a week ago to three weeks ahead: assignments, quizzes and discussions, with their course, due time, and whether they're submitted or missing. Announcements and other planner notes are skipped. It refreshes every 15 minutes while a screen is open; **Refresh now** forces it.

## Use it

| Say | Does |
|---|---|
| what's due this week · any homework due tomorrow · what's due next week | Reads what's due and anything missing |
| good morning | The briefing includes work due in the next day and a half, and missing work |
| (Jarvis on) what should I work on tonight? | Answers using your Canvas deadlines, calendar and to-dos |

The **Canvas: due soon** widget lists missing work first (in red), then what's due, with "Today 11:59 PM" / "Tomorrow" / weekday labels. Its settings cover how many days ahead, how many items, course names and colors.

Command: `canvas.due { "days"?: number }`.
