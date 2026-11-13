// Projector output page. Vanilla TS, bundled to ES2017 by projector/display/build.mjs.
// Opened as /projector/display/?k=<DISPLAY_KEY>[&debug=1][&api=<origin>]

import { apiBase, WallSocket } from '../shared/client';
import { LiveStore, setServerTime } from '../shared/live';
import { SceneRenderer } from '../shared/renderer';
import { playSpeech } from '../shared/widgets/util';
import type { Project, ServerMessage } from '../shared/types';

const RELOAD_AFTER_MS = 60000;

function param(name: string): string | null {
  const m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

const key = param('k');
const debug = param('debug') === '1';

const root = document.getElementById('stage') as HTMLDivElement;
const notice = document.getElementById('notice') as HTMLDivElement;
const live = new LiveStore();
const renderer = new SceneRenderer(root, { mode: 'display', applyMaster: true, live });
let project: Project | null = null;

function showNotice(text: string) {
  notice.textContent = text;
  notice.style.display = text ? 'block' : 'none';
}

function fit() {
  renderer.setViewport(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fit);
fit();

// ---------- debug overlay ----------
const dbg = document.getElementById('debug') as HTMLDivElement;
let statusText = 'connecting';
let fps = 0;
if (debug) {
  dbg.style.display = 'block';
  let frames = 0;
  let last = Date.now();
  const loop = () => {
    frames++;
    const now = Date.now();
    if (now - last >= 1000) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
      dbg.textContent = 'fps ' + fps + ' · ' + statusText + ' · ' + window.innerWidth + '×' + window.innerHeight;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- fullscreen on first remote/keyboard/click input ----------
function goFullscreen() {
  const d: any = document.documentElement;
  const req = d.requestFullscreen || d.webkitRequestFullscreen || d.mozRequestFullScreen;
  if (req && !(document as any).fullscreenElement && !(document as any).webkitFullscreenElement) {
    try {
      const p = req.call(d);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
}
document.addEventListener('keydown', goFullscreen);
document.addEventListener('click', goFullscreen);

// ---------- sync ----------
if (!key) {
  showNotice('Missing display key. Open this page as /projector/display/?k=YOUR_DISPLAY_KEY');
} else {
  const url = apiBase().replace(/^http/, 'ws') + '/ws?k=' + encodeURIComponent(key);
  const socket = new WallSocket({
    url,
    onMessage(msg: ServerMessage) {
      if (msg.t === 'snapshot') {
        setServerTime(msg.serverTime);
        showNotice('');
        project = msg.project;
        live.set(msg.live); // triggers no render yet if project was null
        renderer.render(project);
      } else if (msg.t === 'project') {
        setServerTime(msg.serverTime);
        project = msg.project;
        renderer.render(project);
      } else if (msg.t === 'live') {
        setServerTime(msg.serverTime);
        live.set(msg.live);
      } else if (msg.t === 'command') {
        renderer.dispatchCommand(msg.command);
      } else if (msg.t === 'speak') {
        playSpeech(msg.audio, msg.mime, msg.text, (played) => {
          (window as any).__wallSpoken = ((window as any).__wallSpoken || 0) + (played ? 1 : 0);
          if (debug) statusText = (played ? 'spoke: ' : 'could not play: ') + msg.text.slice(0, 40);
        });
      } else if (msg.t === 'pong') {
        setServerTime(msg.serverTime);
      } else if (msg.t === 'error') {
        showNotice(msg.message);
      }
    },
    onStatus(status, downFor) {
      statusText = status + (downFor ? ' (' + Math.round(downFor / 1000) + 's)' : '');
      if (downFor > RELOAD_AFTER_MS) location.reload();
    },
  });
  socket.connect();
  window.addEventListener('online', () => socket.kick());
  // The heartbeat only reports every 20s; check the reload condition more often.
  setInterval(() => {
    if (socket.disconnectedAt && Date.now() - socket.disconnectedAt > RELOAD_AFTER_MS) location.reload();
  }, 5000);
}
