// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://taniwankenobi.github.io',
  base: '/collage-site',
  trailingSlash: 'ignore',
  integrations: [react()],
  // Inline the small global stylesheet: one fewer render-blocking request.
  build: { inlineStylesheets: 'always' },
  // Let Vite bundle photoswipe so its CSS import resolves in dev SSR (Node can't load .css).
  vite: { ssr: { noExternal: ['photoswipe'] } },
});
