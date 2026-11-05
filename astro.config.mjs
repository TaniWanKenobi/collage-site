// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://taniwankenobi.github.io',
  base: '/collage-site',
  trailingSlash: 'ignore',
  integrations: [react()],
});
