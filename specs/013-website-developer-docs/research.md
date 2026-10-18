# Research: Marketing Website and Developer Documentation

Decisions behind [plan.md](plan.md), each with what was rejected. Versions are the
current stable releases at planning time (October 2026); implementation pins exact
versions in `apps/website/package.json`.

## R1. Site toolchain: Astro with Starlight in `apps/website`

**Decision**: Build one Astro 7 project with Starlight 0.42 mounted at `/docs`. The
marketing pages are ordinary Astro pages beside it. Output is static HTML. React
islands (`@astrojs/react`) render the few interactive controls with `@iot-os/ui`
components. Tailwind 4 comes in through `@tailwindcss/vite`, as in the portal, and
search is Starlight's built-in Pagefind index.

**Rationale**:
- Static HTML loads fast, works without JavaScript (an edge case in the spec) and
  needs no server.
- Islands let the inquiry form and the menu reuse the kit's `Button`, `Input`,
  `Textarea`, `RadioGroup` and `Field`. Everything else ships no JavaScript.
- Starlight provides the docs shell: sidebar, light and dark modes, accessible
  navigation, and an offline search index built at publish time.
- Astro content collections read Markdown from any path. The in-product guides
  (JSON front matter is valid YAML) and generated pages load without a CMS.

**Alternatives considered**:
- *Vite and React SPA like the portal*: needs a prerender step for search engines
  and for no-JS readers. That means rebuilding most of what Astro provides.
- *Next.js*: built around a server runtime the site doesn't need. Static export
  drops redirects and middleware.
- *Docusaurus*: React-based but docs-first. Marketing pages and Tailwind 4 tokens
  fight its own styling system, and it has two theming layers to keep in step with
  the kit.
- *VitePress*: Vue, which is outside the stack.
- *Mintlify, GitBook, ReadMe*: hosted and closed-source, with docs living outside
  the repository. That conflicts with the code being the source of truth and with
  the owner's open-source UI preference.

## R2. Hosting: Cloudflare Workers with static assets

**Decision**: Deploy the built site as a Worker's static assets. A small Worker
script runs only for `/api/*`, through `assets.run_worker_first: ["/api/*"]`.
Permanent redirects live in `_redirects`, and the host redirect from `www` to the
apex is a zone Redirect Rule. The marketing domain's DNS zone moves from its current
provider to Cloudflare. The current site has only an apex record, so this is a small
move.

**Rationale**:
- **FR-021, independence**: the site has a different provider, failure domain and
  deploy path from the hosted platform.
- **FR-023, redirects and rollback**: `_redirects` returns real 301s, with up to
  2,000 static rules. With DNS on Cloudflare, switching back means pointing the
  apex record at the old server (TTL 300 s), well inside an hour.
- **FR-007, the form**: inquiries need a small backend. A Worker gives rate
  limiting (the Rate Limiting binding), storage (D1) and delivery (the Email
  Service `send_email` binding to a verified team address) on the free plan.
- **FR-008, analytics**: zone analytics are server-side, so the site ships no
  analytics script and sets no cookies.
- **Review**: `wrangler versions upload` gives every pull request a preview URL.

**Alternatives considered**:
- *Netlify*: Netlify Forms (Akismet and a honeypot, stored submissions, email
  notifications) needs no backend code, and the apex works with external DNS. But
  Forms has no configurable per-address rate limit. Server-side analytics is a paid
  add-on. The credit-based free plan pauses a site, form included, when it goes over
  its limits. It is the fallback if the owner won't move DNS.
- *GitHub Pages*: no server-side 301s for arbitrary paths and no backend, so it
  fails FR-023 and FR-007.
- *Caddy on the pilot host*: puts the site and the product in one failure domain
  (FR-021), and site updates would ride the manual release process.
- *A separate small VM with Caddy*: a server to patch, TLS and deploy over SSH, plus
  a mail relay for the form. That is the most operations work for the least gain.

## R3. Inquiry delivery: a stored outbox, then email

**Decision**: `POST /api/inquiry` takes the request in this order:

1. Validate it against `contracts/website/inquiry.v1.schema.json`.
2. Reject bots silently: a filled honeypot field or a submission made under 3
   seconds after the form rendered.
3. Rate-limit it per client address (5 a minute), returning 429 with `Retry-After`.
4. Insert it into D1, deduplicated by the client-generated `id`.
5. Return 202 and try delivery straight away.

Delivery is one plain-text email to the configured team address through the
`send_email` binding, restricted to that address. A Cron Trigger every 5 minutes
retries anything still pending, with backoff. After 24 hours an inquiry is marked
`failed`, stays stored and shows in the delivery status check (FR-007, never dropped).

Delivered inquiries are purged after 30 days and failed ones after 90. The visitor
sees an on-screen confirmation. No email goes to the visitor.

**Rationale**:
- Storing before sending turns an email outage into a delay, not a loss, which is
  the spec's edge case. The `id` makes double-clicks and retries idempotent
  (constitution VII).
- No email to the visitor means the form can't be used to send mail to strangers.
  Email Service only delivers to verified addresses anyway.
- Honeypot, timing and rate limit catch common bots without puzzles or third-party
  scripts. Cloudflare Turnstile in managed mode is held in reserve if spam gets
  through, and would need a privacy-notice update when added.

**Alternatives considered**:
- *Posting to the Laravel API*: the form would fail while the platform is down
  (FR-021), and it would add an unauthenticated public write endpoint to the
  product.
- *A form service (Formspree, Basin)*: another processor of personal data and a
  monthly cost, with no control over retries or retention.
- *Sending directly without storing*: an email outage would lose inquiries.

## R4. Docs follow the hosted release

**Decision**: the hosted release record has two parts:
- **The hosted commit**, the full SHA running on the hosted service. It is never
  committed:
  - CI reads it from the Actions secret `WEBSITE_HOSTED_REF`. A secret rather than a
    variable, because public workflow logs show variable values unmasked.
  - Local builds read it from `.local/website/website.env`.
  - No script prints it, and nothing in `dist` contains it.
- **The feature switches** (`adapters`, `agent_access`), committed in
  `apps/website/hosted-release.json` and changed by pull request.

After each hosted deploy, the operator updates the secret and their `.local` value,
then publishes newly released drafts by pull request or redeploys by dispatch.
Releases are commits today, not tags, and there is no CD.

The build extracts the generated sources (`contracts/openapi`, `contracts/agents`,
`apps/api/resources/help`, `packages/integration-sdk/package.json` and
`tooling/simulators`) from that commit with `git archive` into the ignored
`apps/website/.sources/`. Locally, `WEBSITE_SOURCES=worktree` reads the working tree
instead.

Hand-written pages about unreleased behaviour carry Starlight's `draft: true`.
Starlight leaves drafts out of production builds and shows them in development.
When the record is bumped, `check-site.mjs drafts` lists drafts whose introducing
commit is now an ancestor of the hosted commit, so the bump pull request can publish
them.

**Rationale**:
- Publishing the exact production commit in a public repository would let anyone
  diff it against `main` and find security fixes that are merged but not yet
  deployed. Keeping it private costs one secret update per hosted deploy.
- The feature switches reveal nothing sensitive and are worth reviewing, so they
  stay in a committed file. It works with today's manual releases.
- Marketing copy and docs prose fixes still ship from `main` at any time. Only the
  generated reference and drafted pages wait for the release.

**Alternatives considered**:
- *Building the whole site from the release commit*: prose fixes would wait for a
  platform release.
- *Inferring the release from the pilot host*: the site's CI would need access to
  the production host.
- *Reading feature switches from repository defaults*: the defaults are "off" for
  every deployment and say nothing about the hosted service.
- *Committing the commit SHA* (the first draft of this plan): rejected for the
  disclosure risk above.
- *A plain Actions variable for the SHA*: rejected because variables aren't masked in
  public logs.

## R5. Generated reference

**Decision**:
- **API reference**: `scripts/sources.mjs` writes `integration-openapi.json`. It
  keeps the `/integration/v1` paths, the `webhooks` section and every component they
  reference (a `$ref` walk), and sets `servers` to the configured API base URL. The
  `starlight-openapi` plugin, which supports OpenAPI 3.1 and generates operation code
  samples, renders it under `/docs/reference/api/`.
- **Abilities and rate limits**: the contract keeps them in vendor extensions
  (`x-abilities`, for example `{all: ["devices:read"]}`, and `x-rate-limits`, for
  example 240 a minute per address and 60 per application). The plugin renders
  standard fields only, so `sources.mjs` prepends "Requires: `devices:read`" and
  "Rate limits: …" lines to each operation's `description`. The `reference` check
  confirms every generated page shows them (FR-013).
- **Events and webhook delivery**: pages rendered by site components from the
  filtered contract's `IntegrationEvent` discriminator mapping and
  `webhooks.integrationEvent`. This doesn't depend on the plugin's webhook support.
- **Agent tools**: a table rendered from `contracts/agents/tools.json`.
- **User guides**: `sources.mjs` writes each guide to
  `src/content/docs/docs/guides/<slug>.md`, a generated and ignored path, as a build
  artifact rather than a committed second copy (FR-015). Its front matter becomes
  `title`, `description` (the summary), `help_revision` and `requires` (from
  `required_capabilities`). It rewrites `/help/<slug>` links to `/docs/guides/<slug>/`.
  Starlight's autogenerated sidebar groups by folder, not front matter. So
  `astro.config.mjs` builds one sidebar group per guide `section` from `meta.json`,
  keeping URLs flat.
- **Feature gating**: the docs collection drops `adapters/` and `agents/` folders
  whose switch is off, using glob negation. PR 4 first checks that Starlight's
  `docsLoader` accepts a glob pattern. If it doesn't, the collection uses Astro's
  `glob({ base, pattern })` loader with `docsSchema`, which Starlight supports for
  custom loaders.
- **Fail closed**: any unknown front matter field, unresolved `$ref` or missing
  guide fails the build (US4 scenario 2).

**Alternatives considered**: Scalar or Redoc embedded as one client-side page. These
are not in the Pagefind index, don't work without JavaScript and are styled apart
from the kit. Hand-copying the reference was rejected because it would drift.

## R6. Design system on a static site

**Decision**:
- `src/styles/site.css` imports `@iot-os/ui/globals.css`. `src/styles/starlight.css`
  maps Starlight's `--sl-color-*` and font variables onto the kit tokens, so both
  sides share one palette in light and dark.
- Marketing sections are site-local `.astro` components using kit tokens and the
  named type scale. Interactive controls are kit React components in islands.
- `check-ui.mjs` gains `.astro` in its file filter, and the site's `lint` runs it on
  `apps/website/src`.

**Rationale**: no product screen uses a hero or a pricing-free feature grid, so
these don't belong in the kit. Tokens, type and controls do, and the guardrail keeps
raw palette colours and arbitrary sizes out. This is recorded in the plan's
Complexity Tracking table.

## R7. Build checks

**Decision**: `apps/website/scripts/check-site.mjs` runs after `astro build` and
fails the build on any of these:

- **literals**: a configured value appears in `src/` outside `site.config.ts`. CI
  provides the real values as secrets, so this check also proves they are not
  committed (FR-003, FR-004).
- **names**: built text contains a name from the private denylist (CI secret
  `WEBSITE_DENYLIST`, or `.local/website/denylist.txt` locally) (FR-006).
- **claims**: every `<Claim>` either links to a built docs route or names an entry
  in `src/claims.yaml` with `source` and `reviewed_by`. A percentage or numeric range
  on a marketing page outside a `<Claim>` fails (FR-005).
- **features**: no built page links to a docs route excluded by a feature switch or
  by `draft` (FR-012).
- **reference**: the generated API pages match the filtered contract's operations
  one to one, each shows its "Requires" and "Rate limits" lines, and the events page
  lists exactly the contract's `IntegrationEventType` values (FR-013, SC-003).
- **changelog**: entries exist for the hosted contract's `info.version` and the
  SDK's version. The operations and event types in `meta.json` must also equal the
  committed `changelog-baseline.json`. A difference fails until the pull request adds
  a changelog entry and refreshes the baseline (`check-site changelog --update`), so
  an event type added within v1 without a version change still gets an entry
  (FR-019).
- **redirects**: every path in `src/redirects.ts` resolves to a built page (FR-023,
  SC-006).

Links are checked by `starlight-links-validator`. Accessibility is checked with
Playwright and `@axe-core/playwright` on every route in the sitemap, waiting for
`document.getAnimations()` to settle so colour fades don't cause flaky contrast
failures. Performance is checked by Lighthouse CI on the marketing pages with the
mobile preset, asserting LCP ≤ 2,000 ms (SC-004).

Privacy is checked by a Playwright spec on every sitemap route: no `Set-Cookie`
header, an empty `document.cookie` and no request to another origin. The kit's fonts
come from `@fontsource` packages and are bundled, so they pass (FR-008).

A sitemap exists from PR 1 through `@astrojs/sitemap`. When Starlight arrives in
PR 4, the build must still produce exactly one `sitemap-index.xml` covering
marketing and docs routes.

## R8. Running the samples

**Decision**:
- Developer samples live as real files in `apps/website/samples/developer/` and are
  shown with Starlight's `<Code>` from a `?raw` import, so the page shows exactly
  the file that runs.
- `tooling/verify-website-samples.mjs` runs them against the fixture made by
  `tooling/verify-integration-sdk.php`, and `tooling/test-devices.mjs` adds it to
  `./taskw devices:test` (FR-018).
- The hardware path runs the downloadable simulator kit with a real connection kit
  in the same suite.
- CI type-checks and syntax-checks the samples. It can't run them because it has no
  live stack, the same limit as `studio.spec.ts` and the devices suite today. FR-018
  makes up for that with a gate in the CI `website` job: a pull request that changes
  `apps/website/samples/`, `packages/integration-sdk/` or the integration API
  (`apps/api/app/Domain/Integrations/`, `contracts/openapi/supplements/integration*.yaml`)
  fails unless its description records a `./taskw devices:test` run.

**Hardware path**: the reference simulator reads the connection kit's
`device-config.json` as is: same keys, and `ca_file` resolves from the kit folder. It
behaves as one edge node with two downstream devices:
- `meter` publishes fixed readings (`Voltage L1`, `Voltage L2`, `Voltage L3`,
  `Imported energy`, `Exported energy`, all Double)
- `rgb-light` publishes `Power` (Boolean), `Color` (String), `Mode` (String) and
  `Brightness` (Int32), and is the only device that accepts commands (DCMD)

The edge node's own NBIRTH carries only `bdSeq`, `Node Control/Rebirth` and `Uptime`.
So the quickstart needs two starter profiles, "Simulated meter" and "Simulated light"
(controllable Power, Color, Mode and Brightness), and the confirmed command goes to
`rgb-light`. PR 5's first task proves which onboarding path works, before any page is
written:
- *Preferred*: create a direct device and download its kit, run the simulator, then
  onboard `meter` and `rgb-light` from **Connect → Discovery** under that edge node.
- *Fallback*: if discovery onboarding under a direct device's edge node isn't
  allowed, add the smallest simulator flag that births one device's metrics as the
  edge node's own and accepts NCMD writes, with a test in `tooling/simulators`.

## R9. Publishing the SDK

**Decision**:
- Publish `packages/integration-sdk` to the public npm registry from a GitHub
  Actions workflow on `sdk-v*` tags, using npm trusted publishing (OIDC, with
  provenance) so no long-lived npm token exists.
- The package gains `license`, `repository`, `homepage` (the docs) and a `LICENSE`
  file. The license is MIT unless the owner chooses Apache-2.0, and it covers the
  package only.
- The README drops "not published".

**Owner decisions before that PR**: the npm scope and name, and the license. The
package is `@iot-os/integration-sdk` today, and publishing fixes that public name.
Renaming later means deprecating it and publishing again.

## R10. Privacy and analytics

**Decision**: no client-side analytics, cookies or third-party scripts; traffic
figures come from Cloudflare's server-side zone analytics. The privacy notice names
the processor (Cloudflare: hosting, inquiry storage and email delivery), what the
form collects and why, retention (30 days delivered, 90 days failed) and a contact
for requests. The company supplies the final text, and engineering supplies those
facts.

## R11. Cutover

**Decision**:
1. Move the zone to Cloudflare, with records copied and checked.
2. Deploy and review on a preview URL.
3. Route the apex and `www` to the Worker.
4. Keep the old server running for 30 days, and record the old address in the
   private operations inventory, not here.

Rollback is one DNS change. URLs keep their current paths where the content carries
over (`/platform`, `/solutions`, `/solutions/factory`, `/solutions/carbonops`,
`/solutions/water`, `/contact`), so most need no redirect. Only renamed pages get
one, for example `/scan` → `/assessment`.

## R12. ADR

**Decision**: add **ADR-020, Public website and developer docs outside the product**:
a static Astro site in this monorepo, deployed to Cloudflare by its own workflow,
with docs generated from the hosted release. It adds a deployable, a vendor and the
repository's first continuous deployment, and it extends the constitution's stack
list. None of that contradicts an accepted ADR. ADR-001 covers the customer and
administration applications, which stay React. Spec branches 009, 011 and 012 add no
ADR beyond 019, so 020 is free.

## Sources

- [Astro newsletter, September 2026](https://buttondown.com/withastro/archive/the-astro-post-september-2026/) (Starlight 0.42 on Astro 7)
- [starlight-openapi](https://github.com/HiDeoo/starlight-openapi) (OpenAPI 3.1, operation snippets)
- [Workers static assets: binding and `run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding) and [redirects](https://developers.cloudflare.com/workers/static-assets/redirects/index.md)
- [Email Service send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/index.md)
- [Netlify pricing update, April 2026](https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/) and [spam filters](https://docs.netlify.com/manage/forms/spam-filters/)
