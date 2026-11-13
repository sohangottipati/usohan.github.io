'use client';

import { useEffect, useState } from 'react';
import { apiBase } from '../shared/client';
import { serverNow } from '../shared/live';
import { timerRemaining, type CommandResult } from '../shared/types';
import { formatClock } from '../shared/widgets/util';
import { api } from './api';
import { sendCommand, useEditor } from './store';
import css from './editor.module.css';

const QUICK: { label: string; text: string }[] = [
  { label: 'Timer 1 min', text: 'timer 1 minute' },
  { label: 'Pomodoro', text: 'start a pomodoro' },
  { label: 'Pause', text: 'pause the timer' },
  { label: 'Resume', text: 'resume the timer' },
  { label: '+5 min', text: 'add 5 minutes' },
  { label: 'Cancel', text: 'cancel the timer' },
  { label: 'Say hi', text: 'say Hello from the wall for 10 seconds' },
];

const DOCS = 'https://github.com/sohangottipati/usohan.github.io/blob/main/projector/docs/ios-shortcut.md';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export default function CommandsPanel() {
  const live = useEditor((s) => s.live);
  const log = useEditor((s) => s.commandLog);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CommandResult | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');
  useTick(1000);

  useEffect(() => {
    api('/api/command-token')
      .then((d) => setToken(d.token))
      .catch(() => setToken(null));
  }, []);

  async function run(t: string) {
    if (!t.trim()) return;
    setBusy(true);
    setLast(await sendCommand({ text: t }));
    setBusy(false);
  }

  function copy(what: string, value: string) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  const endpoint = apiBase() + '/api/command';
  const timer = live.timer;
  const left = timer ? timerRemaining(timer, serverNow()) : 0;
  const curl = `curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer ${showToken && token ? token : '$COMMAND_TOKEN'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "timer 10 minutes"}'`;

  return (
    <aside className={css.right}>
      <section className={css.section}>
        <h3 className={css.h3}>Try a command</h3>
        <form
          className={css.row}
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <input className={css.input} value={text} placeholder="timer 10 minutes" onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
        {last && <p className={last.ok ? css.replyOk : css.replyBad}>{last.reply}</p>}
        <div className={css.chips}>
          {QUICK.map((q) => (
            <button key={q.label} onClick={() => run(q.text)} disabled={busy} title={q.text}>
              {q.label}
            </button>
          ))}
        </div>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Now</h3>
        <div className={css.statusGrid}>
          <span className={css.fieldLabel}>Timer</span>
          <span>
            {!timer || timer.status === 'idle'
              ? 'Idle'
              : timer.status === 'paused'
                ? `Paused at ${formatClock(left)}`
                : left > 0
                  ? `${formatClock(left)} left`
                  : 'Finished'}
            {timer && timer.status !== 'idle' && timer.label ? ` · ${timer.label}` : ''}
          </span>
          <span className={css.fieldLabel}>Wall</span>
          <span>{live.blackout ? 'Blacked out' : 'On'}</span>
        </div>
        <p className={css.help}>Add a Timer layer to see the countdown on the wall.</p>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Command API</h3>
        <p className={css.help}>
          For Siri Shortcuts, Alexa, a Raspberry Pi or any script. <a href={DOCS} target="_blank" rel="noreferrer" className={css.link}>iOS Shortcut setup</a>
        </p>
        <div className={css.field}>
          <span className={css.fieldLabel}>URL (POST)</span>
          <span className={css.row}>
            <input className={css.input} readOnly value={endpoint} onFocus={(e) => e.target.select()} />
            <button onClick={() => copy('url', endpoint)}>{copied === 'url' ? 'Copied' : 'Copy'}</button>
          </span>
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>Token</span>
          <span className={css.row}>
            <input className={css.input} readOnly type={showToken ? 'text' : 'password'} value={token || ''} onFocus={(e) => e.target.select()} />
            <button onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button>
            <button onClick={() => token && copy('token', token)}>{copied === 'token' ? 'Copied' : 'Copy'}</button>
          </span>
          <button
            className={css.danger}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={() => {
              if (!confirm('Rotate the command token? Shortcuts and scripts using the old one will stop working until you update them.')) return;
              api('/api/command-token/rotate', { method: 'POST', body: '{}' })
                .then((d) => setToken(d.token))
                .catch((e) => useEditor.getState().set({ error: e.message }));
            }}
          >
            Rotate token
          </button>
        </div>
        <pre className={css.code}>{curl}</pre>
      </section>

      <section className={css.section}>
        <h3 className={css.h3}>Recent commands</h3>
        {log.length === 0 && <p className={css.muted}>Nothing yet.</p>}
        <ul className={css.logList}>
          {log.map((e, i) => (
            <li key={e.at + ':' + i} className={css.logItem}>
              <span className={css.logMeta}>
                {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · {e.source}
                {e.type ? ` · ${e.type}` : ''}
              </span>
              <span>{e.input}</span>
              <span className={e.ok ? css.replyOk : css.replyBad}>{e.reply}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
