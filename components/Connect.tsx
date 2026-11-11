import { Reveal } from '@/components/Reveal';

export function Connect() {
  return (
    <section id="connect">
      <Reveal>
        <p className="mb-2 text-[13px] font-bold tracking-[0.02em] text-[var(--accent)]">Connect</p>
        <h2 className="mb-6 font-serif text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
          Let&rsquo;s talk.
        </h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://www.linkedin.com/in/sgot"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-[15px] font-semibold text-[var(--ink)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] active:scale-[0.97]">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px] shrink-0" aria-hidden>
              <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
            </svg>
            LinkedIn
          </a>
          <a
            href="mailto:gottipatisohan@gmail.com"
            className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-[15px] font-semibold text-[var(--ink)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] active:scale-[0.97]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
              <path d="M4 4h16v16H4z" />
              <path d="m4 6 8 7 8-7" />
            </svg>
            Email
          </a>
          <a
            href="https://github.com/sohangottipati"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-3 text-[15px] font-semibold text-[var(--ink)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] active:scale-[0.97]">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px] shrink-0">
              <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.23.72-.51v-1.99c-2.92.64-3.54-1.24-3.54-1.24-.48-1.22-1.17-1.55-1.17-1.55-.96-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.61 2.47 1.15 3.07.88.1-.68.37-1.15.67-1.42-2.33-.27-4.79-1.17-4.79-5.2 0-1.15.41-2.09 1.08-2.82-.11-.27-.47-1.35.1-2.81 0 0 .88-.28 2.88 1.08a10 10 0 0 1 5.24 0c2-1.36 2.88-1.08 2.88-1.08.57 1.46.21 2.54.1 2.81.67.73 1.08 1.67 1.08 2.82 0 4.04-2.46 4.93-4.8 5.19.38.33.72.97.72 1.96v2.9c0 .28.19.62.73.51A10.5 10.5 0 0 0 12 1.5z" />
            </svg>
            GitHub
          </a>
        </div>
      </Reveal>

    </section>
  );
}
