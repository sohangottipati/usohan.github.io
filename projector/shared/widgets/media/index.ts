import type { WidgetDefinition } from '../types';

export interface MediaSettings {
  url: string;
  kind: 'auto' | 'image' | 'video';
  fit: 'cover' | 'contain' | 'fill';
  loop: boolean;
}

function isVideo(s: MediaSettings): boolean {
  if (s.kind === 'video') return true;
  if (s.kind === 'image') return false;
  return /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i.test(s.url || '');
}

export const mediaWidget: WidgetDefinition<MediaSettings> = {
  type: 'media',
  name: 'Image / video',
  description: 'An image or video from a URL. Videos play muted.',
  defaultSize: { w: 640, h: 360 },
  defaultSettings: { url: '', kind: 'auto', fit: 'cover', loop: true },
  settingsSchema: [
    { key: 'url', label: 'Image or video URL', type: 'image', help: 'Paste a direct link to a .jpg, .png, .gif, .mp4 or .webm.' },
    {
      key: 'kind',
      label: 'Type',
      type: 'select',
      options: [
        { value: 'auto', label: 'Detect from URL' },
        { value: 'image', label: 'Image' },
        { value: 'video', label: 'Video' },
      ],
    },
    {
      key: 'fit',
      label: 'Fit',
      type: 'select',
      options: [
        { value: 'cover', label: 'Cover (crop)' },
        { value: 'contain', label: 'Contain (letterbox)' },
        { value: 'fill', label: 'Stretch' },
      ],
    },
    { key: 'loop', label: 'Loop video', type: 'toggle' },
  ],
  mount(el, ctx) {
    const s = ctx.settings;
    const base = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:' + s.fit + ';';
    let node: HTMLElement;
    let video: HTMLVideoElement | null = null;
    if (!s.url) {
      node = document.createElement('div');
      node.style.cssText = base + 'display:flex;align-items:center;justify-content:center;color:#666;font:40px sans-serif;';
      node.textContent = ctx.mode === 'editor' ? 'Set an image or video URL' : '';
    } else if (isVideo(s)) {
      video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.loop = s.loop;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.src = s.url;
      video.style.cssText = base;
      node = video;
    } else {
      const img = document.createElement('img');
      img.src = s.url;
      img.alt = '';
      img.style.cssText = base;
      node = img;
    }
    el.appendChild(node);
    if (video) {
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    }
    // No update(): the registry remounts on settings change, which is fine for media.
    return {
      resize() {},
      setActive(active) {
        if (!video) return;
        if (active) {
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        } else video.pause();
      },
      destroy() {
        if (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
        el.removeChild(node);
      },
    };
  },
};
