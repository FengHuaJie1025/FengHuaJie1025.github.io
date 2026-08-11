import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    role: z.string(),
    stack: z.array(z.string()).default([]),
    period: z.string().optional(),
    summary: z.string(),
    highlights: z.array(z.string()).default([]),
    links: z
      .array(z.object({ label: z.string(), url: z.string() }))
      .default([]),
    cover: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
  }),
});

const notes = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    tags: z.array(z.string()).default([]),
    date: z.coerce.date(),
    summary: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects, notes };
