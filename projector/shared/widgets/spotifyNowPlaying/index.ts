import { spotifyProgress, type LiveState, type SpotifyState } from '../../types';
import { FONT_OPTIONS, type WidgetDefinition } from '../types';
import { everySecond, formatClock } from '../util';

export interface NowPlayingSettings {
  layout: 'row' | 'stack' | 'text';
  font: string;
  titleSize: number;
  color: string;
  accent: string;
  trackColor: string;
  showArtist: boolean;
  showProgress: boolean;
  showTimes: boolean;
  artRadius: number;
  whenIdle: 'hide' | 'show';
  dimWhenPaused: boolean;
}

function css(e: HTMLElement, s: string) {
  e.style.cssText = s;
}

export const spotifyNowPlayingWidget: WidgetDefinition<NowPlayingSettings> = {
  type: 'spotify.nowPlaying',
  name: 'Spotify',
  description: 'Album art, song, artist and a progress bar for what Spotify is playing.',
  defaultSize: { w: 1100, h: 320 },
  requires: ['spotify'],
  defaultSettings: {
    layout: 'row',
    font: FONT_OPTIONS[0].value,
    titleSize: 72,
    color: '#ffffff',
    accent: '#1db954',
    trackColor: '#333333',
    showArtist: true,
    showProgress: true,
    showTimes: true,
    artRadius: 14,
    whenIdle: 'hide',
    dimWhenPaused: true,
  },
  settingsSchema: [
    {
      key: 'layout',
      label: 'Layout',
      type: 'select',
      options: [
        { value: 'row', label: 'Art left, text right' },
        { value: 'stack', label: 'Art on top' },
        { value: 'text', label: 'Text only' },
      ],
    },
    { key: 'font', label: 'Font', type: 'font' },
    { key: 'titleSize', label: 'Title size (px)', type: 'number', min: 10, max: 400 },
    { key: 'color', label: 'Text color', type: 'color' },
    { key: 'showArtist', label: 'Artist', type: 'toggle' },
    { key: 'showProgress', label: 'Progress bar', type: 'toggle' },
    { key: 'accent', label: 'Progress color', type: 'color', when: { key: 'showProgress', is: [true] } },
    { key: 'trackColor', label: 'Progress track', type: 'color', when: { key: 'showProgress', is: [true] } },
    { key: 'showTimes', label: 'Elapsed / length', type: 'toggle', when: { key: 'showProgress', is: [true] } },
    { key: 'artRadius', label: 'Art corner radius', type: 'number', min: 0, max: 500, when: { key: 'layout', is: ['row', 'stack'] } },
    {
      key: 'whenIdle',
      label: 'When nothing is playing',
      type: 'select',
      options: [
        { value: 'hide', label: 'Show nothing' },
        { value: 'show', label: 'Show the last song, dimmed' },
      ],
    },
    { key: 'dimWhenPaused', label: 'Dim when paused', type: 'toggle' },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let sp: SpotifyState | null = ctx.state.get().spotify || null;
    let lastTrack: SpotifyState['track'] = sp ? sp.track : null;
    let shownId = '';
    let active = true;
    let stop: (() => void) | null = null;

    const root = document.createElement('div');
    const artWrap = document.createElement('div');
    const art = document.createElement('img');
    const pauseGlyph = document.createElement('div');
    const info = document.createElement('div');
    const title = document.createElement('div');
    const artist = document.createElement('div');
    const barRow = document.createElement('div');
    const bar = document.createElement('div');
    const fill = document.createElement('div');
    const times = document.createElement('div');
    const placeholder = document.createElement('div');
    art.alt = '';
    art.onerror = () => (art.style.visibility = 'hidden');
    art.onload = () => (art.style.visibility = 'visible');
    pauseGlyph.innerHTML = '<span></span><span></span>';
    artWrap.appendChild(art);
    artWrap.appendChild(pauseGlyph);
    bar.appendChild(fill);
    barRow.appendChild(bar);
    barRow.appendChild(times);
    info.appendChild(title);
    info.appendChild(artist);
    info.appendChild(barRow);
    root.appendChild(artWrap);
    root.appendChild(info);
    el.appendChild(root);
    el.appendChild(placeholder);

    function layout() {
      const w = ctx.size.w;
      const h = ctx.size.h;
      const row = s.layout === 'row';
      const stack = s.layout === 'stack';
      const artPx = row ? Math.min(h, w * 0.4) : stack ? Math.min(w, h * 0.62) : 0;
      css(
        root,
        'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;box-sizing:border-box;padding-right:' + Math.round(s.titleSize * 0.25) + 'px;' +
          (stack ? 'flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;' : 'flex-direction:row;align-items:center;') +
          'font-family:' + s.font + ';color:' + s.color + ';line-height:1.15;',
      );
      css(
        artWrap,
        'position:relative;flex:none;overflow:hidden;background:#111;width:' + artPx + 'px;height:' + artPx + 'px;border-radius:' + s.artRadius + 'px;' +
          'display:' + (artPx ? 'block' : 'none') + ';' + (row ? 'margin-right:' + Math.round(artPx * 0.12) + 'px;' : stack ? 'margin-bottom:' + Math.round(artPx * 0.06) + 'px;' : ''),
      );
      css(art, 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;');
      const g = Math.max(8, artPx * 0.08);
      css(pauseGlyph, 'position:absolute;left:50%;top:50%;width:' + g * 3 + 'px;height:' + g * 3.2 + 'px;margin:-' + g * 1.6 + 'px 0 0 -' + g * 1.5 + 'px;display:none;justify-content:space-between;');
      for (let i = 0; i < pauseGlyph.children.length; i++) {
        css(pauseGlyph.children[i] as HTMLElement, 'display:block;width:' + g + 'px;height:100%;background:#fff;border-radius:' + g / 4 + 'px;box-shadow:0 0 ' + g + 'px rgba(0,0,0,.6);');
      }
      css(info, 'flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;' + (stack ? 'width:100%;' : ''));
      const ell = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      css(title, ell + 'font-size:' + s.titleSize + 'px;font-weight:700;');
      css(artist, ell + 'font-size:' + Math.round(s.titleSize * 0.6) + 'px;opacity:.75;margin-top:' + Math.round(s.titleSize * 0.12) + 'px;display:' + (s.showArtist ? 'block' : 'none') + ';');
      const bh = Math.max(4, Math.round(s.titleSize * 0.1));
      css(barRow, 'display:' + (s.showProgress ? 'flex' : 'none') + ';align-items:center;margin-top:' + Math.round(s.titleSize * 0.35) + 'px;');
      css(bar, 'flex:1;position:relative;overflow:hidden;height:' + bh + 'px;border-radius:' + bh + 'px;background:' + s.trackColor + ';');
      css(fill, 'position:absolute;left:0;top:0;width:100%;height:100%;background:' + s.accent + ';transform-origin:0 50%;transform:scaleX(0);');
      css(times, 'flex:none;margin-left:' + Math.round(s.titleSize * 0.3) + 'px;font-size:' + Math.round(s.titleSize * 0.38) + 'px;opacity:.7;font-variant-numeric:tabular-nums;display:' + (s.showTimes ? 'block' : 'none') + ';');
      css(placeholder, 'position:absolute;left:0;top:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;color:#777;font:' + Math.round(s.titleSize * 0.5) + 'px sans-serif;');
      shownId = ''; // force the bar to snap rather than animate after a relayout
    }

    function setBar(frac: number, animate: boolean) {
      fill.style.transition = animate ? 'transform 1s linear' : 'none';
      fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)).toFixed(4) + ')';
    }

    function render() {
      const track = sp && sp.track ? sp.track : null;
      if (track) lastTrack = track;
      const shown = track || (s.whenIdle === 'show' ? lastTrack : null);

      if (!shown) {
        root.style.display = 'none';
        placeholder.style.display = ctx.mode === 'editor' ? 'flex' : 'none';
        placeholder.textContent = !sp ? 'Spotify not connected' : sp.error ? sp.error : 'Nothing playing on Spotify';
        return;
      }
      placeholder.style.display = 'none';
      root.style.display = 'flex';
      const playing = !!(track && sp && sp.isPlaying);
      root.style.opacity = !track ? '0.4' : !playing && s.dimWhenPaused ? '0.6' : '1';
      pauseGlyph.style.display = track && !playing ? 'flex' : 'none';

      if (shown.art && art.getAttribute('src') !== shown.art) art.src = shown.art;
      if (!shown.art) art.removeAttribute('src');
      title.textContent = shown.name;
      artist.textContent = shown.artists;

      const now = ctx.now().getTime();
      const pos = track && sp ? spotifyProgress(sp, now) : 0;
      const dur = shown.durationMs || 1;
      const newTrack = shown.id !== shownId;
      shownId = shown.id;
      // Snap on a new track (progress resets) or when paused; glide one second ahead while playing.
      if (newTrack || !playing) {
        setBar(pos / dur, false);
        if (playing) {
          void fill.offsetWidth; // apply the snap before starting the glide
          setBar(Math.min(dur, pos + 1000) / dur, true);
        }
      } else {
        setBar(Math.min(dur, pos + 1000) / dur, true);
      }
      times.textContent = formatClock(pos) + ' / ' + formatClock(dur);
    }

    function sync() {
      if (stop) stop();
      stop = active ? everySecond(render) : null;
    }

    layout();
    render();
    sync();

    return {
      update(next) {
        s = next;
        layout();
        render();
      },
      resize() {
        layout();
        render();
      },
      onState(state: LiveState) {
        const next = state.spotify || null;
        if (next !== sp) {
          sp = next;
          render();
        }
      },
      setActive(a) {
        active = a;
        sync();
        if (a) render();
      },
      destroy() {
        if (stop) stop();
        el.removeChild(root);
        el.removeChild(placeholder);
      },
    };
  },
};
