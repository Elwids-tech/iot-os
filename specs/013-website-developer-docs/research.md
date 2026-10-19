# Research: Developer Documentation and SDK Publishing

Decisions behind [plan.md](plan.md), each with what was rejected. Versions are the
current stable releases at planning time (October 2026); implementation pins exact
versions in `apps/docs/package.json`.

**Revised 2026-10-18** ([ADR-021](../../docs/adr/ADR-021-developer-docs-only.md)):
the marketing website moved to its own repository. R1, R2, R6, R7, R10 and R12 are
revised for a docs-only site. R3 and R11 described the website's inquiry form and
cutover; they are kept, marked as moved, as input for the website repository.
Requirement numbers in the moved and superseded parts refer to the 2026-10-17 version
of the spec (in git history), not to the current one.

## R1. Docs toolchain: Astro with Starlight in `apps/docs`

**Decision**: Build one Astro 7 project with Starlight 0.42, served under `/docs` on
the docs subdomain. Output is static HTML. React islands (`@astrojs/react`) are used
only where a page needs interaction, with `@iot-os/ui` components. Tailwind 4 comes
in through `@tailwindcss/vite`, as in the portal, and search is Starlight's built-in
Pagefind index.

**Rationale**:
- Static HTML loads fast, works without JavaScript (an edge case in the spec) and
  needs no server.
- Starlight ships almost no JavaScript, and islands reuse the kit's controls where a
  page needs them.
- Starlight provides the docs shell: sidebar, light and dark modes, accessible
  navigation, and an offline search index built at publish time.
- Astro content collections read Markdown from any path. The in-product guides
  (JSON front matter is valid YAML) and generated pages load without a CMS.

**Alternatives considered**:
- *Vite and React SPA like the portal*: needs a prerender step for search engines
  and for no-JS readers. That means rebuilding most of what Astro provides.
- *Next.js*: built around a server runtime the docs don't need.
- *Docusaurus*: React-based and docs-first, but Tailwind 4 tokens fight its own
  styling system, and it has two theming layers to keep in step with the kit.
- *VitePress*: Vue, which is outside the stack.
- *Mintlify, GitBook, ReadMe*: hosted and closed-source, with docs living outside
  the repository. That conflicts with the code being the source of truth and with
  the owner's open-source UI preference.

## R2. Hosting: GitHub Pages (revised; the earlier Cloudflare decision follows)

**Decision**: `.github/workflows/docs-deploy.yml` builds the docs and publishes them
with `actions/upload-pages-artifact` and `actions/deploy-pages`, on `main` and by
manual dispatch. The docs subdomain is a CNAME record pointing at GitHub Pages, with
HTTPS enforced.

**Rationale**:
- A docs-only site has no form, storage or redirects, so static hosting is enough
  (FR-018, FR-020).
- The repository is public, so Pages is included. The workflow needs only
  `pages: write` and `id-token: write`: no new vendor, account or DNS zone move.
- A custom Actions workflow is exempt from the 10-builds-an-hour limit. The 1 GB site
  limit, the soft 100 GB a month bandwidth and the 10-minute deployment timeout are
  far above what the docs need.
- A failed build never reaches the deploy step, so the previous version stays online
  (FR-019).

**Alternatives considered**:
- *Cloudflare, as first planned below*: still sound, but it brings an account, an API
  token and a zone move for no benefit once the form and redirects are gone.
- *The marketing site's host*: couples the docs to the website repository's deploys
  and makes them depend on reading this repository at the hosted commit.
- *Caddy on the pilot host*: puts the docs and the product in one failure domain
  (FR-018).

### Superseded: Cloudflare Workers with static assets (moved to the website repository)

**Decision (2026-10-17)**: Deploy the built site as a Worker's static assets. A small Worker
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

## R3. Inquiry delivery (moved to the website repository)

Kept as input for the website repository's form; nothing here is built in this
repository.

**Decision (2026-10-17)**: `POST /api/inquiry` takes the request in this order:

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
  - CI reads it from the Actions secret `DOCS_HOSTED_REF`. A secret rather than a
    variable, because public workflow logs show variable values unmasked.
  - Local builds read it from `.local/docs/docs.env`.
  - No script prints it, and nothing in `dist` contains it.
- **The feature switches** (`adapters`, `agent_access`), committed in
  `apps/docs/hosted-release.json` and changed by pull request.

After each hosted deploy, the operator updates the secret and their `.local` value,
then publishes newly released drafts by pull request or redeploys by dispatch.
Releases are commits today, not tags, and there is no CD.

The build extracts the generated sources (`contracts/openapi`, `contracts/agents`,
`apps/api/resources/help`, `packages/integration-sdk/package.json` and
`tooling/simulators`) from that commit with `git archive` into the ignored
`apps/docs/.sources/`. Locally, `DOCS_SOURCES=worktree` reads the working tree
instead.

Hand-written pages about unreleased behaviour carry Starlight's `draft: true`.
Starlight leaves drafts out of production builds and shows them in development.
When the record is bumped, `check-docs.mjs drafts` lists drafts whose introducing
commit is now an ancestor of the hosted commit, so the bump pull request can publish
them.

**Rationale**:
- Publishing the exact production commit in a public repository would let anyone
  diff it against `main` and find security fixes that are merged but not yet
  deployed. Keeping it private costs one secret update per hosted deploy.
- The feature switches reveal nothing sensitive and are worth reviewing, so they
  stay in a committed file. It works with today's manual releases.
- Docs prose fixes still ship from `main` at any time. Only the generated reference
  and drafted pages wait for the release.

**Alternatives considered**:
- *Building the whole docs site from the release commit*: prose fixes would wait
  for a platform release.
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
  confirms every generated page shows them (FR-010).
- **Events and webhook delivery**: pages rendered by site components from the
  filtered contract's `IntegrationEvent` discriminator mapping and
  `webhooks.integrationEvent`. This doesn't depend on the plugin's webhook support.
- **Agent tools**: a table rendered from `contracts/agents/tools.json`.
- **User guides**: `sources.mjs` writes each guide to
  `src/content/docs/docs/guides/<slug>.md`, a generated and ignored path, as a build
  artifact rather than a committed second copy (FR-012). Its front matter becomes
  `title`, `description` (the summary), `help_revision` and `requires` (from
  `required_capabilities`). It rewrites `/help/<slug>` links to `/docs/guides/<slug>/`.
  Starlight's autogenerated sidebar groups by folder, not front matter. So
  `astro.config.mjs` builds one sidebar group per guide `section` from `meta.json`,
  keeping URLs flat.
- **Feature gating**: the docs collection drops `adapters/` and `agents/` folders
  whose switch is off, using glob negation. PR 1 first checks that Starlight's
  `docsLoader` accepts a glob pattern. If it doesn't, the collection uses Astro's
  `glob({ base, pattern })` loader with `docsSchema`, which Starlight supports for
  custom loaders.
- **Fail closed**: any unknown front matter field, unresolved `$ref` or missing
  guide fails the build (US3 scenario 2).

**Alternatives considered**: Scalar or Redoc embedded as one client-side page. These
are not in the Pagefind index, don't work without JavaScript and are styled apart
from the kit. Hand-copying the reference was rejected because it would drift.

## R6. Design system on a static site

**Decision**:
- `src/styles/docs.css` imports `@iot-os/ui/globals.css`. `src/styles/starlight.css`
  maps Starlight's `--sl-color-*` and font variables onto the kit tokens, so the docs
  and the portal share one palette in light and dark.
- Docs-specific pieces (event tables, the agent tools table, the guide revision line)
  are small `.astro` components using kit tokens and the named type scale.
  Interactive controls, if any, are kit React components in islands.
- `check-ui.mjs` gains `.astro` in its file filter, and the docs' `lint` runs it on
  `apps/docs/src`.

**Rationale**: with the marketing pages gone, there are no hero or feature-grid
components to justify. The docs compose Starlight and kit tokens, and the guardrail
keeps raw palette colours and arbitrary sizes out.

**For the website repository**: `@iot-os/ui` isn't published, so the website copies
the kit's colour and type variables rather than importing the package.

## R7. Build checks

**Decision**: `apps/docs/scripts/check-docs.mjs` runs after `astro build` and
fails the build on any of these:

- **literals**: a configured value appears in `src/` outside `docs.config.ts`. CI
  provides the real values as variables and secrets, so this check also proves they
  are not committed (FR-004, FR-005).
- **rename**: a build with a different product name still contains the default name
  (SC-005).
- **names**: built text contains a name from the private denylist (CI secret
  `DOCS_DENYLIST`, or `.local/docs/denylist.txt` locally) (FR-007).
- **features**: no built page links to a docs route excluded by a feature switch or
  by `draft` (FR-006).
- **reference**: the generated API pages match the filtered contract's operations
  one to one, each shows its "Requires" and "Rate limits" lines, the events page
  lists exactly the contract's `IntegrationEventType` values, and nothing in `dist`
  contains the hosted commit (FR-010, SC-003).
- **changelog**: entries exist for the hosted contract's `info.version` and the
  SDK's version. The operations and event types in `meta.json` must also equal the
  committed `changelog-baseline.json`. A difference fails until the pull request adds
  a changelog entry and refreshes the baseline (`check-docs changelog --update`), so
  an event type added within v1 without a version change still gets an entry
  (FR-016).

Links are checked by `starlight-links-validator`. Accessibility is checked with
Playwright and `@axe-core/playwright` on every route in the sitemap, waiting for
`document.getAnimations()` to settle so colour fades don't cause flaky contrast
failures. Performance is checked by Lighthouse CI on representative docs pages
(the index, a quickstart, a generated API page and a user guide) with the mobile
preset, asserting LCP ≤ 2,000 ms (SC-004).

Privacy is checked by a Playwright spec on every sitemap route: no `Set-Cookie`
header, an empty `document.cookie` and no request to another origin. The kit's fonts
come from `@fontsource` packages and are bundled, so they pass (FR-008).

Starlight generates the sitemap when `site` is set, so the axe and privacy specs read
their route list from `sitemap-index.xml`.

## R8. Running the samples

**Decision**:
- Developer samples live as real files in `apps/docs/samples/developer/` and are
  shown with Starlight's `<Code>` from a `?raw` import, so the page shows exactly
  the file that runs.
- `tooling/verify-website-samples.mjs` runs them against the fixture made by
  `tooling/verify-integration-sdk.php`, and `tooling/test-devices.mjs` adds it to
  `./taskw devices:test` (FR-015).
- The hardware path runs the downloadable simulator kit with a real connection kit
  in the same suite.
- CI type-checks and syntax-checks the samples. It can't run them because it has no
  live stack, the same limit as `studio.spec.ts` and the devices suite today. FR-015
  makes up for that with a gate in the CI `docs` job: a pull request that changes
  `apps/docs/samples/`, `packages/integration-sdk/` or the integration API
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
`rgb-light`. PR 2's first task proves which onboarding path works, before any page is
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

**Docs (revised)**: the docs set no cookies and load no analytics or third-party
scripts. GitHub Pages, as the host, processes request logs. The marketing site's
privacy notice should mention that the docs are hosted there.

**Website (moved to the website repository; decision of 2026-10-17)**: no client-side
analytics, cookies or third-party scripts; traffic figures come from Cloudflare's
server-side zone analytics. The privacy notice names
the processor (Cloudflare: hosting, inquiry storage and email delivery), what the
form collects and why, retention (30 days delivered, 90 days failed) and a contact
for requests. The company supplies the final text, and engineering supplies those
facts.

## R11. Cutover (moved to the website repository)

**Decision (2026-10-17)**:
1. Move the zone to Cloudflare, with records copied and checked.
2. Deploy and review on a preview URL.
3. Route the apex and `www` to the Worker.
4. Keep the old server running for 30 days, and record the old address in the
   private operations inventory, not here.

Rollback is one DNS change. URLs keep their current paths where the content carries
over (`/platform`, `/solutions`, `/solutions/factory`, `/solutions/carbonops`,
`/solutions/water`, `/contact`), so most need no redirect. Only renamed pages get
one, for example `/scan` → `/assessment`.

## R12. ADRs

**Revised 2026-10-18**: **ADR-021** amends ADR-020. The marketing website moves to
its own repository, and the developer docs stay here in `apps/docs`, published to
GitHub Pages. The constitution's stack line changes accordingly (1.0.4).

**Decision (2026-10-17)**: add **ADR-020, Public website and developer docs outside the product**:
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
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Netlify pricing update, April 2026](https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/) and [spam filters](https://docs.netlify.com/manage/forms/spam-filters/)
