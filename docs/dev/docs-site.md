# Docs site: the platform's front door and developer docs

`apps/docs` is the public site at the root of the platform's domain: a landing page
at `/` and the developer docs under `/docs`. It is a static Astro and Starlight site,
published to GitHub Pages ([ADR-021](../adr/ADR-021-developer-docs-only.md),
[spec 013](../../specs/013-website-developer-docs/spec.md)). The company's marketing
website is not here: it lives in its own repository and links to these pages.
Publishing, DNS and secrets are in [ops/docs-site](../ops/docs-site.md).

## Local development

```bash
pnpm --filter @iot-os/docs dev
```

`dev` generates the sources from the working tree (`DOCS_SOURCES=worktree`) and
serves the site with hot reload; drafts are visible. Placeholder names and
`example.com` addresses are used until you add real values to
`.local/docs/docs.env` (ignored by git, never in the app folder):

| Variable | Meaning |
| --- | --- |
| `PUBLIC_DOCS_PRODUCT_NAME`, `PUBLIC_DOCS_COMPANY_NAME`, `PUBLIC_DOCS_COMPANY_TAGLINE` | Names shown on every page and in the landing animation |
| `PUBLIC_DOCS_SITE_URL` | The platform domain's root (no path) |
| `PUBLIC_DOCS_MARKETING_URL`, `PUBLIC_DOCS_CONTACT_URL` | The company website and its contact page |
| `PUBLIC_DOCS_PORTAL_URL`, `PUBLIC_DOCS_API_BASE_URL`, `PUBLIC_DOCS_BROKER_HOST` | Where customers sign in, call the API and connect devices |
| `DOCS_HOSTED_REF` | The full commit the hosted service runs; never paste it anywhere public |

The private names list for the `names` check goes in `.local/docs/denylist.txt`, one
name per line.

## How a build works

`pnpm --filter @iot-os/docs build` runs three steps:

1. `scripts/sources.mjs` reads the hosted commit (`DOCS_HOSTED_REF`) with `git archive`
   and writes, all ignored by git:
   - `.sources/integration-openapi.json`: the integration API only, with each
     operation's abilities and rate limits written into its description (the
     reference plugin ignores `x-` extensions), and external schema files inlined
   - `.sources/meta.json`: contract and SDK versions, operations, event types and
     guide sections, never the commit
   - `src/content/docs/docs/guides/`: one page per in-product help guide, with its
     revision; `/help/<slug>` links become `/docs/guides/<slug>/`, and other
     root-relative links go to the portal
2. `astro build` renders the site.
3. `scripts/check-docs.mjs all` runs the checks below.

Without `DOCS_HOSTED_REF`, set `DOCS_SOURCES=worktree` to read the working tree.

## Writing pages

- Hand-written docs live in `src/content/docs/docs/` and are served under `/docs`.
  Write for engineers outside the company: no repository paths, internal class names
  or ADR jargon. Don't describe self-hosting, call the product open source, name a
  repository license, or name customers, prospects or pilots.
- Names, domains and addresses come from `docs.config.ts`: use
  `<Config key="apiBaseUrl" />` in MDX and `docsConfig` in components. Samples use
  `example.com`, `.test` and documentation IP ranges.
- `draft: true` marks a page about unreleased behaviour: production builds leave it
  out. After a hosted deploy, `check-docs drafts` lists the drafts that are now
  released.
- Pages about adapters go under a folder named `adapters/`, and pages about AI agents
  under `agents/`. `src/content.config.ts` leaves those folders out while
  `hosted-release.json` has the feature off. It uses Astro's `glob()` loader with
  Starlight's schema, because Starlight's `docsLoader` takes no pattern.
- Generated pages are never edited here; edit their source: the API contract, the
  agent tool catalogue (`contracts/agents/tools.json`) or the help guides
  (`apps/api/resources/help`).
- When the hosted contract's version, operations or event types change, add an entry
  to `changelog.mdx` and refresh the baseline:

  ```bash
  pnpm --filter @iot-os/docs exec node scripts/check-docs.mjs changelog --update
  ```

## The landing page

`src/pages/index.astro` renders the landing page through Starlight's `StarlightPage`
with the splash template, so it shares the docs header and theme.

- **Content:** it names no industry products, outcome figures or customers. Actions
  and cards appear only for pages that are built and not drafts, and every capability
  it mentions links to a docs page.
- **Hero animation** (`src/components/landing/Hero.astro`, `src/scripts/hero/`): a
  Three.js scene forms the company name from data particles and pours each letter into
  its word of the tagline when the name is an acronym of it. Then the particles settle
  into a drifting constellation.
  - The DOM text is always the content; the canvas only decorates it.
  - Three.js loads only after the page has loaded and painted, so it never delays
    the largest contentful paint. The inline script checks for WebGL without creating
    a context, which would hold up parsing.
  - With reduced motion or without JavaScript, the final text shows at once; without
    a WebGL context, as soon as the scene finds none. If the scene never starts, an
    inline script shows the text after three seconds.
- **Palette:** `src/styles/brand.css` is an accent layer on the kit tokens: life
  (teal), signal (the kit's blue) and energy (amber), for light and dark. The hero is
  the one place with display sizes beyond the named type scale (`--hero-*`).

## Styling

`src/styles/docs.css` loads Tailwind's theme and utilities without its preflight
(through `@astrojs/starlight-tailwind`) and the kit's `@iot-os/ui/tokens.css`.
`starlight.css` maps Starlight's colour and font variables onto the kit tokens.
Overrides in `src/components/docs/`:

- `ThemeProvider` mirrors Starlight's `data-theme` onto the `.dark` class and the Dusk
  palette that the kit tokens key on
- `SocialIcons` adds the company website and **Sign in** to the header
- `Footer` adds **Report a problem with this page**, linking to the company contact
  page with the page address
- `PageTitle` hides the title on the landing page and shows the revision on generated
  guides

`check-ui` scans `.astro` files too.

## Checks

| Check | Fails when | Fix |
| --- | --- | --- |
| `literals` | A configured name, domain or host is written in `src/` | Use `docsConfig` or `<Config>` |
| `rename` | A build with another product name still shows the configured one | Find the literal it reports |
| `names` | A private name appears in the source or the built site (the name is never printed) | Remove it |
| `features` | A built page links to a draft, a switched-off feature or an unbuilt page | Fix the link or publish the page |
| `reference` | API pages don't match the contract one to one, lack "Requires:" or "Rate limits:", the events page differs from the contract's event types, or the hosted commit appears in `dist` | Rebuild sources; never print the commit |
| `changelog` | The newest versions have no entry, or operations or event types changed without refreshing the baseline | Add an entry, then `changelog --update` |

`literals` runs in `lint`, `rename` runs on its own (it builds a second time), and the
rest run after every build. `names` only warns without a list; the deploy workflow
requires one.

## Tests

```bash
pnpm --filter @iot-os/docs test        # unit tests for the build scripts
pnpm --filter @iot-os/docs build && pnpm --filter @iot-os/docs test:e2e
pnpm --filter @iot-os/docs exec lhci autorun
```

The browser tests cover four projects: phone and desktop widths, light and dark.
They check:

- axe (WCAG 2.2 AA), no sideways scrolling, and privacy on every page in the
  sitemap: no cookies and no request to another origin
- the header and footer links
- the landing intro and its reduced-motion fallback

Lighthouse asserts the largest contentful paint stays under two seconds on mobile,
taking the median of three runs per page because single runs vary by a few hundred
milliseconds.

Astro runs one preview server per project. Playwright reuses one already running on
port 4321.
