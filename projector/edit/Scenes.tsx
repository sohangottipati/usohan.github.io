'use client';

// Scenes: switch, add, duplicate (with shared layers), rename, delete, and
// JSON import/export for backups. The active scene is what the wall shows.

import { useRef, useState } from 'react';
import { activeScene, type Layer, type Project, type Scene } from '../shared/types';
import { validateProject } from '../shared/validate';
import { newId, sharedFields, useEditor } from './store';
import css from './editor.module.css';

const FORMAT = 'projector-wall';

// ---------- operations ----------

function commit(next: Project, coalesce?: string) {
  useEditor.getState().commit(next, coalesce ? { coalesce } : undefined);
}

export function switchScene(id: string) {
  const p = useEditor.getState().project;
  if (!p || p.activeSceneId === id) return;
  commit({ ...p, activeSceneId: id });
  useEditor.getState().select(null);
}

function uniqueName(p: Project, base: string): string {
  const taken = (n: string) => p.scenes.some((s) => s.name.toLowerCase() === n.toLowerCase());
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(base + ' ' + i)) return base + ' ' + i;
}

/** duplicate: the new scene shares every layer with the current one. */
export function addScene(name: string, duplicate: boolean) {
  const p = useEditor.getState().project;
  if (!p) return;
  const cur = activeScene(p);
  const scene: Scene = { id: newId(), name: uniqueName(p, name.trim() || 'Scene'), layers: duplicate ? cur.layers.slice() : [] };
  commit({ ...p, scenes: [...p.scenes, scene], activeSceneId: scene.id });
  useEditor.getState().select(null);
}

export function renameScene(id: string, name: string) {
  const p = useEditor.getState().project;
  const n = name.trim();
  if (!p || !n) return;
  commit({ ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, name: n } : s)) });
}

export function deleteScene(id: string) {
  const p = useEditor.getState().project;
  if (!p || p.scenes.length < 2) return;
  const i = p.scenes.findIndex((s) => s.id === id);
  const scenes = p.scenes.filter((s) => s.id !== id);
  const active = p.activeSceneId === id ? scenes[Math.max(0, i - 1)].id : p.activeSceneId;
  commit({ ...p, scenes, activeSceneId: active });
  useEditor.getState().select(null);
}

/** Put the same (shared) layer into another scene, on top. */
export function addLayerToScene(layerId: string, sceneId: string) {
  const p = useEditor.getState().project;
  if (!p) return;
  const layer = activeScene(p).layers.find((l) => l.id === layerId);
  if (!layer) return;
  commit({
    ...p,
    scenes: p.scenes.map((s) =>
      s.id !== sceneId || s.layers.some((l) => l.id === layerId) ? s : { ...s, layers: [...s.layers, { ...layer, ...sharedFields(layer), visible: true, locked: false }] },
    ),
  });
}

/** Give this scene its own copy of a shared layer. */
export function unlinkLayer(layerId: string) {
  const st = useEditor.getState();
  const id = newId();
  st.updateLayers((layers) => layers.map((l) => (l.id === layerId ? { ...l, id, settings: JSON.parse(JSON.stringify(l.settings)) } : l)));
  st.select(id);
}

export function deleteLayerEverywhere(layerId: string) {
  const p = useEditor.getState().project;
  if (!p) return;
  commit({ ...p, scenes: p.scenes.map((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== layerId) })) });
  useEditor.getState().select(null);
}

// ---------- import / export ----------

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
}

export function exportProject() {
  const p = useEditor.getState().project;
  if (p) download(`wall-${stamp()}.json`, { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), project: p });
}

export function exportScene() {
  const p = useEditor.getState().project;
  if (!p) return;
  const s = activeScene(p);
  download(`wall-${slug(s.name)}-${stamp()}.json`, { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), canvas: p.canvas, scene: s });
}

interface Incoming {
  file: string;
  /** Present for a full backup; replacing uses it as-is. */
  project: Project | null;
  scenes: Scene[];
}

/** Accepts a full backup, a single-scene export, or a bare project object. */
export function parseImport(text: string, file: string): Incoming {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('That file is not valid JSON.');
  }
  const project = data && data.project ? data.project : data && data.scenes && data.canvas ? data : null;
  if (project) {
    const err = validateProject(project);
    if (err) throw new Error('Not a usable wall backup: ' + err);
    return { file, project, scenes: project.scenes };
  }
  if (data && data.scene) {
    // Validate the scene by wrapping it in a minimal project.
    const probe = { canvas: data.canvas || { w: 1920, h: 1080 }, masterQuad: [[0, 0], [1, 0], [1, 1], [0, 1]], scenes: [data.scene], activeSceneId: data.scene.id, ratioLock: true, snap: true };
    const err = validateProject(probe);
    if (err) throw new Error('Not a usable scene export: ' + err);
    return { file, project: null, scenes: [data.scene] };
  }
  throw new Error("That file isn't a wall backup or scene export.");
}

/** Add imported scenes next to the current ones, with fresh ids (links inside the file are kept). */
export function addImportedScenes(p: Project, scenes: Scene[]): Project {
  const idMap: { [old: string]: string } = {};
  const fresh = (old: string) => idMap[old] || (idMap[old] = newId());
  let next = p;
  const added: Scene[] = [];
  for (const s of scenes) {
    const name = uniqueName({ ...next, scenes: [...next.scenes, ...added] }, s.name);
    added.push({ id: newId(), name, layers: s.layers.map((l: Layer) => ({ ...l, id: fresh(l.id) })) });
  }
  next = { ...next, scenes: [...next.scenes, ...added], activeSceneId: added.length ? added[0].id : next.activeSceneId };
  return next;
}

// ---------- UI ----------

export function ScenesSection() {
  const project = useEditor((s) => s.project);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!project) return null;
  const cur = activeScene(project);

  return (
    <section className={css.section}>
      <h3 className={css.h3}>Scenes</h3>
      <ul className={css.layerList}>
        {project.scenes.map((s) => (
          <li
            key={s.id}
            className={s.id === cur.id ? css.layerRowSelected : css.layerRow}
            onClick={() => switchScene(s.id)}
            onDoubleClick={() => setRenaming(s.id)}
            title={s.id === cur.id ? 'On the wall now. Double-click to rename.' : 'Click to show on the wall'}
          >
            <span className={css.sceneDot} data-on={s.id === cur.id ? 'true' : 'false'} />
            {renaming === s.id ? (
              <input
                autoFocus
                className={css.renameInput}
                defaultValue={s.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  renameScene(s.id, e.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className={css.layerName}>
                {s.name}
                <span className={css.layerType}>{s.layers.length} layers</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={css.layerActions}>
        <button
          onClick={() => {
            const name = prompt('Name for the new, empty scene', 'Focus');
            if (name !== null) addScene(name, false);
          }}
        >
          New
        </button>
        <button
          title="New scene with the same layers, shared: move one and it moves in both"
          onClick={() => {
            const name = prompt('Name for the copy (its layers stay shared with "' + cur.name + '")', cur.name + ' copy');
            if (name !== null) addScene(name, true);
          }}
        >
          Duplicate
        </button>
        <button onClick={() => setRenaming(cur.id)}>Rename</button>
        <button
          className={css.danger}
          disabled={project.scenes.length < 2}
          title={project.scenes.length < 2 ? 'The wall needs at least one scene' : undefined}
          onClick={() => {
            if (confirm('Delete the "' + cur.name + '" scene? Layers shared with other scenes stay there.')) deleteScene(cur.id);
          }}
        >
          Delete
        </button>
      </div>

      <div className={css.layerActions} style={{ marginTop: 10 }}>
        <button onClick={exportProject} title="Download everything (all scenes, canvas, keystone) as JSON">
          Export all
        </button>
        <button onClick={exportScene} title="Download just this scene as JSON">
          Export scene
        </button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!f) return;
            setImportError(null);
            try {
              setIncoming(parseImport(await f.text(), f.name));
            } catch (err: any) {
              setImportError(err.message);
            }
          }}
        />
      </div>
      {importError && <p className={css.errorText}>{importError}</p>}
      {incoming && (
        <div className={css.importBox}>
          <p style={{ margin: 0 }}>
            <b>{incoming.file}</b>: {incoming.scenes.length} scene{incoming.scenes.length === 1 ? '' : 's'} ({incoming.scenes.map((s) => s.name).join(', ')})
          </p>
          <div className={css.row}>
            <button
              className={css.primary}
              onClick={() => {
                const p = useEditor.getState().project!;
                commit(addImportedScenes(p, incoming.scenes));
                useEditor.getState().select(null);
                setIncoming(null);
              }}
            >
              Add scenes
            </button>
            {incoming.project && (
              <button
                className={css.danger}
                onClick={() => {
                  if (!confirm('Replace everything (all scenes, canvas size and keystone) with this backup? You can undo with Ctrl+Z.')) return;
                  commit(incoming.project!);
                  useEditor.getState().select(null);
                  setIncoming(null);
                }}
              >
                Replace everything
              </button>
            )}
            <button onClick={() => setIncoming(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
