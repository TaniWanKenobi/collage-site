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

// Accomplishments (section id "timeline"): one dated list, sorted by `order` (1 = newest).
// `post` is a blog post id (its file name in src/content/blog, without .md); awards link to it.
const timeline = defineCollection({
  loader: file('src/data/timeline.json'),
  schema: z.object({
    order: z.number(),
    when: z.string(),
    what: z.string(),
    kind: z.enum(['timeline', 'project', 'award', 'event']),
    detail: z.string().optional(),
    note: z.string().optional(), // shown handwritten
    post: z.string().optional(),
    current: z.boolean().optional(),
    placeholder: z.boolean().default(false),
  }),
});

// Blog (section id "writing"): one Markdown file per post, served at /blog/<id>/.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['essay', 'build log', 'note']),
    excerpt: z.string(),
    readMins: z.number(),
    award: z.string().optional(), // e.g. "Won 1st, [Contest name]"
    placeholder: z.boolean().default(false),
  }),
});

export const collections = { projects, timeline, blog };
