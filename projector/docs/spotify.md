# Spotify

The wall shows what's playing (album art, song, artist and a progress bar that resets each track), and you can skip, pause, resume and change the volume by voice or command.

Your Spotify login stays on the server. The Worker keeps the refresh token in its Durable Object and talks to Spotify itself; the browser and the projector never see a token.

> **Premium:** showing what's playing works on any account. Skip, pause, play and volume need **Spotify Premium** (Spotify's rule). Without it, you'll hear "Controlling playback needs Spotify Premium."

## One-time setup (about 5 minutes)

### 1. Create a Spotify app

1. Go to https://developer.spotify.com/dashboard and log in with the Spotify account whose music you want on the wall.
2. Click **Create app** and fill in:
   - **App name:** `Projector Wall` (anything works)
   - **App description:** `Now playing on my wall`
   - **Redirect URI:** `https://projector-api.sohan.website/api/spotify/callback`, then click **Add**
   - **Which API/SDKs are you planning to use?** tick **Web API**
3. Accept the terms and click **Save**.
4. On the app page, open **Settings**. Copy the **Client ID**, then click **View client secret** and copy that too.

To also run it locally (`npm run dev`), add a second Redirect URI: `http://127.0.0.1:8787/api/spotify/callback`. Spotify only allows plain `http` for `127.0.0.1`, not `localhost`.

### 2. Give the secrets to the server

In Terminal:

```bash
cd ~/usohan.github.io/projector/server && git pull
```

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
```

```bash
npx wrangler secret put SPOTIFY_CLIENT_SECRET
```

```bash
npm run deploy
```

Paste each value when asked.

### 3. Connect your account

1. Open the editor at https://sohan.website/projector/edit and click **Integrations** in the toolbar.
2. Click **Connect Spotify**, log in, and press **Agree**. You land back in the editor, and it shows *Connected as …*.
3. Add a **Spotify** layer and place it on the wall.

## Using it

| Say (via the Wall shortcut) | Does |
|---|---|
| skip · next song · skip this one | Next track |
| previous song · go back | Previous track |
| pause · pause the music | Pause |
| play · resume the music | Resume |
| volume 40 · set the volume to forty · turn it up · volume down · louder | Volume (up/down steps by 10) |
| what's playing · what song is this | Siri reads the song and artist |

The same actions are available as API routes. They take the command token as `Authorization: Bearer …`, or the editor login:

- `GET /api/spotify/now-playing`
- `POST /api/spotify/next`, `/previous`, `/play`, `/pause`
- `POST /api/spotify/volume` with `{ "percent": 40 }`

## How it updates

- While any screen (the projector or the editor) is connected, the server checks Spotify every **3 seconds** while music plays and every 10 seconds while it's paused. After 10 minutes of silence it slows to every 30 seconds.
- It only pushes an update to the screens when something changes: the song, play/pause, a seek, the volume or the device. Between updates the progress bar moves on its own, with the transform-only animation the projector likes.
- When no screen is connected, it doesn't poll at all.

## Troubleshooting

| You see | Fix |
|---|---|
| *Not set up on the server yet* | Steps 1–2: the two secrets are missing, or you haven't redeployed. |
| Spotify says **INVALID_CLIENT: Invalid redirect URI** | The Redirect URI in the Spotify app must be exactly `https://projector-api.sohan.website/api/spotify/callback`. |
| Spotify says the user isn't registered, or you get a 403 | In the app's **User Management**, add your Spotify account's name and email. |
| "Nothing is playing on Spotify. Start music on a device first." | Spotify can only control an active device: start something in the Spotify app once, then voice control works. |
| *Spotify access was revoked* | You removed the app's access in your Spotify account. Click **Connect Spotify** again. |
