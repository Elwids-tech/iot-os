// The docs collection. Starlight's docsLoader takes no pattern, so this uses Astro's
// glob loader with the same rules (Markdown and MDX, files starting with _ ignored)
// and leaves out the folders of features the hosted service has switched off
// (spec 013 FR-006).
import { docsSchema } from '@astrojs/starlight/schema'
import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
import { hostedRelease } from './lib/hosted-release'

const pattern = ['**/[^_]*.{md,mdx}']
if (!hostedRelease.features.adapters) pattern.push('!**/adapters/**')
if (!hostedRelease.features.agent_access) pattern.push('!**/agents/**')

export const collections = {
  docs: defineCollection({
    loader: glob({ base: './src/content/docs', pattern }),
    schema: docsSchema({
      extend: z.object({
        help_revision: z.number().int().min(1).optional(),
        requires: z.array(z.string()).optional(),
      }),
    }),
  }),
}
