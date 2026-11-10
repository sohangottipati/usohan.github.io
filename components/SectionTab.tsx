'use client';

import gsap from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { useEffect, useState } from 'react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollToPlugin);
}

const SECTIONS = [
  { id: 'intro', label: 'Intro' },
  { id: 'projects', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'connect', label: 'Connect' },
];

export function SectionTab() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const currentIndex = SECTIONS.findIndex((s) => s.id === active);
  const current = currentIndex >= 0 ? SECTIONS[currentIndex] : SECTIONS[0];

  function jumpToNext() {
    const nextIndex = ((currentIndex >= 0 ? currentIndex : 0) + 1) % SECTIONS.length;
    const target = `#${SECTIONS[nextIndex].id}`;
    // Native scrollIntoView / #anchor jumps land nowhere on GSAP-pinned
    // sections (their layout is driven by ScrollTrigger, not normal document
    // flow) -- ScrollToPlugin resolves the live position correctly.
    gsap.to(window, { duration: 0.9, scrollTo: { y: target, offsetY: 0 }, ease: 'power2.inOut' });
  }

  return (
    <button
      type="button"
      onClick={jumpToNext}
      aria-label={`Currently viewing ${current.label}. Jump to next section.`}
      className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center overflow-hidden rounded-l-2xl border border-r-0 border-[var(--border)] bg-[var(--bg)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out hover:-translate-x-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.97]">
      <span className="flex h-11 w-11 items-center justify-center border-b border-[var(--border)] font-serif text-lg font-bold normal-case text-[var(--accent)]">
        S.
      </span>
      <span className="px-2.5 py-4 text-[11px] font-bold lowercase tracking-[0.02em] text-[var(--sub)]" style={{ writingMode: 'vertical-rl' }}>
        {current.label}
      </span>
    </button>
  );
}
