import type { Size } from '../../types';
import type { WidgetDefinition } from '../types';

export interface ParticlesSettings {
  count: number;
  color: string;
  maxSize: number;
  twinkle: boolean;
  drift: number;
  shootingStars: boolean;
  shootingEvery: number;
  shootingColor: string;
}

const MAX_COUNT = 600;
const FRAME_MS = 1000 / 30; // 30 fps is plenty for ambience and kind to weak projectors

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
  speed: number;
}

interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export const particlesWidget: WidgetDefinition<ParticlesSettings> = {
  type: 'particles',
  name: 'Starfield',
  description: 'Twinkling stars with the odd shooting star. Light background ambience.',
  defaultSize: { w: 1920, h: 1080 },
  defaultSettings: {
    count: 180,
    color: '#ffffff',
    maxSize: 2.2,
    twinkle: true,
    drift: 4,
    shootingStars: true,
    shootingEvery: 20,
    shootingColor: '#cfe8ff',
  },
  settingsSchema: [
    { key: 'count', label: 'Stars', type: 'number', min: 0, max: MAX_COUNT, step: 10, help: 'Capped at ' + MAX_COUNT + ' to keep the projector smooth.' },
    { key: 'color', label: 'Star color', type: 'color' },
    { key: 'maxSize', label: 'Largest star (px)', type: 'number', min: 0.5, max: 8, step: 0.1 },
    { key: 'twinkle', label: 'Twinkle', type: 'toggle' },
    { key: 'drift', label: 'Drift speed (px/s)', type: 'number', min: 0, max: 100 },
    { key: 'shootingStars', label: 'Shooting stars', type: 'toggle' },
    { key: 'shootingEvery', label: 'About every (seconds)', type: 'number', min: 2, max: 600, when: { key: 'shootingStars', is: [true] } },
    { key: 'shootingColor', label: 'Shooting star color', type: 'color', when: { key: 'shootingStars', is: [true] } },
  ],
  mount(el, ctx) {
    let s = ctx.settings;
    let size: Size = { w: ctx.size.w, h: ctx.size.h };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    el.appendChild(canvas);
    const g = canvas.getContext('2d')!;

    let stars: Star[] = [];
    let shooters: Shooter[] = [];
    let nextShoot = 0;
    let raf = 0;
    let last = 0;
    let active = true;

    function seed() {
      canvas.width = Math.max(1, Math.round(size.w));
      canvas.height = Math.max(1, Math.round(size.h));
      const n = Math.max(0, Math.min(MAX_COUNT, Math.round(s.count)));
      stars = [];
      for (let i = 0; i < n; i++) {
        // Most stars small, a few bright ones.
        const k = Math.pow(Math.random(), 3);
        stars.push({
          x: Math.random() * size.w,
          y: Math.random() * size.h,
          r: 0.4 + k * Math.max(0, s.maxSize - 0.4),
          a: 0.35 + Math.random() * 0.65,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 2,
        });
      }
      scheduleShoot(performance.now());
    }

    function scheduleShoot(now: number) {
      // Random interval around the average so they don't feel metronomic.
      nextShoot = now + s.shootingEvery * 1000 * (0.4 + Math.random() * 1.2);
    }

    function spawnShooter() {
      const fromLeft = Math.random() < 0.5;
      const angle = (Math.PI / 180) * (20 + Math.random() * 25);
      const speed = Math.max(size.w, size.h) * (0.6 + Math.random() * 0.5); // px per second
      const dir = fromLeft ? 1 : -1;
      shooters.push({
        x: fromLeft ? Math.random() * size.w * 0.5 : size.w * (0.5 + Math.random() * 0.5),
        y: Math.random() * size.h * 0.4,
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        life: 0,
        max: 0.7 + Math.random() * 0.6,
      });
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      draw(now, dt);
    }

    function draw(now: number, dt: number) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = s.color;
      const t = now / 1000;
      const dx = s.drift * dt;
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        if (dx) {
          st.x -= dx * (st.r / Math.max(0.5, s.maxSize)); // parallax: big stars drift faster
          if (st.x < -2) st.x += size.w + 4;
        }
        g.globalAlpha = s.twinkle ? st.a * (0.6 + 0.4 * Math.sin(t * st.speed + st.phase)) : st.a;
        if (st.r < 1.2) {
          g.fillRect(st.x - st.r, st.y - st.r, st.r * 2, st.r * 2);
        } else {
          g.beginPath();
          g.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          g.fill();
        }
      }

      if (s.shootingStars) {
        if (now >= nextShoot) {
          spawnShooter();
          scheduleShoot(now);
        }
        g.strokeStyle = s.shootingColor;
        g.lineCap = 'round';
        for (let i = shooters.length - 1; i >= 0; i--) {
          const sh = shooters[i];
          sh.life += dt;
          sh.x += sh.vx * dt;
          sh.y += sh.vy * dt;
          const p = sh.life / sh.max;
          if (p >= 1) {
            shooters.splice(i, 1);
            continue;
          }
          // Fade in fast, out slowly; the tail is a few short segments of falling alpha.
          const fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
          const tail = 0.12;
          for (let k = 0; k < 4; k++) {
            g.globalAlpha = fade * (1 - k / 4);
            g.lineWidth = Math.max(1, s.maxSize * (1.2 - k * 0.25));
            g.beginPath();
            g.moveTo(sh.x - sh.vx * tail * (k / 4), sh.y - sh.vy * tail * (k / 4));
            g.lineTo(sh.x - sh.vx * tail * ((k + 1) / 4), sh.y - sh.vy * tail * ((k + 1) / 4));
            g.stroke();
          }
        }
      } else if (shooters.length) {
        shooters = [];
      }
      g.globalAlpha = 1;
    }

    function start() {
      if (!raf && active && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    seed();
    start();

    return {
      update(next) {
        const reseed = next.count !== s.count || next.maxSize !== s.maxSize;
        s = next;
        if (reseed) seed();
      },
      resize(next) {
        size = { w: next.w, h: next.h };
        seed();
      },
      setActive(a) {
        active = a;
        if (a) start();
        else stop();
      },
      destroy() {
        stop();
        document.removeEventListener('visibilitychange', onVisibility);
        el.removeChild(canvas);
      },
    };
  },
};
