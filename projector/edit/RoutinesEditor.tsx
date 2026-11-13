'use client';

import { useEffect, useState } from 'react';
import { MAX_ROUTINE_STEPS, starterRoutines, type Routine, type RoutineStep } from '../shared/jarvis';
import { api } from './api';
import { sendCommand, useEditor } from './store';
import { useDelayed } from './useDelayed';
import css from './editor.module.css';

const PLACEHOLDER: Record<RoutineStep['kind'], string> = {
  do: 'a wall phrase, e.g. "sleep mode", "volume 25", "timer 25 minutes"',
  speak: 'what Jarvis says aloud',
  wait: 'minutes',
};

function newId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function RoutinesEditor({ initial }: { initial: Routine[] }) {
  const [routines, setRoutines] = useState<Routine[]>(initial);
  const [saved, setSaved] = useState<string>(JSON.stringify(initial));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showBusy = useDelayed(busy);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    setRoutines(initial);
    setSaved(JSON.stringify(initial));
  }, [initial]);
  const dirty = JSON.stringify(routines) !== saved;

  const update = (id: string, patch: Partial<Routine>) => setRoutines(routines.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setSteps = (r: Routine, steps: RoutineStep[]) => update(r.id, { steps });

  async function save() {
    setBusy(true);
    try {
      const d = await api('/api/jarvis/routines', { method: 'PUT', body: JSON.stringify({ routines }) });
      setRoutines(d.routines);
      setSaved(JSON.stringify(d.routines));
      setMsg('');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={css.section}>
      <h3 className={css.h3}>Routines</h3>
      <p className={css.help} style={{ marginTop: 0 }}>
        Say a routine&apos;s phrase (&quot;Hey Siri, Wall… goodnight&quot;) and its steps run in order. &quot;Do&quot; steps use the built-in phrases, so they&apos;re
        instant and free.
      </p>
      {routines.length === 0 && (
        <button
          onClick={() => {
            const add = starterRoutines().map((r) => ({ ...r, id: newId() }));
            setRoutines(add);
            setOpen(add[0].id);
          }}
        >
          Add starter routines (I&apos;m home, Goodnight)
        </button>
      )}
      <div className={css.routineList}>
        {routines.map((r) => {
          const isOpen = open === r.id;
          return (
            <div key={r.id} className={css.routineCard}>
              <button className={css.routineHead} onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <span className={css.routineName}>{r.name || 'Untitled'}</span>
                <span className={css.layerType}>&quot;{r.phrases[0] || r.name}&quot; · {r.steps.length} steps</span>
                <span className={css.chev} data-open={isOpen ? 'true' : 'false'}>
                  ›
                </span>
              </button>
              {/* Expander: grid rows 0fr → 1fr, the one layout animation allowed. Inert while closed. */}
              <div className={css.expander} data-open={isOpen ? 'true' : 'false'}>
                <div className={css.expanderInner} {...(isOpen ? {} : { inert: '' as any })}>
                  <div className={css.routineBody}>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>Name</span>
                      <input className={css.input} value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} />
                    </label>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>Phrases that run it (comma-separated)</span>
                      <input
                        className={css.input}
                        value={r.phrases.join(', ')}
                        onChange={(e) => update(r.id, { phrases: e.target.value.split(',').map((p) => p.trimStart()) })}
                        onBlur={(e) => update(r.id, { phrases: e.target.value.split(',').map((p) => p.trim()).filter(Boolean) })}
                      />
                    </label>
                    <span className={css.fieldLabel}>Steps</span>
                    <ol className={css.stepList}>
                      {r.steps.map((st, i) => (
                        <li key={i} className={css.stepRow}>
                          <select
                            className={css.input}
                            value={st.kind}
                            onChange={(e) => setSteps(r, r.steps.map((x, j) => (j === i ? { kind: e.target.value as RoutineStep['kind'], value: x.value } : x)))}
                          >
                            <option value="do">Do</option>
                            <option value="speak">Say aloud</option>
                            <option value="wait">Wait (min)</option>
                          </select>
                          <input
                            className={css.input}
                            type={st.kind === 'wait' ? 'number' : 'text'}
                            min={st.kind === 'wait' ? 1 : undefined}
                            placeholder={PLACEHOLDER[st.kind]}
                            value={st.value}
                            onChange={(e) => setSteps(r, r.steps.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                          />
                          <button
                            className={css.iconBtn}
                            title="Move up"
                            disabled={i === 0}
                            onClick={() => {
                              const s = r.steps.slice();
                              [s[i - 1], s[i]] = [s[i], s[i - 1]];
                              setSteps(r, s);
                            }}
                          >
                            ↑
                          </button>
                          <button className={css.iconBtn} title="Remove step" onClick={() => setSteps(r, r.steps.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className={css.layerActions}>
                      <button disabled={r.steps.length >= MAX_ROUTINE_STEPS} onClick={() => setSteps(r, [...r.steps, { kind: 'do', value: '' }])}>
                        + Step
                      </button>
                      <button
                        disabled={dirty}
                        title={dirty ? 'Save first' : 'Run it now, like saying its phrase'}
                        onClick={async () => {
                          const res = await sendCommand({ text: r.phrases[0] || r.name });
                          setMsg((res.ok ? '' : '⚠ ') + res.reply);
                        }}
                      >
                        Run now
                      </button>
                      <button
                        className={css.danger}
                        onClick={() => {
                          setRoutines(routines.filter((x) => x.id !== r.id));
                          useEditor.getState().set({ notice: { text: 'Removed ' + r.name + '. Save to keep it removed.', at: Date.now() } });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={css.row}>
        <button
          onClick={() => {
            const r: Routine = { id: newId(), name: 'New routine', phrases: ['new routine'], steps: [{ kind: 'do', value: '' }] };
            setRoutines([...routines, r]);
            setOpen(r.id);
          }}
        >
          + New routine
        </button>
        <button className={css.primary} disabled={!dirty || busy} onClick={save}>
          {busy && showBusy ? 'Saving…' : dirty ? 'Save routines' : 'Saved'}
        </button>
      </div>
      {msg && <p className={msg.indexOf('⚠') === 0 ? css.replyBad : css.replyOk}>{msg}</p>}
      <p className={css.help}>Say &quot;cancel the routine&quot; to stop steps that are still waiting.</p>
    </section>
  );
}
