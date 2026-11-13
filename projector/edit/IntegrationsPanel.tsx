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

const DOCS = 'https://github.com/sohangottipati/usohan.github.io/blob/main/projector/docs/spotify.md';

export default function IntegrationsPanel() {
  const live = useEditor((s) => s.live);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    api('/api/integrations')
      .then((d) => {
        setSpotify(d.spotify);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(refresh, [refresh]);
  // Live state flips when Spotify connects/disconnects elsewhere; refresh the card.
  const sp = live.spotify;
  const liveConnected = !!sp;
  useEffect(() => {
    if (spotify && liveConnected !== spotify.connected) refresh();
  }, [liveConnected, spotify, refresh]);

  async function connect() {
    setBusy(true);
    try {
      const returnTo = location.origin + location.pathname + (new URLSearchParams(location.search).get('api') ? '?api=' + encodeURIComponent(new URLSearchParams(location.search).get('api')!) : '');
      const d = await api('/api/spotify/connect', { method: 'POST', body: JSON.stringify({ returnTo }) });
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
              <button className={css.inlineBtn} onClick={refresh}>
                check again
              </button>
            </p>
          </>
        )}

        {spotify && spotify.configured && !spotify.connected && (
          <>
            <p className={css.muted}>Not connected.</p>
            {spotify.error && <p className={css.replyBad}>{spotify.error}</p>}
            <button className={css.primary} style={{ marginTop: 8 }} disabled={busy} onClick={connect}>
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
        <p className={css.muted}>Coming in milestone 5.</p>
      </section>
    </aside>
  );
}
