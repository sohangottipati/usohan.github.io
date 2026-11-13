import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'wall · privacy',
  description: 'Privacy policy for Projector Wall, a personal projection-mapping tool.',
  robots: { index: true, follow: false },
};

const wrap: React.CSSProperties = {
  maxWidth: 680,
  margin: '0 auto',
  padding: '56px 20px 80px',
  lineHeight: 1.6,
  textTransform: 'none',
};

export default function ProjectorPrivacyPage() {
  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>Projector Wall: privacy policy</h1>
      <p style={{ opacity: 0.6, marginTop: 0 }}>Last updated November 13, 2026</p>

      <p>
        Projector Wall is a personal tool that runs one room projector. It has a single user: the owner of sohan.website. It is not offered to
        anyone else, and it has no accounts, ads or analytics.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>What it accesses</h2>
      <ul>
        <li>
          <b>Google Calendar (read-only):</b> event titles, times, locations and calendar colors for roughly yesterday through the next two days,
          to show an agenda on the wall and answer &quot;what&apos;s next&quot;.
        </li>
        <li>
          <b>Google Tasks:</b> the default task list, to show it on the wall, and to add or complete tasks when the owner asks by voice.
        </li>
        <li>
          <b>Google account email:</b> only to show which account is connected.
        </li>
        <li>
          <b>Spotify (if connected):</b> what is currently playing, and playback controls (skip, pause, play, volume).
        </li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>How it is used and stored</h2>
      <ul>
        <li>Data is used only to display it on the owner&apos;s wall and editor, and to carry out the owner&apos;s own commands.</li>
        <li>
          Sign-in tokens and the latest calendar, task and now-playing data are kept in the app&apos;s own storage on Cloudflare (a Durable
          Object). They never reach the projector or a browser as tokens.
        </li>
        <li>Nothing is sold, used for advertising, or used to train AI models, and nothing is shared beyond the services named on this page.</li>
        <li>
          If the owner turns on the assistant (&quot;Jarvis&quot;), a spoken request is sent with a short snapshot (event titles and times,
          open tasks, the song playing) to the AI provider the owner picked, Cloudflare Workers AI or Anthropic&apos;s API, only to work
          out what to do. Neither provider trains models on this API traffic by default.
        </li>
        <li>Calendar data is never modified. Tasks are only created or completed when the owner asks.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Removing access</h2>
      <p>
        Choose <b>Disconnect</b> in the editor&apos;s Integrations panel, which deletes the stored tokens and revokes Google access. You can also
        remove access at any time at{' '}
        <a href="https://myaccount.google.com/permissions" style={{ textDecoration: 'underline' }}>
          myaccount.google.com/permissions
        </a>{' '}
        or{' '}
        <a href="https://www.spotify.com/account/apps/" style={{ textDecoration: 'underline' }}>
          spotify.com/account/apps
        </a>
        .
      </p>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Google API data</h2>
      <p>
        Projector Wall&apos;s use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ textDecoration: 'underline' }}>
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Contact</h2>
      <p>
        Questions: reach the owner through the contact links on <a href="https://sohan.website" style={{ textDecoration: 'underline' }}>sohan.website</a>.
      </p>
    </main>
  );
}
