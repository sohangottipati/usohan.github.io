# sohan.website

Personal portfolio. Next.js (App Router) + GSAP + Zustand + Tailwind, statically exported and deployed to GitHub Pages via GitHub Actions.

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # static export in ./out
```

Deploys automatically on push to `main`. Custom domain is set via `public/CNAME`.

## Projector wall

`/projector/edit` and `/projector/display/` are a projection-mapping tool for my room projector. The code is in `projector/`, and the API is a separate Cloudflare Worker in `projector/server/`. See [projector/docs/setup.md](projector/docs/setup.md).

## Homepage phone

The hero is a scroll-driven CSS 3D iPhone (`components/phone/PhoneShowcase.tsx`). Its screen lists projects from `components/phone/projects.tsx`; give an entry a `demo` URL and tapping it opens that site.
