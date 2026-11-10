// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Two hosts build the same site: Vercel (the real home, tanishq.quest, served from the root) and the older
// GitHub Pages copy (served under /collage-site). Vercel sets VERCEL=1 during its builds.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  site: onVercel ? 'https://tanishq.quest' : 'https://taniwankenobi.github.io',
  base: onVercel ? '/' : '/collage-site',
  trailingSlash: 'ignore',
  integrations: [react()],
  // Inline the small global stylesheet: one fewer render-blocking request.
  build: { inlineStylesheets: 'always' },
  // Let Vite bundle photoswipe so its CSS import resolves in dev SSR (Node can't load .css).
  vite: { ssr: { noExternal: ['photoswipe'] } },
});
