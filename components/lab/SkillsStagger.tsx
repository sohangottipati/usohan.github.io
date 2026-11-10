'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

const SKILLS = ['TypeScript', 'React', 'React Native', 'Next.js', 'Supabase', 'PostgreSQL', 'Tailwind', 'GSAP'];

export function SkillsStagger() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll('[data-skill]');
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: prefersReduced ? 0 : 16 },
        {
          opacity: 1,
          y: 0,
          duration: prefersReduced ? 0.3 : 0.5,
          ease: 'power3.out',
          stagger: 0.05,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        }
      );
    }, ref);

    return () => ctx.revert();
  }, []);

  return (
    <section id="skills">
      <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--accent)]">Stack</p>
      <h2 className="mb-6 font-serif text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
        What I build with.
      </h2>
      <div ref={ref} className="flex flex-wrap gap-3">
        {SKILLS.map((skill) => (
          <span
            key={skill}
            data-skill
            className="rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--ink)]">
            {skill}
          </span>
        ))}
      </div>
    </section>
  );
}
