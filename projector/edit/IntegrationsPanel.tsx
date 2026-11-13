'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useEditor } from './store';
import css from './editor.module.css';

interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  user: string;
  product: string;
  error: string | null;
  redirectUri: string;
}

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string;
  calendar: boolean;
  tasks: boolean;
  timeZone: string;
  error: string | null;
  redirectUri: string;
}

const DOCS = 'https://github.com/sohangottipati/usohan.github.io/blob/main/projector/docs/spotify.md';
const GOOGLE_DOCS = 'https://github.com/sohangottipati/usohan.github.io/blob/main/projector/docs/google.md';

/** Where OAuth logins come back to: this editor page (keeping ?api= if present). */
function returnAddress(): string {
  const api = new URLSearchParams(location.search).get('api');
  return location.origin + location.pathname + (api ? '?api=' + encodeURIComponent(api) : '');
}

export default function IntegrationsPanel() {
  const live = useEditor((s) => s.live);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [copiedGoogle, setCopiedGoogle] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);

  /** manual: the user pressed "check again", so report when we checked. */
  const refresh = useCallback((manual?: unknown) => {
    const isManual = manual === true;
    if (isManual) setChecking(true);
    api('/api/integrations')
      .then((d) => {
        setSpotify(d.spotify);
        setGoogle(d.google || null);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => {
        if (isManual) {
          setChecking(false);
          setCheckedAt(new Date());
        }
      });
  }, []);

  useEffect(refresh, [refresh]);
  // Live state flips when Spotify connects/disconnects elsewhere; refresh the card.
  const sp = live.spotify;
  const liveConnected = !!sp;
  useEffect(() => {
    if (spotify && liveConnected !== spotify.connected) refresh();
  }, [liveConnected, spotify, refresh]);

  async function connect(service: 'spotify' | 'google' = 'spotify') {
    setBusy(true);
    try {
      const d = await api('/api/' + service + '/connect', { method: 'POST', body: JSON.stringify({ returnTo: returnAddress() }) });
      location.href = d.url;
    } catch (e: any) {
      useEditor.getState().set({ error: e.message });
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Spotify? The now-playing widget and voice controls stop until you connect again.')) return;
    setBusy(true);
    try {
      await api('/api/spotify/disconnect', { method: 'POST', body: '{}' });
      refresh();
    } catch (e: any) {
      useEditor.getState().set({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!confirm('Disconnect Google? The calendar and to-do widgets and to-do voice commands stop until you connect again.')) return;
    setBusy(true);
    try {
      await api('/api/google/disconnect', { method: 'POST', body: '{}' });
      refresh();
    } catch (e: any) {
      useEditor.getState().set({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  // Google connects/disconnects elsewhere flip live.todos; refresh the card.
  const googleLive = live.todos !== undefined && live.todos !== null;
  useEffect(() => {
    if (google && google.connected !== googleLive && (googleLive || google.connected)) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleLive]);

  return (
    <aside className={css.right}>
      <section className={css.section}>
        <h3 className={css.h3}>Spotify</h3>
        {loadError && <p className={css.errorText}>{loadError}</p>}
        {!spotify && !loadError && <p className={css.muted}>Loading…</p>}

        {spotify && !spotify.configured && (
          <>
            <p className={css.replyBad}>Not set up on the server yet.</p>
            <ol className={css.steps}>
              <li>
                Create an app at{' '}
                <a className={css.link} href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                  developer.spotify.com/dashboard
                </a>{' '}
                (choose <b>Web API</b>).
              </li>
              <li>
                Add this Redirect URI:
                <span className={css.row}>
                  <input className={css.input} readOnly value={spotify.redirectUri} onFocus={(e) => e.target.select()} />
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(spotify.redirectUri).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </li>
              <li>
                In <code>projector/server</code>, run <code>npx wrangler secret put SPOTIFY_CLIENT_ID</code>, then the same for <code>SPOTIFY_CLIENT_SECRET</code>.
              </li>
            </ol>
            <p className={css.help}>
              <a className={css.link} href={DOCS} target="_blank" rel="noreferrer">
                Full steps
              </a>{' '}
              · then{' '}
              <button className={css.inlineBtn} onClick={() => refresh(true)} disabled={checking}>
                {checking ? 'checking…' : 'check again'}
              </button>
            </p>
            {checkedAt && !checking && (
              <p className={css.help}>
                Still not set up · checked {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}. The server
                doesn&apos;t see SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET yet.
              </p>
            )}
          </>
        )}

        {spotify && spotify.configured && !spotify.connected && (
          <>
            <p className={css.muted}>Not connected.</p>
            {spotify.error && <p className={css.replyBad}>{spotify.error}</p>}
            <button className={css.primary} style={{ marginTop: 8 }} disabled={busy} onClick={() => connect('spotify')}>
              {busy ? 'Opening Spotify…' : 'Connect Spotify'}
            </button>
            <p className={css.help}>You&apos;ll log in on Spotify&apos;s site and come straight back here.</p>
          </>
        )}

        {spotify && spotify.connected && (
          <>
            <p className={css.replyOk}>
              Connected{spotify.user ? ` as ${spotify.user}` : ''}
              {spotify.product ? ` · ${spotify.product === 'premium' ? 'Premium' : spotify.product}` : ''}
            </p>
            {spotify.product && spotify.product !== 'premium' && (
              <p className={css.replyBad}>Skip, pause and volume need Spotify Premium. Now playing still works.</p>
            )}
            <div className={css.statusGrid} style={{ marginTop: 8 }}>
              <span className={css.fieldLabel}>Playing</span>
              <span>
                {sp && sp.track ? `${sp.track.name}${sp.track.artists ? ' · ' + sp.track.artists : ''}${sp.isPlaying ? '' : ' (paused)'}` : 'Nothing right now'}
              </span>
              {sp && sp.device && (
                <>
                  <span className={css.fieldLabel}>Device</span>
                  <span>
                    {sp.device}
                    {sp.volume !== null ? ` · volume ${sp.volume}` : ''}
                  </span>
                </>
              )}
            </div>
            {sp && sp.error && <p className={css.replyBad}>{sp.error}</p>}
            <div className={css.row}>
              <button className={css.danger} disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            </div>
            <p className={css.help}>
              Add a <b>Spotify</b> layer to show it on the wall. Say &quot;skip the song&quot;, &quot;pause&quot;, &quot;volume 40&quot; or &quot;what&apos;s playing&quot;.
            </p>
          </>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Weather &amp; sun</h3>
        <p className={css.replyOk}>Ready</p>
        <p className={css.help}>Open-Meteo, no key needed. Set the place on each Weather or Sun arc layer.</p>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Google Calendar &amp; Tasks</h3>
        {spotify && !google && (
          <p className={css.replyBad}>
            The wall API is running older code without Google. In <code>projector/server</code>, run <code>git pull &amp;&amp; npm run deploy</code>, then reload.
          </p>
        )}
        {google && !google.configured && (
          <>
            <p className={css.replyBad}>Not set up on the server yet.</p>
            <ol className={css.steps}>
              <li>
                In{' '}
                <a className={css.link} href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                  Google Cloud
                </a>
                , create a project, enable the Calendar and Tasks APIs, and create an OAuth client (Web application).
              </li>
              <li>
                Add this Authorized redirect URI:
                <span className={css.row}>
                  <input className={css.input} readOnly value={google.redirectUri} onFocus={(e) => e.target.select()} />
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(google.redirectUri).then(() => {
                        setCopiedGoogle(true);
                        setTimeout(() => setCopiedGoogle(false), 1500);
                      })
                    }
                  >
                    {copiedGoogle ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </li>
              <li>
                Run <code>npx wrangler secret put GOOGLE_CLIENT_ID</code> and <code>npx wrangler secret put GOOGLE_CLIENT_SECRET</code>, typed exactly like that,
                and paste each value when it asks.
              </li>
            </ol>
            <p className={css.help}>
              <a className={css.link} href={GOOGLE_DOCS} target="_blank" rel="noreferrer">
                Full steps
              </a>{' '}
              · then{' '}
              <button className={css.inlineBtn} onClick={() => refresh(true)} disabled={checking}>
                {checking ? 'checking…' : 'check again'}
              </button>
            </p>
            {checkedAt && !checking && (
              <p className={css.help}>
                Still not set up · checked {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.
              </p>
            )}
          </>
        )}
        {google && google.configured && !google.connected && (
          <>
            <p className={css.muted}>Not connected.</p>
            {google.error && <p className={css.replyBad}>{google.error}</p>}
            <button className={css.primary} style={{ marginTop: 8 }} disabled={busy} onClick={() => connect('google')}>
              {busy ? 'Opening Google…' : 'Connect Google'}
            </button>
            <p className={css.help}>
              Google may warn that the app isn&apos;t verified: it&apos;s your own app, so click <b>Advanced → Go to …</b>, and tick both Calendar and Tasks.
            </p>
          </>
        )}
        {google && google.connected && (
          <>
            <p className={css.replyOk}>Connected{google.email ? ` as ${google.email}` : ''}</p>
            {(!google.calendar || !google.tasks) && (
              <p className={css.replyBad}>
                Missing access to {[!google.calendar && 'Calendar', !google.tasks && 'Tasks'].filter(Boolean).join(' and ')}. Disconnect and connect again, ticking every box.
              </p>
            )}
            <div className={css.statusGrid} style={{ marginTop: 8 }}>
              <span className={css.fieldLabel}>Calendar</span>
              <span>{live.calendar ? (live.calendar.error ? live.calendar.error : `${live.calendar.events.length} events (yesterday–in 2 days)`) : 'Loading…'}</span>
              <span className={css.fieldLabel}>Tasks</span>
              <span>{live.todos ? (live.todos.error ? live.todos.error : `${live.todos.items.length} open in ${live.todos.listName}`) : 'Loading…'}</span>
              <span className={css.fieldLabel}>Time zone</span>
              <span>{google.timeZone}</span>
            </div>
            <div className={css.row}>
              <button
                onClick={() =>
                  api('/api/google/refresh', { method: 'POST', body: '{}' }).catch((e) => useEditor.getState().set({ error: e.message }))
                }
              >
                Refresh now
              </button>
              <button className={css.danger} disabled={busy} onClick={disconnectGoogle}>
                Disconnect
              </button>
            </div>
            <p className={css.help}>
              Add <b>Calendar</b> and <b>To-do list</b> layers. Say &quot;add buy milk to my list&quot;, &quot;remind me to call mom tomorrow&quot;, &quot;complete buy
              milk&quot;, &quot;what&apos;s on my list&quot; or &quot;what&apos;s next&quot;.
            </p>
          </>
        )}
      </section>
    </aside>
  );
}
