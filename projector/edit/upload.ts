// Image uploads: shrink in the browser, then store via the wall API.

import { apiBase } from '../shared/client';

/** Durable Object values are capped at 2 MB; stay safely under. */
export const MAX_UPLOAD_BYTES = 1.8 * 1024 * 1024;
const MAX_DIM = 2560;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image this browser can read'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Returns a blob under the size cap: the original if it already fits, else a resized WebP/JPEG. */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') {
    // Resizing would drop the animation, so GIFs must fit as they are.
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('GIFs must be under 1.8 MB');
    return file;
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('Use a PNG, JPEG, WebP or GIF image');
  }
  const img = await loadImage(file);
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= MAX_UPLOAD_BYTES && big <= MAX_DIM && file.type !== '') return file;

  let scale = Math.min(1, MAX_DIM / big);
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    // WebP keeps transparency; browsers that can't encode it hand back PNG, so fall back to JPEG.
    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.86);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
    scale *= 0.75;
  }
  throw new Error('Could not shrink that image under 1.8 MB');
}

/** Uploads an image and returns its public URL. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await prepareImage(file);
  const res = await fetch(apiBase() + '/api/media', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
  return apiBase() + data.path;
}
