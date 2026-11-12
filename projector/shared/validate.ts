// Structural validation for projects coming from clients or imported JSON.

import type { Layer, Project, Quad } from './types';

function isNum(n: any): boolean {
  return typeof n === 'number' && isFinite(n);
}

function isQuad(q: any): q is Quad {
  if (!Array.isArray(q) || q.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    if (!Array.isArray(q[i]) || q[i].length !== 2 || !isNum(q[i][0]) || !isNum(q[i][1])) return false;
  }
  return true;
}

function isLayer(l: any): l is Layer {
  return (
    l && typeof l === 'object' &&
    typeof l.id === 'string' && typeof l.name === 'string' && typeof l.widget === 'string' &&
    l.settings && typeof l.settings === 'object' &&
    isQuad(l.quad) &&
    l.contentSize && isNum(l.contentSize.w) && isNum(l.contentSize.h) && l.contentSize.w > 0 && l.contentSize.h > 0 &&
    typeof l.visible === 'boolean' && typeof l.locked === 'boolean' && isNum(l.opacity)
  );
}

/** Returns an error message, or null if the project is valid. */
export function validateProject(p: any): string | null {
  if (!p || typeof p !== 'object') return 'Project must be an object';
  if (!p.canvas || !isNum(p.canvas.w) || !isNum(p.canvas.h) || p.canvas.w < 16 || p.canvas.h < 16 || p.canvas.w > 8192 || p.canvas.h > 8192)
    return 'Invalid canvas size';
  if (!isQuad(p.masterQuad)) return 'Invalid master quad';
  if (!Array.isArray(p.scenes) || p.scenes.length === 0 || p.scenes.length > 50) return 'Invalid scenes';
  let found = false;
  for (const s of p.scenes) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.layers)) return 'Invalid scene';
    if (s.layers.length > 200) return 'Too many layers';
    for (const l of s.layers) if (!isLayer(l)) return 'Invalid layer in scene ' + s.name;
    if (s.id === p.activeSceneId) found = true;
  }
  if (!found) return 'activeSceneId does not match a scene';
  if (typeof p.ratioLock !== 'boolean' || typeof p.snap !== 'boolean') return 'Invalid flags';
  return null;
}

export function isProject(p: any): p is Project {
  return validateProject(p) === null;
}
