# Google Calendar and Tasks

Two widgets and some voice commands, from one Google connection:

- **Calendar:** today's and tomorrow's events from every calendar you have ticked in Google Calendar. The current event is marked *Now*, and finished events fade out.
- **To-do list:** your Google Tasks list (*My Tasks*). Overdue items show in red, and due dates show as *Today*, *Tomorrow*, *Mon* and so on.
- **Voice:** "add buy milk to my list", "remind me to call mom tomorrow", "complete buy milk", "what's on my list", "what's on my calendar today", "what's next".

The wall can read your calendar but never changes it. It can read, add and complete tasks. Your Google login stays on the server.

## One-time setup (about 10 minutes)

Google's setup has more clicks than Spotify's, but you only do it once.

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/projectcreate, name it `Projector Wall`, and click **Create**. Make sure it's the selected project (top bar) for the next steps.

### 2. Turn on the two APIs

Open each link and click **Enable**:

- Calendar: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- Tasks: https://console.cloud.google.com/apis/library/tasks.googleapis.com

### 3. Set up the consent screen

1. Go to https://console.cloud.google.com/auth/overview and click **Get started**.
2. **App name:** `Projector Wall`. **User support email:** your Gmail. Click **Next**.
3. **Audience:** **External**. Click **Next**.
4. **Contact information:** your Gmail. Click **Next**, agree, then **Create**.
5. Go to **Audience** (left menu) and click **Publish app**, then **Confirm**, so the status says *In production*.

> **Why publish?** While an app is in *Testing*, Google makes its logins expire after **7 days**, and the wall would lose your calendar every week. Publishing doesn't make anything public. Since only you will use it, Google doesn't need to review it; you'll just see an "unverified app" warning once when you connect.

### 4. Create the OAuth client

1. Go to https://console.cloud.google.com/auth/clients and click **Create client**.
2. **Application type:** **Web application**. **Name:** `Projector Wall`.
3. Under **Authorized redirect URIs**, click **Add URI** and paste exactly: `https://projector-api.sohan.website/api/google/callback`
4. Click **Create**. Copy the **Client ID** and the **Client secret** right away: Google only shows the secret once. If you miss it, open the client and click **Add secret**.

### 5. Give the two values to the server

In Terminal, type each `secret put` command **exactly as written**. Only paste your value when it asks *Enter a secret value*.

```bash
cd ~/usohan.github.io/projector/server && git pull
```

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

```bash
npm run deploy
```

Check it with `npx wrangler secret list`. You should see `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` by name.

### 6. Connect

1. Open https://sohan.website/projector/edit → **Integrations** → **Connect Google**.
2. Pick your account. Google warns **"Google hasn't verified this app"**. It's your own app, so click **Advanced** → **Go to Projector Wall (unsafe)**.
3. **Tick both boxes** (see your calendars, and create/edit your tasks), then click **Continue**.
4. Back in the editor, it says *Connected as you@gmail.com*, with counts for events and tasks.
5. Add **Calendar** and **To-do list** layers to the wall.

## Voice

| Say | Does |
|---|---|
| add buy milk to my list · add laundry to my to-do list tomorrow · add essay to my list for Friday | Adds a task, with a due date if you say one |
| remind me to call mom · remind me tomorrow to call mom · remind me to pay rent on Monday | Adds a task (due date optional) |
| complete buy milk · check off laundry · mark the essay as done · I finished the essay | Completes the best-matching task. Close enough is fine: "the essay" matches "Submit CS 100 essay" |
| what's on my list · what do I need to do | Siri reads up to 5 tasks |
| what's on my calendar today · what do I have today | Siri reads today's events |
| what's next · when is my next meeting | Siri reads the next timed event |

Due dates understand *today*, *tonight*, *tomorrow* and weekdays ("Friday", "next Monday"), in your Google Calendar's time zone.

As API commands: `todo.add { text, due? }` (`due` is a word above or `YYYY-MM-DD`), `todo.complete { text }` or `{ id }`, `todo.list`, `calendar.today`, `calendar.next`.

## How it updates

While a screen is connected, tasks refresh every minute and the calendar every 5 minutes. Voice changes show immediately. **Refresh now** in Integrations forces both.

## Troubleshooting

| You see | Fix |
|---|---|
| *Not set up on the server yet* | Step 5: the secrets are missing or misnamed (check `npx wrangler secret list`). |
| Google says **redirect_uri_mismatch** | The Authorized redirect URI in step 4 must be exactly `https://projector-api.sohan.website/api/google/callback`. |
| Google says **access blocked** / **app not available** | Step 3: the app must be *In production*, or you must be added as a test user under **Audience**. |
| *Missing access to Calendar / Tasks* | A box was left unticked. **Disconnect**, then **Connect Google**, ticking both. |
| It disconnects every week | The app is still in *Testing*. Publish it (step 3.5), then connect again. |
| Calendar or Tasks says the API is disabled | Step 2: enable that API in the same project as the OAuth client. |
