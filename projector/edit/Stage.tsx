'use client';

import { useEffect, useRef, useState } from 'react';
import { pointInQuad } from '../shared/homography';
import { LiveStore } from '../shared/live';
import { fitCanvas, SceneRenderer } from '../shared/renderer';
import { activeScene, type Point, type Quad } from '../shared/types';
import { cloneQuad, dragCorner, dragMove, snapTargets } from './geometry';
import { useEditor } from './store';
import css from './editor.module.css';

type Drag =
  | { kind: 'move'; id: string; start: Point; quad: Quad }
  | { kind: 'corner'; id: string; corner: number; quad: Quad }
  | { kind: 'master'; corner: number; quad: Quad };

const SNAP_PX = 8;
const PADDING = 28;

export default function Stage() {
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.live);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedCorner = useEditor((s) => s.selectedCorner);
  const mode = useEditor((s) => s.mode);
  const guides = useEditor((s) => s.guides);

  const wrapRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const liveRef = useRef<LiveStore | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Renderer lifecycle
  useEffect(() => {
    const liveStore = new LiveStore();
    liveRef.current = liveStore;
    const r = new SceneRenderer(previewRef.current!, { mode: 'editor', applyMaster: false, live: liveStore, padding: PADDING });
    rendererRef.current = r;
    return () => {
      r.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    rendererRef.current?.setViewport(size.w, size.h);
  }, [size]);

  useEffect(() => {
    if (project) rendererRef.current?.render(project);
  }, [project]);

  useEffect(() => {
    liveRef.current?.set(live);
  }, [live]);

  if (!project) return <div ref={wrapRef} className={css.stage} />;

  const cw = project.canvas.w;
  const ch = project.canvas.h;
  const fit = fitCanvas(size.w, size.h, cw, ch, PADDING);
  const s = fit.scale;
  const ox = fit.x;
  const oy = fit.y;
  const toScreen = (p: Point) => `${p[0] * s + ox},${p[1] * s + oy}`;
  const toCanvas = (clientX: number, clientY: number): Point => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [(clientX - r.left - ox) / s, (clientY - r.top - oy) / s];
  };
  const layers = activeScene(project).layers;

  function startDrag(e: React.PointerEvent, drag: Drag) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = drag;
    const st = useEditor.getState();
    st.beginGesture();

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      const state = useEditor.getState();
      const proj = state.project;
      if (!d || !proj) return;
      const p = toCanvas(ev.clientX, ev.clientY);
      const thr = SNAP_PX / s;
      if (d.kind === 'master') {
        const quad = cloneQuad(d.quad);
        quad[d.corner] = p;
        state.commit({ ...proj, masterQuad: quad }, { history: false });
        return;
      }
      const targets = proj.snap && !ev.altKey ? snapTargets(proj, d.id) : null;
      if (d.kind === 'move') {
        const r = dragMove(d.quad, p[0] - d.start[0], p[1] - d.start[1], targets, thr);
        state.set({ guides: r.guides });
        state.updateLayer(d.id, { quad: r.quad }, { history: false });
      } else {
        const layer = activeScene(proj).layers.find((l) => l.id === d.id);
        if (!layer) return;
        let ratio = layer.ratioLock !== undefined ? layer.ratioLock : proj.ratioLock;
        if (ev.shiftKey) ratio = !ratio;
        const r = dragCorner(d.quad, d.corner, p, ratio, targets, thr);
        if (!r) return; // would fold over; keep last valid shape
        state.set({ guides: r.guides });
        state.updateLayer(d.id, { quad: r.quad }, { history: false });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      useEditor.getState().endGesture();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onBackgroundDown(e: React.PointerEvent) {
    if (mode !== 'layers') return;
    // Hit-test top-down so clicking overlapping quads picks the visible top one.
    const p = toCanvas(e.clientX, e.clientY);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      if (pointInQuad(p, l.quad)) {
        useEditor.getState().select(l.id, null);
        startDrag(e, { kind: 'move', id: l.id, start: p, quad: cloneQuad(l.quad) });
        return;
      }
    }
    useEditor.getState().select(null);
  }

  const sel = layers.find((l) => l.id === selectedId);

  return (
    <div ref={wrapRef} className={css.stage}>
      <div ref={previewRef} className={css.preview} />
      <svg className={css.overlay} width={size.w} height={size.h} onPointerDown={onBackgroundDown}>
        <rect x={ox} y={oy} width={cw * s} height={ch * s} className={css.canvasEdge} />
        {mode === 'layers' &&
          layers.map((l) =>
            l.visible ? (
              <polygon
                key={l.id}
                points={l.quad.map(toScreen).join(' ')}
                className={l.id === selectedId ? css.quadSelected : l.locked ? css.quadLocked : css.quad}
              />
            ) : null,
          )}
        {guides.map((g, i) =>
          g.x !== undefined ? (
            <line key={i} x1={g.x * s + ox} x2={g.x * s + ox} y1={0} y2={size.h} className={css.guide} />
          ) : (
            <line key={i} y1={g.y! * s + oy} y2={g.y! * s + oy} x1={0} x2={size.w} className={css.guide} />
          ),
        )}
        {mode === 'layers' &&
          sel &&
          sel.visible &&
          !sel.locked &&
          sel.quad.map((p, i) => (
            <circle
              key={i}
              cx={p[0] * s + ox}
              cy={p[1] * s + oy}
              r={8}
              className={i === selectedCorner ? css.handleActive : css.handle}
              onPointerDown={(e) => {
                useEditor.getState().select(sel.id, i);
                startDrag(e, { kind: 'corner', id: sel.id, corner: i, quad: cloneQuad(sel.quad) });
              }}
            />
          ))}
        {mode === 'keystone' && (
          <>
            <polygon points={project.masterQuad.map(toScreen).join(' ')} className={css.masterQuad} />
            {project.masterQuad.map((p, i) => (
              <circle
                key={i}
                cx={p[0] * s + ox}
                cy={p[1] * s + oy}
                r={10}
                className={i === selectedCorner ? css.handleActive : css.handleMaster}
                onPointerDown={(e) => {
                  useEditor.getState().set({ selectedCorner: i });
                  startDrag(e, { kind: 'master', corner: i, quad: cloneQuad(project.masterQuad) });
                }}
              />
            ))}
          </>
        )}
      </svg>
    </div>
  );
}
