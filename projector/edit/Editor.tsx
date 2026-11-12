'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, WallSocket } from '../shared/client';
import { setServerTime } from '../shared/live';
import type { Project, ServerMessage } from '../shared/types';
import { moveQuad, nudgeCorner } from './geometry';
import { deleteLayer, duplicateLayer, LayerPanel, PropertiesPanel } from './Panels';
import Stage from './Stage';
import { selectedLayer, setSenders, useEditor } from './store';
import css from './editor.module.css';

const SEND_INTERVAL_MS = 40;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(apiBase() + path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function Editor() {
  const authed = useEditor((s) => s.authed);

  useEffect(() => {
    api('/api/me')
      .then((d) => useEditor.getState().set({ authed: d.authed ? 'yes' : 'no' }))
      .catch((e) => useEditor.getState().set({ authed: 'no', error: 'Cannot reach the wall API (' + e.message + ')' }));
  }, []);

  return (
    <div className={css.root}>
      {authed === 'unknown' && <div className={css.center}>Connecting…</div>}
      {authed === 'no' && <Login />}
      {authed === 'yes' && <Workspace />}
    </div>
  );
}

function Login() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const error = useEditor((s) => s.error);
  return (
    <form
      className={css.login}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
          useEditor.getState().set({ authed: 'yes', error: null });
        } catch (err: any) {
          useEditor.getState().set({ error: err.message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className={css.loginTitle}>wall</h1>
      <p className={css.muted}>Projector editor</p>
      <input className={css.input} type="password" autoFocus placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className={css.primary} disabled={busy || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {error && <p className={css.errorText}>{error}</p>}
    </form>
  );
}

function Workspace() {
  const project = useEditor((s) => s.project);
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const [displayKey, setDisplayKey] = useState<string | null>(null);
  const socketRef = useRef<WallSocket | null>(null);
  // Edits made while offline are pushed to the server once we reconnect.
  const unsyncedRef = useRef(false);

  // ---------- socket + throttled project sending ----------
  useEffect(() => {
    let pending: Project | null = null;
    let timer: any = null;
    let lastSent = 0;
    const flush = () => {
      timer = null;
      if (!pending) return;
      if (socketRef.current?.send({ t: 'setProject', project: pending })) {
        lastSent = Date.now();
        pending = null;
        unsyncedRef.current = false;
      } else {
        unsyncedRef.current = true;
      }
    };
    setSenders(
      (p) => {
        pending = p;
        if (timer) return;
        const wait = Math.max(0, SEND_INTERVAL_MS - (Date.now() - lastSent));
        timer = setTimeout(flush, wait);
      },
      (calibration) => socketRef.current?.send({ t: 'setCalibration', calibration }),
    );

    const socket = new WallSocket({
      url: apiBase().replace(/^http/, 'ws') + '/ws',
      onMessage(msg: ServerMessage) {
        const st = useEditor.getState();
        if (msg.t === 'snapshot') {
          setServerTime(msg.serverTime);
          if (unsyncedRef.current && st.project) {
            socket.send({ t: 'setProject', project: st.project });
            socket.send({ t: 'setCalibration', calibration: st.live.calibration });
            unsyncedRef.current = false;
          } else {
            st.receive(msg.project);
            st.set({ live: msg.live });
          }
          st.set({ error: null });
        } else if (msg.t === 'project') {
          if (!st.gestureStart) st.receive(msg.project);
        } else if (msg.t === 'live') {
          st.set({ live: msg.live });
        } else if (msg.t === 'pong') {
          setServerTime(msg.serverTime);
        } else if (msg.t === 'error') {
          st.set({ error: msg.message });
          if (msg.message === 'Not logged in') st.set({ authed: 'no' });
        }
      },
      onStatus(s) {
        useEditor.getState().set({ status: s });
      },
    });
    socketRef.current = socket;
    socket.connect();
    const online = () => socket.kick();
    window.addEventListener('online', online);
    api('/api/display-key').then((d) => setDisplayKey(d.key)).catch(() => {});
    return () => {
      window.removeEventListener('online', online);
      socket.close();
      setSenders(null, null);
      clearTimeout(timer);
    };
  }, []);

  const rotateKey = useCallback(() => {
    api('/api/display-key/rotate', { method: 'POST', body: '{}' })
      .then((d) => setDisplayKey(d.key))
      .catch((e) => useEditor.getState().set({ error: e.message }));
  }, []);

  useKeyboard();

  if (!project) return <div className={css.center}>{error || 'Loading project…'}</div>;

  return (
    <div className={css.workspace}>
      <Toolbar />
      <div className={css.main}>
        <LayerPanel />
        <Stage />
        <PropertiesPanel displayKey={displayKey} onRotateKey={rotateKey} />
      </div>
      {error && (
        <div className={css.toast} onClick={() => useEditor.getState().set({ error: null })}>
          {error}
        </div>
      )}
      {status !== 'open' && <div className={css.offline}>Offline. Reconnecting; your changes will sync when it&apos;s back.</div>}
    </div>
  );
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick(): void; children: React.ReactNode; title?: string }) {
  return (
    <button className={on ? css.toggleOn : css.toggle} onClick={onClick} title={title} aria-pressed={on}>
      {children}
    </button>
  );
}

function Toolbar() {
  const project = useEditor((s) => s.project)!;
  const live = useEditor((s) => s.live);
  const status = useEditor((s) => s.status);
  const mode = useEditor((s) => s.mode);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const st = useEditor.getState();
  const cal = live.calibration;

  return (
    <header className={css.toolbar}>
      <span className={css.brand}>wall</span>
      <span className={css.status} data-status={status} title={status === 'open' ? 'Live: changes go straight to the projector' : status}>
        {status === 'open' ? 'live' : status}
      </span>
      <div className={css.group}>
        <Toggle on={mode === 'layers'} onClick={() => st.set({ mode: 'layers', selectedCorner: null })}>Layers</Toggle>
        <Toggle on={mode === 'keystone'} onClick={() => st.set({ mode: 'keystone', selectedCorner: null })} title="Global keystone / corner pin">
          Keystone
        </Toggle>
      </div>
      <div className={css.group}>
        <Toggle on={project.ratioLock} onClick={() => st.commit({ ...project, ratioLock: !project.ratioLock })} title="Corner drags scale uniformly (Shift flips)">
          Ratio lock
        </Toggle>
        <Toggle on={project.snap} onClick={() => st.commit({ ...project, snap: !project.snap })} title="Snap to edges and corners (Alt skips)">
          Snap
        </Toggle>
      </div>
      <div className={css.group}>
        <Toggle on={cal.grid} onClick={() => st.setCalibration({ grid: !cal.grid })} title="Grid / test pattern on the projector">
          Grid
        </Toggle>
        <Toggle on={cal.highlight} onClick={() => st.setCalibration({ highlight: !cal.highlight })} title="Fill every layer with a bright color">
          Highlight
        </Toggle>
      </div>
      <div className={css.group}>
        <button onClick={() => st.undo()} disabled={!canUndo} title="Ctrl+Z">Undo</button>
        <button onClick={() => st.redo()} disabled={!canRedo} title="Ctrl+Shift+Z">Redo</button>
      </div>
      <div className={css.spacer} />
      <button
        onClick={() =>
          api('/api/logout', { method: 'POST', body: '{}' }).finally(() => location.reload())
        }
      >
        Sign out
      </button>
    </header>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (!st.project) return;

      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key]) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = arrows[key][0] * step;
        const dy = arrows[key][1] * step;
        const opts = { coalesce: 'nudge' };
        if (st.mode === 'keystone') {
          if (st.selectedCorner === null) return;
          const q = nudgeCorner(st.project.masterQuad, st.selectedCorner, dx, dy);
          if (q) st.commit({ ...st.project, masterQuad: q }, opts);
          return;
        }
        const layer = selectedLayer(st);
        if (!layer || layer.locked) return;
        if (st.selectedCorner !== null) {
          const q = nudgeCorner(layer.quad, st.selectedCorner, dx, dy);
          if (q) st.updateLayer(layer.id, { quad: q }, opts);
        } else {
          st.updateLayer(layer.id, { quad: moveQuad(layer.quad, dx, dy) }, opts);
        }
        return;
      }
      if (key === 'escape') {
        if (st.selectedCorner !== null) st.set({ selectedCorner: null });
        else st.select(null);
        return;
      }
      if ((key === 'delete' || key === 'backspace') && st.selectedId && st.mode === 'layers') {
        e.preventDefault();
        deleteLayer(st.selectedId);
        return;
      }
      if (mod && key === 'd' && st.selectedId) {
        e.preventDefault();
        duplicateLayer(st.selectedId);
        return;
      }
      // Tab cycles the selected corner for precise nudging.
      if (key === 'tab' && (st.selectedId || st.mode === 'keystone')) {
        e.preventDefault();
        const c = st.selectedCorner === null ? 0 : (st.selectedCorner + (e.shiftKey ? 3 : 1)) % 4;
        st.set({ selectedCorner: c });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
