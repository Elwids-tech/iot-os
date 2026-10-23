// The platform's front door (a landing page at /) and the developer docs (under
// /docs), built with Starlight (spec 013, ADR-021). Run `node scripts/sources.mjs`
// first: it writes the generated reference inputs this config reads.
import { existsSync, readFileSync } from 'node:fs'
import starlight from '@astrojs/starlight'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import starlightOpenAPI, { createOpenAPISidebarGroup } from 'starlight-openapi'
import { docsConfig } from './docs.config.ts'

const metaFile = new URL('./.sources/meta.json', import.meta.url)
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { guide_sections: [] }
const apiReference = createOpenAPISidebarGroup()

export default defineConfig({
  site: docsConfig.siteUrl,
  integrations: [
    starlight({
      title: docsConfig.productName,
      description: `Developer documentation for ${docsConfig.productName}, the platform behind ${docsConfig.companyName}.`,
      customCss: ['./src/styles/docs.css'],
      credits: false,
      lastUpdated: false,
      pagination: true,
      // Long lines wrap instead of scrolling, so code blocks need no keyboard focus.
      expressiveCode: { defaultProps: { wrap: true } },
      components: {
        ThemeProvider: './src/components/docs/ThemeProvider.astro',
        SiteTitle: './src/components/docs/SiteTitle.astro',
        SocialIcons: './src/components/docs/SocialIcons.astro',
        Footer: './src/components/docs/Footer.astro',
        PageTitle: './src/components/docs/PageTitle.astro',
      },
      plugins: [
        starlightOpenAPI([
          {
            base: 'docs/reference/api',
            schema: './.sources/integration-openapi.json',
            sidebar: { label: 'Integration API reference', group: apiReference, operations: { badges: true } },
          },
        ]),
        // The landing page and the generated API reference aren't part of the content
        // collection; check-docs `features` and `reference` verify links to them instead.
        starlightLinksValidator({ exclude: ['/', '/docs/reference/api/**'] }),
      ],
      sidebar: [
        { label: 'Start here', items: [{ label: 'Overview', link: '/docs/' }] },
        {
          label: 'Developers',
          items: [{ label: 'Events and the event feed', link: '/docs/developers/events/' }, apiReference],
        },
        {
          label: 'User guides',
          collapsed: true,
          items: meta.guide_sections.map(({ section, slugs }) => ({
            label: section,
            collapsed: true,
            items: slugs.map((slug) => `docs/guides/${slug}`),
          })),
        },
        { label: 'Changelog', link: '/docs/changelog/' },
      ],
    }),
  ],
  // The landing hero's Three.js chunk (about 130 KB gzipped) loads only after the page
  // is idle, so it may exceed Vite's default warning size.
  vite: { plugins: [tailwindcss()], build: { chunkSizeWarningLimit: 600 } },
})
