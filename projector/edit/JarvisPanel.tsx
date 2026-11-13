'use client';

import { useEffect, useState } from 'react';
import { CLAUDE_MODELS, MAX_ABOUT_ME_CHARS, MAX_FACTS, MAX_MEMORY_CHARS, WORKERS_MODELS, type JarvisSettings, type MemoryFact } from '../shared/jarvis';
import { playSpeech } from '../shared/widgets/util';
import { api } from './api';
import { LocationInput } from './SettingsForm';
import { sendCommand, useEditor } from './store';
import css from './editor.module.css';

interface Status {
  ready: string | null;
  workersAI: boolean;
  claudeKey: boolean;
  lastError: string | null;
  lastMs: number;
  displays: number;
  nextBriefing: number | null;
}

const DOCS = 'https://github.com/sohangottipati/usohan.github.io/blob/main/projector/docs/jarvis.md';
const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];

export default function JarvisPanel() {
  const [saved, setSaved] = useState<JarvisSettings | null>(null);
  const [draft, setDraft] = useState<JarvisSettings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [tryText, setTryText] = useState('');
  const [facts, setFacts] = useState<MemoryFact[]>([]);

  const load = () =>
    api('/api/jarvis')
      .then((d) => {
        setSaved(d.settings);
        setDraft(d.settings);
        setStatus(d.status);
        setFacts(d.facts || []);
        setError(null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  // A "remember that…" from Siri or another device: refresh the list when a new command lands.
  const latest = useEditor((st) => (st.commandLog[0] ? st.commandLog[0].at : 0));
  useEffect(() => {
    if (latest) refreshFacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  if (error) return aside(<p className={css.errorText}>{error.indexOf('404') >= 0 || error === 'Not found' ? 'The wall API is on older code without Jarvis. Run git pull && npm install && npm run deploy in projector/server.' : error}</p>);
  if (!draft || !status) return aside(<p className={css.muted}>Loading…</p>);

  const set = (patch: Partial<JarvisSettings>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy('save');
    try {
      const d = await api('/api/jarvis', { method: 'PUT', body: JSON.stringify(draft) });
      setSaved(d.settings);
      setDraft(d.settings);
      setStatus(d.status);
      flash('Saved');
    } catch (e: any) {
      useEditor.getState().set({ error: e.message });
    } finally {
      setBusy('');
    }
  }

  function flash(t: string) {
    setNote(t);
    setTimeout(() => setNote(''), 2500);
  }

  async function testVoice() {
    setBusy('voice');
    try {
      const d = await api('/api/jarvis/test-voice', { method: 'POST', body: '{}' });
      // Also play it here, so you can hear it without the projector.
      playSpeech(d.audio, d.mime || 'audio/mpeg', d.text);
      flash(d.ok ? (d.displays ? `Speaking on ${d.displays} display${d.displays === 1 ? '' : 's'} and here` : 'Playing here (no display connected)') : 'No server voice available; using this browser’s voice');
    } catch (e: any) {
      useEditor.getState().set({ error: e.message });
    } finally {
      setBusy('');
    }
  }

  async function tryIt(text: string) {
    if (!text.trim()) return;
    setBusy('try');
    const r = await sendCommand({ text });
    setBusy('');
    flash('');
    setNote((r.ok ? '' : '⚠ ') + r.reply);
    refreshFacts(); // "remember that…" may have changed the list
  }

  function refreshFacts() {
    api('/api/jarvis')
      .then((d) => setFacts(d.facts || []))
      .catch(() => {});
  }

  const brainLabel = draft.provider === 'workers-ai' ? 'Workers AI model' : 'Claude model';
  const models = draft.provider === 'workers-ai' ? WORKERS_MODELS : CLAUDE_MODELS;

  return aside(
    <>
      <section className={css.section}>
        <h3 className={css.h3}>Brain</h3>
        <label className={css.field}>
          <span className={css.fieldLabel}>Understands anything the built-in phrases don&apos;t</span>
          <select className={css.input} value={draft.provider} onChange={(e) => set({ provider: e.target.value as JarvisSettings['provider'] })}>
            <option value="off">Off: built-in phrases only</option>
            <option value="workers-ai">Workers AI: free, open models on Cloudflare</option>
            <option value="claude">Claude: smartest, paid (needs an API key)</option>
          </select>
        </label>
        {draft.provider !== 'off' && (
          <label className={css.field}>
            <span className={css.fieldLabel}>{brainLabel}</span>
            <input className={css.input} list="jarvis-models" value={draft.provider === 'workers-ai' ? draft.workersModel : draft.claudeModel} onChange={(e) => set(draft.provider === 'workers-ai' ? { workersModel: e.target.value } : { claudeModel: e.target.value })} />
            <datalist id="jarvis-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {draft.provider === 'claude' && <span className={css.help}>Opus 5.5 is the smartest; Haiku 5.5 is far cheaper and plenty for wall commands.</span>}
          </label>
        )}
        <StatusLine draft={draft} saved={saved!} status={status} />
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Personality</h3>
        <div className={css.cornerRow} style={{ gridTemplateColumns: '90px 1fr' }}>
          <span className={css.cornerName}>Name</span>
          <input className={css.input} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>House rules (optional)</span>
          <textarea className={css.input} rows={3} placeholder="e.g. Call me boss. Keep replies under 10 words." value={draft.personality} onChange={(e) => set({ personality: e.target.value })} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>
            About me ({draft.aboutMe.length}/{MAX_ABOUT_ME_CHARS})
          </span>
          <textarea
            className={css.input}
            rows={4}
            maxLength={MAX_ABOUT_ME_CHARS}
            placeholder="e.g. CS + Business student at UCR. Classes are on my calendar. Bedtime is around 1 AM. Pizza means a 12-minute oven timer."
            value={draft.aboutMe}
            onChange={(e) => set({ aboutMe: e.target.value })}
          />
        </label>
        <div className={css.cornerRow} style={{ gridTemplateColumns: '1fr 80px' }}>
          <span className={css.cornerName}>Remembers the conversation for (minutes)</span>
          <input className={css.input} type="number" min={0} max={60} value={draft.memoryMinutes} onChange={(e) => set({ memoryMinutes: +e.target.value })} />
        </div>
      </section>

      <Memories facts={facts} setFacts={setFacts} name={draft.name} />

      <section className={css.section}>
        <h3 className={css.h3}>Voice</h3>
        <label className={css.field}>
          <span className={css.fieldLabel}>Speak through the projector</span>
          <select className={css.input} value={draft.voice} onChange={(e) => set({ voice: e.target.value as JarvisSettings['voice'] })}>
            <option value="announcements">Announcements and briefings only (Siri already reads replies)</option>
            <option value="all">Every reply</option>
            <option value="off">Never</option>
          </select>
        </label>
        <label className={css.checkRow}>
          <input type="checkbox" checked={draft.captions} onChange={(e) => set({ captions: e.target.checked })} />
          <span>Also show what {draft.name} says on the wall</span>
        </label>
        <div className={css.row}>
          <button onClick={testVoice} disabled={!!busy}>
            {busy === 'voice' ? 'Speaking…' : 'Test voice'}
          </button>
        </div>
        <p className={css.help}>The projector plays sound after one press of a remote button. Free voice: MeloTTS on Workers AI.</p>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Announcements</h3>
        <label className={css.checkRow}>
          <input type="checkbox" checked={draft.announceTimers} onChange={(e) => set({ announceTimers: e.target.checked })} />
          <span>Timer done and Pomodoro switches</span>
        </label>
        <label className={css.checkRow}>
          <input type="checkbox" checked={draft.announceEvents} onChange={(e) => set({ announceEvents: e.target.checked })} />
          <span>Calendar events, </span>
          <input className={css.input} style={{ width: 56 }} type="number" min={1} max={120} value={draft.eventLeadMinutes} onChange={(e) => set({ eventLeadMinutes: +e.target.value })} />
          <span>min before</span>
        </label>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Morning briefing</h3>
        <label className={css.checkRow}>
          <input type="checkbox" checked={draft.briefing} onChange={(e) => set({ briefing: e.target.checked })} />
          <span>Every day at</span>
          <input className={css.input} style={{ width: 110 }} type="time" value={draft.briefingTime} onChange={(e) => set({ briefingTime: e.target.value })} />
        </label>
        <div className={css.field} style={{ marginTop: 8 }}>
          <span className={css.fieldLabel}>Time zone</span>
          <input className={css.input} list="jarvis-zones" value={draft.timeZone} onChange={(e) => set({ timeZone: e.target.value })} />
          <datalist id="jarvis-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>Weather for</span>
          <LocationInput value={draft.location} onChange={(v) => set({ location: v })} />
        </div>
        <p className={css.help}>Weather, today&apos;s events and urgent to-dos. If the projector is off at that time, it waits up to 4 hours for it to come on. Or say &quot;good morning&quot;.</p>
        <div className={css.row}>
          <button disabled={!!busy || dirty} title={dirty ? 'Save first' : undefined} onClick={async () => {
            setBusy('brief');
            try {
              const r = await api('/api/jarvis/briefing', { method: 'POST', body: '{}' });
              setNote(r.reply);
            } catch (e: any) {
              useEditor.getState().set({ error: e.message });
            } finally {
              setBusy('');
            }
          }}>
            {busy === 'brief' ? 'Thinking…' : 'Brief me now'}
          </button>
        </div>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Try it</h3>
        <form
          className={css.row}
          onSubmit={(e) => {
            e.preventDefault();
            tryIt(tryText);
          }}
        >
          <input className={css.input} value={tryText} placeholder="my pizza's done in like 12 minutes" onChange={(e) => setTryText(e.target.value)} />
          <button type="submit" disabled={!!busy || !tryText.trim() || dirty} title={dirty ? 'Save first' : undefined}>
            {busy === 'try' ? '…' : 'Ask'}
          </button>
        </form>
        <p className={css.help}>
          Works from Siri too, with the same shortcut.{' '}
          <a className={css.link} href={DOCS} target="_blank" rel="noreferrer">
            How Jarvis works
          </a>
        </p>
      </section>

      <div className={css.saveBar}>
        <span className={note.indexOf('⚠') === 0 ? css.replyBad : css.replyOk}>{note}</span>
        <button className={css.primary} disabled={!dirty || busy === 'save'} onClick={save}>
          {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
    </>,
  );
}

function aside(children: React.ReactNode) {
  return <aside className={css.right}>{children}</aside>;
}

function StatusLine({ draft, saved, status }: { draft: JarvisSettings; saved: JarvisSettings; status: Status }) {
  if (draft.provider === 'off') return <p className={css.help}>Only the built-in phrases work (see the Commands panel). Turn on a brain for anything else.</p>;
  if (draft.provider === 'workers-ai' && !status.workersAI) return <p className={css.replyBad}>Workers AI isn&apos;t available on the server. Redeploy the API (git pull && npm install && npm run deploy).</p>;
  if (draft.provider === 'claude' && !status.claudeKey)
    return (
      <p className={css.replyBad}>
        Add your API key first: in projector/server run <code>npx wrangler secret put ANTHROPIC_API_KEY</code>.
      </p>
    );
  if (draft.provider !== saved.provider) return <p className={css.help}>Save to switch brains.</p>;
  if (status.lastError) return <p className={css.replyBad}>Last problem: {status.lastError}</p>;
  return <p className={css.replyOk}>Ready{status.lastMs ? ` · last answer took ${(status.lastMs / 1000).toFixed(1)} s` : ''}</p>;
}

function Memories({ facts, setFacts, name }: { facts: MemoryFact[]; setFacts(f: MemoryFact[]): void; name: string }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const used = facts.reduce((n, f) => n + f.text.length, 0);

  async function call(path: string, method: string, body?: unknown) {
    try {
      const d = await api(path, { method, body: body ? JSON.stringify(body) : '{}' });
      setFacts(d.facts || []);
      setMsg(d.ok === false ? d.reply : '');
      return d;
    } catch (e: any) {
      setMsg(e.message);
      return null;
    }
  }

  return (
    <section className={css.section}>
      <h3 className={css.h3}>Memories</h3>
      <p className={css.help} style={{ marginTop: 0 }}>
        Say &quot;remember that…&quot;, &quot;forget…&quot; or &quot;what do you know about me&quot;. {name} only saves what you ask it to, and sees all of this with every request.
      </p>
      <div className={css.meter}>
        <div style={{ width: Math.min(100, (used / MAX_MEMORY_CHARS) * 100) + '%' }} />
      </div>
      <p className={css.help}>
        {facts.length}/{MAX_FACTS} facts · {used}/{MAX_MEMORY_CHARS} characters
      </p>
      <ul className={css.factList}>
        {facts.map((f) => (
          <li key={f.id} className={css.factItem}>
            {editing === f.id ? (
              <input
                autoFocus
                className={css.input}
                defaultValue={f.text}
                onBlur={async (e) => {
                  if (e.target.value.trim() && e.target.value !== f.text) await call('/api/jarvis/memories/' + f.id, 'PUT', { text: e.target.value });
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span className={css.factText} onClick={() => setEditing(f.id)} title="Click to edit">
                {f.text}
              </span>
            )}
            <button className={css.iconBtn} title="Forget this" onClick={() => call('/api/jarvis/memories/' + f.id, 'DELETE')}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className={css.row}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const d = await call('/api/jarvis/memories', 'POST', { text });
          if (d && d.ok) setText('');
        }}
      >
        <input className={css.input} value={text} placeholder="Mom's birthday is March 3" onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
      {msg && <p className={css.replyBad}>{msg}</p>}
    </section>
  );
}
