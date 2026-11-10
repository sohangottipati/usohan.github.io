'use client';

import { useEffect, useRef, useState } from 'react';

import { ThemeToggle } from '@/components/ThemeToggle';

import { PHONE_PROJECTS } from './projects';
import s from './PhoneShowcase.module.css';

const PHONE_H = 620;
const PHONE_W = 300;
const DEPTH = 18; // phone thickness in px
const BUMP = 7; // camera plateau height
const LENS = 5; // how far each lens ring rises above the plateau
const RIM_LAYERS = 18; // stacked rounded slices that fake a rounded metal edge

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Scroll-driven hero: an iPhone floats with its back to the viewer, spins
 * around as you scroll, then its screen wakes up with a project picker.
 * Tapping a project opens its live demo site.
 *
 * Built with plain CSS 3D transforms (not WebGL) so the screen is real,
 * clickable DOM. Uses position: sticky rather than a GSAP pin, so normal
 * document flow — and the SectionTab's ScrollToPlugin jumps — keep working.
 */
export function PhoneShowcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const capRRef = useRef<HTMLDivElement>(null);
  const capLRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);

  const [screenOn, setScreenOn] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    const phone = phoneRef.current;
    if (!stage || !phone) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = stage;

    let fit = 1;
    const resize = () => {
      fit = Math.min(1, (innerHeight * (innerWidth < 1000 ? 0.64 : 0.76)) / PHONE_H, (innerWidth * 0.82) / PHONE_W);
      root.style.setProperty('--fit', fit.toFixed(3));
    };
    resize();
    addEventListener('resize', resize);

    const progress = () => {
      if (reduced) return 1;
      const total = stage.offsetHeight - innerHeight;
      return total > 0 ? clamp(-stage.getBoundingClientRect().top / total) : 1;
    };

    let cur = progress();
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    const onMove = (e: PointerEvent) => {
      tmx = (e.clientX / innerWidth - 0.5) * 2;
      tmy = (e.clientY / innerHeight - 0.5) * 2;
    };
    addEventListener('pointermove', onMove);

    let on = false;
    let raf = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      const target = progress();
      cur += (target - cur) * (reduced ? 1 : 0.09);
      if (Math.abs(target - cur) < 0.0005) cur = target;
      mx += (tmx - mx) * 0.06;
      my += (tmy - my) * 0.06;
      const t = (now - t0) / 1000;

      // 0 → .14   idle: back of the phone gently sways
      // .14 → .62 phone spins around to face the viewer
      // .58 → .72 screen wakes up; picker becomes interactive
      const turn = ease(seg(cur, 0.14, 0.62));
      const idle = reduced ? 0 : 1 - turn;
      const rotY = lerp(-155, 0, turn) + Math.sin(t * 0.6) * 28 * idle + mx * 10 * turn;
      const rotX = lerp(16, 0, turn) + Math.sin(t * 0.8) * 3 * idle - my * 6 * turn;
      const rotZ = lerp(-10, 0, turn);
      const scale = lerp(0.78, 1, turn);
      const ty = lerp(70, 0, turn) + Math.sin(t * 1.1) * 6 * idle;
      phone.style.transform = `translateY(${ty}px) scale(${scale}) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`;

      const wake = seg(cur, 0.58, 0.72);
      if (darkRef.current) darkRef.current.style.opacity = String(1 - wake);
      if (glowRef.current) glowRef.current.style.opacity = String(wake);
      const nowOn = wake > 0.95;
      if (nowOn !== on) {
        on = nowOn;
        setScreenOn(nowOn);
      }

      const heroOut = seg(cur, 0.03, 0.2);
      if (heroRef.current) {
        heroRef.current.style.opacity = String(1 - heroOut);
        heroRef.current.style.transform = `translateY(${-40 * heroOut}px) scale(${1 - 0.06 * heroOut})`;
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - seg(cur, 0, 0.06));

      const cap = seg(cur, 0.66, 0.8);
      if (capRRef.current) capRRef.current.style.opacity = String(cap);
      if (capLRef.current) capLRef.current.style.opacity = String(cap);

      if (shadowRef.current) {
        const spread = 0.6 + 0.4 * Math.abs(Math.cos((rotY * Math.PI) / 180));
        shadowRef.current.style.transform = `translate(-50%, ${(310 * scale + ty + 12) * fit}px) scaleX(${spread * scale * fit})`;
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onMove);
    };
  }, []);

  const rimLayers = Array.from({ length: RIM_LAYERS }, (_, i) => -DEPTH / 2 + (DEPTH * (i + 0.5)) / RIM_LAYERS);
  const bumpLayers = Array.from({ length: BUMP }, (_, i) => i + 0.5);
  const lensLayers = Array.from({ length: LENS }, (_, i) => BUMP + i + 0.5);

  return (
    <div ref={stageRef} className={s.stage}>
      {/* Anchors for SectionTab: first half of the stage is Intro, second half is Projects. */}
      <div id="intro" className={s.anchorIntro} aria-hidden />
      <div id="projects" className={s.anchorProjects} aria-hidden />

      <div className={s.sticky}>
        <div className={s.glow} ref={glowRef} />
        <ThemeToggle />

        <div ref={heroRef} className={s.hero}>
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.1em] opacity-75">
            Computer Science · UC Riverside
          </p>
          <h1 className="font-serif text-[clamp(36px,7vw,72px)] font-semibold leading-[1.05] tracking-[-0.01em]">
            Hi, I&rsquo;m Sohan Gottipati.
          </h1>
          <p className="mx-auto mt-4 max-w-[52ch] text-[17px] leading-relaxed opacity-90">
            I build full-stack products end to end. Scroll to try them.
          </p>
        </div>

        <div ref={capLRef} className={`${s.caption} ${s.captionLeft}`} aria-hidden>
          <div className={s.stat}>1</div>
          <div className={s.statLabel}>app live</div>
          <div className={s.stat}>2</div>
          <div className={s.statLabel}>more on the way</div>
        </div>

        <div ref={shadowRef} className={s.shadow} />

        <div className={s.scene}>
          <div className={s.fit}>
            <div ref={phoneRef} className={s.phone}>
              {rimLayers.map((z) => (
                <div key={z} className={s.rim} style={{ transform: `translateZ(${z}px)` }} />
              ))}

              <div className={`${s.face} ${s.back}`} style={{ transform: `rotateY(180deg) translateZ(${DEPTH / 2 + 0.5}px)` }}>
                {/* Camera plateau + lenses are stacked slices so they stand off the back in 3D. */}
                <div className={s.camera}>
                  {bumpLayers.map((z) => (
                    <div key={z} className={s.bumpSlice} style={{ transform: `translateZ(${z}px)` }} />
                  ))}
                  <div className={s.bumpTop} style={{ transform: `translateZ(${BUMP}px)` }}>
                    <div className={s.flash} />
                  </div>
                  {[s.l1, s.l2, s.l3].map((pos) => (
                    <div key={pos} className={`${s.lensBarrel} ${pos}`}>
                      {lensLayers.map((z) => (
                        <div key={z} className={s.ring} style={{ transform: `translateZ(${z}px)` }} />
                      ))}
                      <div className={s.glass} style={{ transform: `translateZ(${BUMP + LENS}px)` }} />
                    </div>
                  ))}
                </div>
                <div className={`${s.monogram} font-serif`} style={{ transform: 'translate(-50%, -50%) translateZ(0.2px)' }}>
                  S.
                </div>
              </div>

              <div className={`${s.face} ${s.front}`} style={{ transform: `translateZ(${DEPTH / 2 + 0.5}px)` }}>
                <div className={s.screen} style={{ pointerEvents: screenOn ? 'auto' : 'none' }}>
                  <div className={s.island} />
                  <StatusBar />

                  <div className={`${s.view} ${s.home}`}>
                    <h3 className={s.homeTitle}>Projects</h3>
                    <div className={s.homeSub}>Tap one to open a live demo</div>
                    {PHONE_PROJECTS.map((p) =>
                      p.soon ? (
                        <div key={p.id} className={`${s.proj} ${s.soon}`} aria-disabled>
                          <div className={s.row}>
                            <div className={s.appIcon}>
                              <LockIcon />
                            </div>
                            <div>
                              <div className={s.name}>{p.name}</div>
                              <div className={s.tag}>{p.tagline}</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <a key={p.id} href={p.demo} className={s.proj} tabIndex={screenOn ? 0 : -1}>
                          <div className={s.row}>
                            <div className={s.appIcon}>{p.icon}</div>
                            <div>
                              <div className={s.name}>{p.name}</div>
                              <div className={s.tag}>{p.tagline}</div>
                            </div>
                          </div>
                          <div className={s.open}>
                            <span>{p.meta}</span>
                            <span className={s.pill}>Open demo</span>
                          </div>
                        </a>
                      )
                    )}
                  </div>

                  <div className={s.homeBar} />
                  <div ref={darkRef} className={s.screenDark} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div ref={capRRef} className={s.caption}>
          <div className={s.eyebrow}>Projects</div>
          <h2 className={`${s.capTitle} font-serif`}>Tap an app to try it.</h2>
          <p className={s.capBody}>
            Tap a project on the phone to open its live demo. Studispot is up first, with more on the way.
          </p>
        </div>

        <div ref={hintRef} className={s.hint}>
          Scroll
          <span />
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className={s.statusbar}>
      <span>9:41</span>
      <span className={s.icons}>
        <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor" aria-hidden>
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="5" y="5" width="3" height="6" rx="1" />
          <rect x="10" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="15" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden>
          <path d="M8 2.3c2.2 0 4.2.8 5.7 2.2l1.1-1.1A9.6 9.6 0 0 0 8 .7 9.6 9.6 0 0 0 1.2 3.4l1.1 1.1A8 8 0 0 1 8 2.3Zm0 3.2c1.3 0 2.5.5 3.4 1.3l1.1-1.1A6.4 6.4 0 0 0 8 3.9a6.4 6.4 0 0 0-4.5 1.8l1.1 1.1c.9-.8 2.1-1.3 3.4-1.3Zm0 3.2c.5 0 .9.2 1.2.5L8 10.4 6.8 9.2c.3-.3.7-.5 1.2-.5Z" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
          <rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
          <path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".4" />
        </svg>
      </span>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.6" aria-hidden>
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}
