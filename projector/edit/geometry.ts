// Pure drag / snap math for the editor. All coordinates are canvas pixels.

import { isConvex } from '../shared/homography';
import { activeScene, type Point, type Project, type Quad } from '../shared/types';

export interface Guide {
  x?: number;
  y?: number;
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
  points: Point[];
}

export function cloneQuad(q: Quad): Quad {
  return [
    [q[0][0], q[0][1]],
    [q[1][0], q[1][1]],
    [q[2][0], q[2][1]],
    [q[3][0], q[3][1]],
  ];
}

export function bbox(q: Quad) {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function moveQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => [p[0] + dx, p[1] + dy]) as Quad;
}

/** Display edges/centre plus every other visible layer's corners and bounding-box edges. */
export function snapTargets(project: Project, excludeId: string | null): SnapTargets {
  const { w, h } = project.canvas;
  const xs = [0, w / 2, w];
  const ys = [0, h / 2, h];
  const points: Point[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  for (const l of activeScene(project).layers) {
    if (l.id === excludeId || !l.visible) continue;
    for (const p of l.quad) {
      xs.push(p[0]);
      ys.push(p[1]);
      points.push([p[0], p[1]]);
    }
  }
  return { xs, ys, points };
}

function nearest(values: number[], candidates: number[], thr: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const c of candidates) {
    for (const t of values) {
      const d = t - c;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t };
    }
  }
  return best;
}

export function dragMove(start: Quad, dx: number, dy: number, targets: SnapTargets | null, thr: number): { quad: Quad; guides: Guide[] } {
  const guides: Guide[] = [];
  if (targets) {
    const moved = moveQuad(start, dx, dy);
    const b = bbox(moved);
    const cx = [b.minX, b.maxX, (b.minX + b.maxX) / 2, ...moved.map((p) => p[0])];
    const cy = [b.minY, b.maxY, (b.minY + b.maxY) / 2, ...moved.map((p) => p[1])];
    const sx = nearest(targets.xs, cx, thr);
    const sy = nearest(targets.ys, cy, thr);
    if (sx) {
      dx += sx.delta;
      guides.push({ x: sx.target });
    }
    if (sy) {
      dy += sy.delta;
      guides.push({ y: sy.target });
    }
  }
  return { quad: moveQuad(start, dx, dy), guides };
}

const MIN_SIZE = 10;

/**
 * Drag corner i to point p.
 * ratio=true: scale the whole quad uniformly about the opposite corner (keeps shape).
 * ratio=false: free corner pin. Returns null if the result would not be convex.
 */
export function dragCorner(start: Quad, i: number, p: Point, ratio: boolean, targets: SnapTargets | null, thr: number): { quad: Quad; guides: Guide[] } | null {
  const guides: Guide[] = [];
  if (ratio) {
    const O = start[(i + 2) % 4];
    const v: Point = [start[i][0] - O[0], start[i][1] - O[1]];
    const len2 = v[0] * v[0] + v[1] * v[1];
    if (len2 < 1e-6) return null;
    let s = ((p[0] - O[0]) * v[0] + (p[1] - O[1]) * v[1]) / len2;
    if (targets) {
      const c: Point = [O[0] + s * v[0], O[1] + s * v[1]];
      let best: { diff: number; s: number; guide: Guide } | null = null;
      if (Math.abs(v[0]) > 1e-6) {
        const n = nearest(targets.xs, [c[0]], thr);
        if (n) best = { diff: Math.abs(n.delta), s: (n.target - O[0]) / v[0], guide: { x: n.target } };
      }
      if (Math.abs(v[1]) > 1e-6) {
        const n = nearest(targets.ys, [c[1]], thr);
        if (n && (!best || Math.abs(n.delta) < best.diff)) best = { diff: Math.abs(n.delta), s: (n.target - O[1]) / v[1], guide: { y: n.target } };
      }
      if (best) {
        s = best.s;
        guides.push(best.guide);
      }
    }
    s = Math.max(s, MIN_SIZE / Math.sqrt(len2));
    const quad = start.map((q) => [O[0] + s * (q[0] - O[0]), O[1] + s * (q[1] - O[1])]) as Quad;
    return { quad, guides };
  }

  let c: Point = [p[0], p[1]];
  if (targets) {
    let bestPt: Point | null = null;
    let bestD = thr;
    for (const t of targets.points) {
      const d = Math.hypot(t[0] - c[0], t[1] - c[1]);
      if (d <= bestD) {
        bestD = d;
        bestPt = t;
      }
    }
    if (bestPt) {
      c = [bestPt[0], bestPt[1]];
      guides.push({ x: c[0] }, { y: c[1] });
    } else {
      const sx = nearest(targets.xs, [c[0]], thr);
      const sy = nearest(targets.ys, [c[1]], thr);
      if (sx) {
        c[0] = sx.target;
        guides.push({ x: sx.target });
      }
      if (sy) {
        c[1] = sy.target;
        guides.push({ y: sy.target });
      }
    }
  }
  const quad = cloneQuad(start);
  quad[i] = c;
  return isConvex(quad) ? { quad, guides } : null;
}

/** Move a single corner by (dx, dy); null if the result is not convex. */
export function nudgeCorner(q: Quad, i: number, dx: number, dy: number): Quad | null {
  const quad = cloneQuad(q);
  quad[i] = [quad[i][0] + dx, quad[i][1] + dy];
  return isConvex(quad) ? quad : null;
}
