import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file per project. Order is the card order on the Projects page.
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    blurb: z.string(),
    tags: z.array(z.string()).default([]),
    order: z.number(),
    image: z.string().optional(), // path under public/, e.g. "projects/holos.png"
    model: z.string().optional(), // GLB under public/models/, e.g. "models/inkbadge.glb"
  }),
});

const timeline = defineCollection({
  loader: file('src/data/timeline.json'),
  schema: z.object({ when: z.string(), what: z.string(), order: z.number() }),
});

const writing = defineCollection({
  loader: file('src/data/writing.json'),
  schema: z.object({ kind: z.enum(['post', 'award']), title: z.string(), date: z.string(), order: z.number() }),
});

export const collections = { projects, timeline, writing };
