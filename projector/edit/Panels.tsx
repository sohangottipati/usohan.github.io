'use client';

import { useState } from 'react';
import { rectQuad, activeScene, type Layer, type Project } from '../shared/types';
import { getWidget, listWidgets, withDefaults } from '../shared/widgets/registry';
import { cloneQuad, moveQuad } from './geometry';
import SettingsForm from './SettingsForm';
import { newId, selectedLayer, useEditor } from './store';
import css from './editor.module.css';

// ---------- layer operations ----------

export function addLayer(type: string) {
  const st = useEditor.getState();
  const p = st.project;
  const def = getWidget(type);
  if (!p || !def) return;
  const { w, h } = def.defaultSize;
  const count = activeScene(p).layers.filter((l) => l.widget === type).length;
  const layer: Layer = {
    id: newId(),
    name: `${def.name.split(' ')[0]} ${count + 1}`,
    widget: type,
    settings: { ...def.defaultSettings },
    quad: rectQuad((p.canvas.w - w) / 2, (p.canvas.h - h) / 2, w, h),
    contentSize: { w, h },
    visible: true,
    locked: false,
    opacity: 1,
  };
  st.updateLayers((layers) => [...layers, layer]);
  st.select(layer.id);
}

export function duplicateLayer(id: string) {
  const st = useEditor.getState();
  const src = st.project && activeScene(st.project).layers.find((l) => l.id === id);
  if (!src) return;
  const copy: Layer = {
    ...src,
    id: newId(),
    name: src.name + ' copy',
    settings: JSON.parse(JSON.stringify(src.settings)),
    quad: moveQuad(cloneQuad(src.quad), 30, 30),
    contentSize: { ...src.contentSize },
    locked: false,
  };
  st.updateLayers((layers) => {
    const i = layers.findIndex((l) => l.id === id);
    const out = layers.slice();
    out.splice(i + 1, 0, copy);
    return out;
  });
  st.select(copy.id);
}

export function deleteLayer(id: string) {
  const st = useEditor.getState();
  st.updateLayers((layers) => layers.filter((l) => l.id !== id));
  st.select(null);
}

/** delta: +1 up, -1 down, 'front', 'back'. Index 0 is the bottom of the stack. */
export function reorderLayer(id: string, delta: 1 | -1 | 'front' | 'back') {
  useEditor.getState().updateLayers((layers) => {
    const i = layers.findIndex((l) => l.id === id);
    if (i < 0) return layers;
    const out = layers.slice();
    const [l] = out.splice(i, 1);
    let j = delta === 'front' ? out.length : delta === 'back' ? 0 : i + delta;
    j = Math.max(0, Math.min(out.length, j));
    out.splice(j, 0, l);
    return out;
  });
}

// ---------- left: add + layer list ----------

export function LayerPanel() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const mode = useEditor((s) => s.mode);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!project) return null;
  const layers = activeScene(project).layers;
  const st = useEditor.getState();

  return (
    <aside className={css.left}>
      <section className={css.section}>
        <h3 className={css.h3}>Add layer</h3>
        <div className={css.addGrid}>
          {listWidgets().map((w) => (
            <button key={w.type} className={css.addBtn} title={w.description} onClick={() => addLayer(w.type)} disabled={mode !== 'layers'}>
              {w.name}
            </button>
          ))}
        </div>
      </section>
      <section className={css.section}>
        <h3 className={css.h3}>Layers</h3>
        {layers.length === 0 && <p className={css.muted}>No layers yet. Add one above.</p>}
        <ul className={css.layerList}>
          {layers
            .slice()
            .reverse()
            .map((l) => (
              <li
                key={l.id}
                className={l.id === selectedId ? css.layerRowSelected : css.layerRow}
                onClick={() => st.select(l.id)}
                onDoubleClick={() => setRenaming(l.id)}
              >
                <button
                  className={css.iconBtn}
                  title={l.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    st.updateLayer(l.id, { visible: !l.visible });
                  }}
                >
                  {l.visible ? '●' : '○'}
                </button>
                {renaming === l.id ? (
                  <input
                    autoFocus
                    className={css.renameInput}
                    defaultValue={l.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== l.name) st.updateLayer(l.id, { name });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className={css.layerName}>
                    {l.name}
                    <span className={css.layerType}>{getWidget(l.widget)?.name ?? l.widget}</span>
                  </span>
                )}
                <button
                  className={css.iconBtn}
                  title={l.locked ? 'Unlock' : 'Lock'}
                  onClick={(e) => {
                    e.stopPropagation();
                    st.updateLayer(l.id, { locked: !l.locked });
                  }}
                >
                  {l.locked ? '🔒' : '🔓'}
                </button>
              </li>
            ))}
        </ul>
        {selectedId && (
          <div className={css.layerActions}>
            <button onClick={() => reorderLayer(selectedId, 'front')} title="Bring to front">Front</button>
            <button onClick={() => reorderLayer(selectedId, 1)} title="Move up">Up</button>
            <button onClick={() => reorderLayer(selectedId, -1)} title="Move down">Down</button>
            <button onClick={() => reorderLayer(selectedId, 'back')} title="Send to back">Back</button>
            <button onClick={() => setRenaming(selectedId)}>Rename</button>
            <button onClick={() => duplicateLayer(selectedId)} title="Ctrl+D">Duplicate</button>
            <button className={css.danger} onClick={() => deleteLayer(selectedId)} title="Delete">Delete</button>
          </div>
        )}
      </section>
    </aside>
  );
}

// ---------- right: properties ----------

function NumberInput({ value, onChange, step = 1 }: { value: number; onChange(n: number): void; step?: number }) {
  return (
    <input
      className={css.input}
      type="number"
      step={step}
      value={Math.round(value * 100) / 100}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (isFinite(n)) onChange(n);
      }}
    />
  );
}

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

export function PropertiesPanel({ displayKey, onRotateKey }: { displayKey: string | null; onRotateKey(): void }) {
  const project = useEditor((s) => s.project);
  const layer = useEditor(selectedLayer);
  const mode = useEditor((s) => s.mode);
  if (!project) return null;
  const st = useEditor.getState();

  if (mode === 'keystone') return <KeystonePanel project={project} />;

  if (!layer) return <CanvasPanel project={project} displayKey={displayKey} onRotateKey={onRotateKey} />;

  const def = getWidget(layer.widget);
  const settings = withDefaults(layer.widget, layer.settings);
  const set = (patch: Partial<Layer>, key: string) => st.updateLayer(layer.id, patch, { coalesce: layer.id + ':' + key });

  return (
    <aside className={css.right}>
      <section className={css.section}>
        <h3 className={css.h3}>Layer</h3>
        <label className={css.field}>
          <span className={css.fieldLabel}>Name</span>
          <input className={css.input} value={layer.name} onChange={(e) => set({ name: e.target.value }, 'name')} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>Opacity {Math.round(layer.opacity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.01} value={layer.opacity} onChange={(e) => set({ opacity: parseFloat(e.target.value) }, 'opacity')} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>Ratio lock</span>
          <select
            className={css.input}
            value={layer.ratioLock === undefined ? 'inherit' : layer.ratioLock ? 'on' : 'off'}
            onChange={(e) => {
              const v = e.target.value;
              set({ ratioLock: v === 'inherit' ? undefined : v === 'on' }, 'ratio');
            }}
          >
            <option value="inherit">Use global ({project.ratioLock ? 'on' : 'off'})</option>
            <option value="on">On: scale keeps shape</option>
            <option value="off">Off: free corner pin</option>
          </select>
        </label>
        <div className={css.fieldInline}>
          <label>
            <input type="checkbox" checked={layer.visible} onChange={(e) => set({ visible: e.target.checked }, 'visible')} /> Visible
          </label>
          <label>
            <input type="checkbox" checked={layer.locked} onChange={(e) => set({ locked: e.target.checked }, 'locked')} /> Locked
          </label>
        </div>
      </section>

      {def && (
        <section className={css.section}>
          <h3 className={css.h3}>{def.name}</h3>
          <SettingsForm
            schema={def.settingsSchema}
            values={settings}
            onChange={(key, value) => set({ settings: { ...settings, [key]: value } }, 's:' + key)}
          />
        </section>
      )}

      <section className={css.section}>
        <h3 className={css.h3}>Corners (display px)</h3>
        {layer.quad.map((p, i) => (
          <div key={i} className={css.cornerRow}>
            <span className={css.cornerName}>{CORNER_NAMES[i]}</span>
            <NumberInput
              value={p[0]}
              onChange={(n) => {
                const q = cloneQuad(layer.quad);
                q[i][0] = n;
                set({ quad: q }, 'q' + i + 'x');
              }}
            />
            <NumberInput
              value={p[1]}
              onChange={(n) => {
                const q = cloneQuad(layer.quad);
                q[i][1] = n;
                set({ quad: q }, 'q' + i + 'y');
              }}
            />
          </div>
        ))}
        <div className={css.cornerRow}>
          <span className={css.cornerName} title="The pre-warp size the widget renders at. Changes text/detail scale, not position.">
            Content size
          </span>
          <NumberInput value={layer.contentSize.w} onChange={(n) => n > 0 && set({ contentSize: { ...layer.contentSize, w: n } }, 'cw')} />
          <NumberInput value={layer.contentSize.h} onChange={(n) => n > 0 && set({ contentSize: { ...layer.contentSize, h: n } }, 'ch')} />
        </div>
        <p className={css.help}>Drag corners on the stage. Arrow keys nudge 1px (Shift: 10px). Hold Shift while dragging to flip ratio lock, Alt to skip snapping.</p>
      </section>
    </aside>
  );
}

function CanvasPanel({ project, displayKey, onRotateKey }: { project: Project; displayKey: string | null; onRotateKey(): void }) {
  const st = useEditor.getState();
  const link = displayKey ? displayLink(displayKey) : '';
  const [copied, setCopied] = useState(false);
  return (
    <aside className={css.right}>
      <section className={css.section}>
        <h3 className={css.h3}>Display</h3>
        <p className={css.help}>Open this link in the projector&apos;s browser. Press OK on the remote to go fullscreen.</p>
        <input className={css.input} readOnly value={link} onFocus={(e) => e.target.select()} />
        <div className={css.row}>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            className={css.danger}
            onClick={() => {
              if (confirm('Rotate the display key? The projector will need the new link.')) onRotateKey();
            }}
          >
            Rotate key
          </button>
        </div>
      </section>
      <section className={css.section}>
        <h3 className={css.h3}>Canvas</h3>
        <p className={css.help}>Logical size of the projected image. The projector scales it to fit and keeps the aspect ratio.</p>
        <div className={css.cornerRow}>
          <span className={css.cornerName}>Size</span>
          <NumberInput value={project.canvas.w} onChange={(w) => w >= 16 && st.commit({ ...project, canvas: { ...project.canvas, w } }, { coalesce: 'cw' })} />
          <NumberInput value={project.canvas.h} onChange={(h) => h >= 16 && st.commit({ ...project, canvas: { ...project.canvas, h } }, { coalesce: 'ch' })} />
        </div>
      </section>
      <section className={css.section}>
        <p className={css.muted}>Select a layer to edit it. Click empty space to deselect.</p>
      </section>
    </aside>
  );
}

function KeystonePanel({ project }: { project: Project }) {
  const st = useEditor.getState();
  return (
    <aside className={css.right}>
      <section className={css.section}>
        <h3 className={css.h3}>Keystone</h3>
        <p className={css.help}>
          Drag the four blue corners to where the projected image&apos;s corners should land. This warps the whole output before
          per-layer mapping. Turn on Grid to see it on the wall.
        </p>
        {project.masterQuad.map((p, i) => (
          <div key={i} className={css.cornerRow}>
            <span className={css.cornerName}>{CORNER_NAMES[i]}</span>
            <NumberInput
              value={p[0]}
              onChange={(n) => {
                const q = cloneQuad(project.masterQuad);
                q[i][0] = n;
                st.commit({ ...project, masterQuad: q }, { coalesce: 'm' + i + 'x' });
              }}
            />
            <NumberInput
              value={p[1]}
              onChange={(n) => {
                const q = cloneQuad(project.masterQuad);
                q[i][1] = n;
                st.commit({ ...project, masterQuad: q }, { coalesce: 'm' + i + 'y' });
              }}
            />
          </div>
        ))}
        <button onClick={() => st.commit({ ...project, masterQuad: rectQuad(0, 0, project.canvas.w, project.canvas.h) })}>Reset keystone</button>
      </section>
    </aside>
  );
}

export function displayLink(key: string): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const api = new URLSearchParams(location.search).get('api');
  return (
    location.origin +
    (local ? '/projector/display/index.html' : '/projector/display/') +
    '?k=' +
    encodeURIComponent(key) +
    (api ? '&api=' + encodeURIComponent(api) : '')
  );
}
