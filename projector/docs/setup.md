# Projector wall: setup

The wall has two parts:

| Part | Where it runs | What it is |
|---|---|---|
| Pages: `/projector/edit`, `/projector/display/` | GitHub Pages (this repo's existing deploy) | Static files. The editor is a Next.js page; the display is a tiny vanilla bundle built into `public/projector/display/`. |
| API + live sync | Cloudflare Worker `projector-wall` at `projector-api.sohan.website` | One Durable Object holds the project, live state and every WebSocket. Secrets live here only. |

## Local development

```bash
npm install
```

```bash
cd projector/server && npm install && cp .dev.vars.example .dev.vars
```

Edit `projector/server/.dev.vars` to set a password, then run the API and the site in two terminals:

```bash
cd projector/server && npm run dev
```

```bash
npm run dev
```

- Editor: http://localhost:3000/projector/edit (on localhost it talks to the API on `localhost:8787` automatically)
- Display: http://localhost:3000/projector/display/index.html?k=local-display-key (add `&debug=1` for FPS and connection status)

Local Durable Object data lives in `projector/server/.wrangler/state`; delete it to start fresh.

## One-time production setup

### 1. Move sohan.website DNS to Cloudflare (free plan)

1. In the Cloudflare dashboard: **Add a domain** → `sohan.website` → Free plan. Cloudflare imports your existing records.
2. Make sure these records exist so GitHub Pages keeps working, and set them to **DNS only** (grey cloud) so GitHub can keep issuing the HTTPS certificate:
   - `A  sohan.website  185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME  www  sohangottipati.github.io`
3. At your registrar, replace the nameservers with the two Cloudflare gives you. Wait until Cloudflare shows the domain as **Active**.

### 2. Deploy the Worker

```bash
cd projector/server && npx wrangler login
```

Set the secrets, choosing your own values (use long random strings for the key and secret):

```bash
npx wrangler secret put EDITOR_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

```bash
npx wrangler secret put DISPLAY_KEY
```

```bash
npm run deploy
```

The `routes` entry in `wrangler.toml` creates `projector-api.sohan.website` (DNS record and certificate) on the first deploy. Check it: https://projector-api.sohan.website/health should say `ok`.

### 3. Deploy the pages

Merge to `main`. The existing GitHub Action builds the site, including the display bundle.

### 4. Point the projector at the display

Sign in at https://sohan.website/projector/edit. With no layer selected, the right panel shows the **display link**. Open it in the projector's browser, then press OK on the remote to go fullscreen. You can bookmark it there.

## Before DNS is moved (optional)

You can deploy to `projector-wall.<you>.workers.dev` by commenting out `routes` in `wrangler.toml`. Then add `?api=https://projector-wall.<you>.workers.dev` to the editor URL; the display link the editor generates carries it along. The login cookie is cross-site in this setup, so Safari (and any browser blocking third-party cookies) won't keep you signed in. Use Chrome or Firefox until the custom domain is live.

## Secrets and keys

| Name | Purpose |
|---|---|
| `EDITOR_PASSWORD` | Editor login. 5 wrong attempts lock login for 5 minutes. |
| `SESSION_SECRET` | Signs the HTTP-only session cookie. Changing it signs everyone out. |
| `DISPLAY_KEY` | Initial display key. After you press **Rotate key** in the editor, the rotated key (stored in the Durable Object) is used instead. |
| `ALLOWED_ORIGINS` (var in `wrangler.toml`) | Origins allowed to use the editor cookie. |
| `COMMAND_TOKEN` (optional) | Bearer token for `/api/command`. If unset, one is generated on first use; see it, copy it and rotate it in the editor's **Commands** panel. See [ios-shortcut.md](ios-shortcut.md). |

| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | From your Spotify developer app. See [spotify.md](spotify.md). |
| `API_ORIGIN` (var in `wrangler.toml`) | Public address of the API, used for the Spotify and Google redirect URIs. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From your Google Cloud OAuth client. See [google.md](google.md). |
| `ANTHROPIC_API_KEY` (optional) | Only if Jarvis should use Claude. Workers AI (free) needs no key; it's the `[ai]` binding in `wrangler.toml`. See [jarvis.md](jarvis.md). |
