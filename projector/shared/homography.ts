// 4-corner perspective mapping → CSS matrix3d. No WebGL, works on old WebViews.

import type { Point, Quad } from './types';

/** 3x3 homography, row-major, h[8] normalised to 1. */
export type Mat3 = number[];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Solve the homography that maps src[i] → dst[i] for 4 point pairs.
 * Returns null for degenerate input (three collinear points, etc).
 */
export function homography(src: Quad, dst: Quad): Mat3 | null {
  // Unknowns a..h with i = 1:
  // u = (a x + b y + c) / (g x + h y + 1)
  // v = (d x + e y + f) / (g x + h y + 1)
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i][0];
    const y = src[i][1];
    const u = dst[i][0];
    const v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    const tmp = A[col];
    A[col] = A[pivot];
    A[pivot] = tmp;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h: number[] = [];
  for (let i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
  h.push(1);
  return h;
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return out;
}

export function scaleTranslate(s: number, tx: number, ty: number): Mat3 {
  return [s, 0, tx, 0, s, ty, 0, 0, 1];
}

export function applyMat(m: Mat3, p: Point): Point {
  const w = m[6] * p[0] + m[7] * p[1] + m[8];
  return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w];
}

/** CSS matrix3d (column-major) for a 2D homography; use with transform-origin: 0 0. */
export function toMatrix3d(m: Mat3): string {
  const k = m[8] || 1;
  const v = [
    m[0] / k, m[3] / k, 0, m[6] / k,
    m[1] / k, m[4] / k, 0, m[7] / k,
    0, 0, 1, 0,
    m[2] / k, m[5] / k, 0, 1,
  ];
  let s = 'matrix3d(';
  for (let i = 0; i < 16; i++) {
    // Fixed precision keeps strings short and stable for diffing.
    s += (i ? ',' : '') + +v[i].toFixed(10);
  }
  return s + ')';
}

/** Homography that maps a w×h content rectangle onto a quad. */
export function rectToQuad(w: number, h: number, quad: Quad): Mat3 | null {
  return homography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    quad,
  );
}

/** True if the quad is strictly convex and non-self-intersecting (required for a sane warp). */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function pointInQuad(p: Point, q: Quad): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i][0], yi = q[i][1], xj = q[j][0], yj = q[j][1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
