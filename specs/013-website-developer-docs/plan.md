# Implementation Plan: Marketing Website and Developer Documentation

**Branch**: `spec/013-website-developer-docs` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-website-developer-docs/spec.md`

## Summary

A new workspace, `apps/website`, holds the site: one static Astro project with
marketing pages at the root and Starlight docs at `/docs`. It uses the `@iot-os/ui`
tokens, type scale and controls. It is deployed to Cloudflare as a Worker's static
assets, independent of the hosted platform.

The only server code is a small Worker for `POST /api/inquiry`. It stores each
inquiry in D1 before emailing it to the team, and retries until it is delivered.

The docs combine hand-written guides with reference generated at build time. The
generated parts come from the commit the hosted service runs. That commit is a CI
secret (and a `.local/` value for local builds), so the public repository never shows
it. Only the hosted feature switches are committed, in
`apps/website/hosted-release.json`. The generated parts are:
- the integration API and events from the OpenAPI contract
- agent tools from the tool catalogue
- user guides from the in-product help

Build checks enforce the spec's honesty rules: configured values never written
literally, no private names, claims linked or reviewed, no switched-off features,
redirects that resolve. The integration SDK is published to npm so the developer
quickstart can tell people to install it.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 22.23 (`.nvmrc`). Astro 7.x, Starlight
0.42.x, React 19 islands. The Worker runs on the Cloudflare Workers runtime.

**Primary Dependencies**:
- Astro, `@astrojs/starlight`, `@astrojs/react`, `@astrojs/sitemap`,
  `@tailwindcss/vite` 4
- `starlight-openapi`, `starlight-links-validator`
- `@iot-os/ui` (workspace)
- `wrangler` (development dependency): local Worker, D1 and deploys

**Storage**: Cloudflare D1, one `inquiries` table, owned by the website Worker. No
platform database is touched.

**Testing**:
- Vitest for `scripts/` and the Worker, using `@cloudflare/vitest-pool-workers` with
  local D1 and a captured `send_email`
- Playwright with `@axe-core/playwright` against `astro preview` and `wrangler dev`
- Lighthouse CI (mobile preset)
- `check-site.mjs`
- `./taskw devices:test` for the samples against the local stack

**Target Platform**: evergreen browsers at 320 px and up, with JavaScript optional
except for search and the form; Cloudflare Workers.

**Project Type**: static website with one edge function, in the existing pnpm and
Turbo monorepo.

**Performance Goals**: LCP ≤ 2,000 ms on Lighthouse's mobile preset for marketing
pages (SC-004). No JavaScript on pages without islands.

**Constraints**:
- Public repository: real domains, the team address and the names denylist arrive
  as CI secrets or environment variables, never as commits. For local builds they
  live in `.local/website/website.env` and `.local/website/denylist.txt`, never in the
  app folder (constitution: private environment files live under `.local/`).
- The hosted commit never appears in the repository, in workflow logs or in built
  pages ([R4](research.md#r4-docs-follow-the-hosted-release)).
- No cookies or third-party scripts.
- Docs generated only from the hosted commit.

**Scale/Scope**:
- about 12 marketing pages and 30 hand-written docs pages
- 27 generated user guides, 16 API paths, 8 event types and the agent tools
- 1 Worker endpoint, 1 D1 table, 1 new CI job, 2 new workflows (site deploy, SDK
  publish)

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. The site never calls the platform. The Worker handles only inquiries, the company's own sales data, not tenant data or a product API. The product's clients are unchanged. |
| II. Immutable versions | Pass. Nothing versioned is touched. The docs pin to the hosted commit through the hosted release record. |
| III. Tenant isolation | Pass. No tenant data is read or shown. Docs are not personalised and explain where each value is found in the portal. |
| IV. Contracts first | Pass. The reference is generated from `contracts/openapi` at the hosted commit and fails closed. The inquiry body crosses a process boundary, so it gets `contracts/website/inquiry.v1.schema.json` with fixtures, validated by both the form and the Worker tests. No public HTTP API changes, so `packages/api-client` is unchanged. |
| V. AI proposes | Pass. No AI features. The agent docs describe proposals and the never-live-actions rule as built. |
| VI. Show uncertainty | Pass. Claims link to docs or a reviewed list. Switched-off and unreleased features are not published. A failed generation leaves the previous version online. |
| VII. Durable messaging | Pass. Inquiries are stored first, deduplicated by a client UUID, retried with backoff, marked `failed` after 24 hours without being deleted, and purged on a fixed schedule. |
| VIII. One design system | Pass with justification. Kit tokens, type scale and controls throughout, and `check-ui` extended to `.astro` and run on the site. Marketing layout components stay site-local; see Complexity Tracking. |
| IX. Verified where it runs | Pass. No container changes. Each change is checked in `wrangler dev` (the built site with the Worker, local D1 and captured email), then on the pull request's preview URL before production. Samples run against the rebuilt local stack in `./taskw devices:test`. |

**Pull request gates**: every implementation pull request updates the lasting docs
for the behaviour it adds, so nothing depends on `specs/` after the freeze:
- `docs/dev/website.md`, created in PR 1 (local development, checks, writing rules)
  and extended in PRs 2, 4, 5 and 7
- `docs/ops/website.md`, created in PR 2 (inquiry delivery) and extended in PR 3
  (deploy, cutover, rollback, hosted commit)
- `docs/ops/release.md` and `docs/features/integrations.md` for the SDK in PR 6

**Engineering constraints**: the site adds Astro and Cloudflare to the stack and the
repository's first continuous deployment, so **ADR-020** records it ([R12](research.md#r12-adr))
and the constitution's stack line gains the site in the same pull request (PATCH
bump). Secrets stay out of git:
- the Cloudflare token, team address, hosted commit and denylist are GitHub Actions
  secrets, and real domains are Actions variables
- locally, all of them live in `.local/website/`

**Post-design re-check**: unchanged. The design adds no tenant data path, no
platform API and no product container.

## Design

### Workspace and configuration

- **`apps/website`** (`@iot-os/website`) joins the pnpm workspace and Turbo with
  `dev`, `build`, `lint` (`astro check`, `check-ui` on `src`, `check-site`) and
  `test` scripts. In PR 1, `build` is `astro build` followed by the checks that exist
  so far. PR 4 puts `sources.mjs` in front of it.
- **`site.config.ts`**: the only place for the product name, company name,
  marketing and docs URLs, portal URL, API base URL, broker host, contact address and
  social links. Each value reads a `PUBLIC_SITE_*` variable and defaults to an
  `example.com` placeholder, so pull requests from forks build and real values exist
  only in the deploy environment ([contract](contracts/site-config.md)). For local
  builds, `site.config.ts` loads `.local/website/website.env` with
  `process.loadEnvFile` when that file exists.
- **Hosted release record**:
  - the committed `apps/website/hosted-release.json` holds only `schema_version`,
    `features.adapters` and `features.agent_access`
    ([schema](contracts/hosted-release.schema.json))
  - the commit comes from `WEBSITE_HOSTED_REF`: an Actions secret in CI, so it is
    masked in public logs, and `.local/website/website.env` locally
  - no script prints it and nothing in `dist` contains it
  - `content.config.ts` excludes `docs/**/adapters/**` and `docs/**/agents/**` when
    their switch is off. PR 4 first checks that Starlight's `docsLoader` accepts a
    glob pattern; if it doesn't, the collection uses Astro's `glob()` loader with
    `docsSchema`
- **`scripts/sources.mjs`** (first step of `build` from PR 4): `git archive` from the
  hosted commit into `.sources/`. It then generates:
  - the filtered integration contract. Each operation's `x-abilities` and
    `x-rate-limits` are written into its description as "Requires" and "Rate limits"
    lines, because the OpenAPI plugin does not render vendor extensions (FR-013)
  - the user guide pages under `src/content/docs/docs/guides/` (ignored). Starlight
    routes follow the content path, so docs live in a `docs/` subfolder to be served
    at `/docs`
  - the simulator kit zip in `public/downloads/`
  - `.sources/meta.json` with the contract's `info.version`, the SDK version, the
    integration operations (method and path), the event types and the guide sections.
    It never includes the commit
- `.gitignore` gains `apps/website/.sources/`, the generated guides directory and
  `apps/website/.wrangler/`.

### Marketing pages (US1)

Routes in `src/pages/`:
- `/`
- `/platform`
- `/engineers/hardware` and `/engineers/product`
- `/leaders`
- `/solutions` with `/solutions/factory`, `/solutions/carbonops` and
  `/solutions/water`
- `/assessment`
- `/security`
- `/contact`
- `/privacy`
- `404`

Shared pieces:
- **Layout**: `MarketingLayout.astro` provides the header (logo, audience links,
  Docs, **Sign in**, **Request a demo**), the footer and the theme from
  `prefers-color-scheme`.
- **Sections**: site-local `.astro` components (`Hero`, `FeatureGrid`,
  `AudienceCard`, `Steps`, `ProtocolTable`, `CtaBand`) using kit tokens and the type
  scale.
- **Claims**: `<Claim doc="/docs/…">` or `<Claim id="…">` wraps every capability
  statement. Ids resolve in `src/claims.yaml` with `source`, `reviewed_by` and
  `reviewed_on`. Outcome figures carried over from the current site go in only with
  a recorded source; otherwise they are cut.
- **Protocols**: `ProtocolTable` states Sparkplug B (native), vendor MQTT
  (adapters, shown only when that feature is on) and Modbus, OPC-UA and BACnet
  ("through a Sparkplug-capable edge gateway").
- **Islands**: `InquiryForm` (the kit's form fields from `form-fields.tsx`, plus
  `RadioGroup` and `Button`) and `MobileMenu` (kit `Sheet`). The form preselects the type from
  `?type=` and records the source page. A plain HTML fallback shows the contact
  address when scripts are off.

### Inquiry Worker (US1, FR-007)

- **Code**: `worker/index.ts` with `routes/inquiry.ts` and `scheduled.ts`.
- **Configuration**: `wrangler.jsonc` sets `assets.directory: "./dist"`,
  `run_worker_first: ["/api/*"]`, a D1 binding `DB`, a Rate Limiting binding
  `INQUIRY_LIMIT` (5 per 60 s per address), a `send_email` binding `TEAM_MAIL`
  restricted to `destination_address`, and a cron of `*/5 * * * *`.
- **Behaviour** ([contract](contracts/inquiry-api.md), [data model](data-model.md#inquiry)):
  - validate the body, then run the bot checks
  - the rate limit answers 429
  - insert-or-ignore by `id`, answer 202
  - deliver through `ctx.waitUntil`
  - the cron retries pending rows with backoff (5 min, 15 min, 1 h, then hourly)
    and marks `failed` after 24 hours
  - it purges delivered rows after 30 days and failed rows after 90
- **Migrations**: `worker/migrations/0001_inquiries.sql` is applied by
  `wrangler d1 migrations apply`.
- **Mail**: plain text, subject `[<type>] <company>: <name>`, every field plus the
  source page and received time. The visitor's email goes in `Reply-To`, so the team
  replies directly. The sender is a fixed address on the marketing domain.
- **Logs**: no personal data in Worker logs. Only `id`, status and error class.

### Docs (US2, US3, US4)

Sidebar, in `astro.config.mjs`:

| Section | Pages |
| --- | --- |
| Get started | Overview; Connect your first device; Build your first integration |
| Concepts | Organizations and roles; Devices and profiles; Sources, connections and gateways; Measurements and quality; Commands; Alerts; Automation; Dashboards |
| Hardware | Sparkplug B reference; Connection kits and TLS; Gateways and downstream devices; Reference firmware; Vendor MQTT through adapters (gated) |
| Developers | Applications, abilities and tokens; Integration API reference (generated); Events and the event feed (generated); Webhooks; SDK; Rate limits and errors; AI agents (gated) |
| User guides | 27 generated pages, grouped by their `section` (groups built in `astro.config.mjs` from `meta.json`, so URLs stay `/docs/guides/<slug>/`) |
| Changelog | Integration API, event types, SDK |

- **Hardware quickstart**: uses the simulator kit (the three files from
  `tooling/simulators` plus a README). The simulator births two downstream devices,
  so the quickstart uses two starter profiles: "Simulated meter" for readings, and
  "Simulated light" with controllable Power, Color, Mode and Brightness for the
  confirmed command. PR 5 proves the onboarding path before the page is written
  ([R8](research.md#r8-running-the-samples)).
- **Sparkplug reference**: written from `services/runtime/internal/sparkplug` and
  `docs/reference/sparkplug.md`, with a test checklist of each requirement and
  rejection.
- **Developer quickstart and SDK pages**: show `samples/developer/*.mjs`. They stay
  `draft: true` until the SDK is on npm (FR-024).
- **Footer**: every docs page gets **Report a problem with this page**, linking to
  `/contact?type=question&page=<path>` (FR-020).
- **Starlight theme**: `src/styles/starlight.css` maps Starlight's variables onto
  the kit tokens. A `Header` override keeps the marketing links and adds **Sign in**
  and **Request a demo**, so FR-002 holds on docs pages too.

### Checks and CI

- **`check-site.mjs`**: `literals`, `rename`, `names`, `claims`, `features`,
  `reference`, `changelog`, `redirects` and `drafts` ([R7](research.md#r7-build-checks)).
  `rename` is described in the [site configuration contract](contracts/site-config.md).
  - `reference` checks that the generated API pages match the filtered contract's
    operations one to one, that each page shows its abilities and rate limits, and
    that the events page lists exactly the contract's event types (SC-003)
  - `changelog` compares the operations and event types in `meta.json` with the
    committed `apps/website/changelog-baseline.json`. A difference fails until the
    pull request adds a changelog entry and refreshes the baseline with
    `check-site changelog --update`. This also catches a version that didn't change
- **Playwright `privacy.spec.ts`**: on every sitemap route, no `Set-Cookie`, an empty
  `document.cookie` and no request to another origin (FR-008).
- **CI job `website`** in `.github/workflows/ci.yml`:
  1. install, with `fetch-depth: 0`
  2. `lint` (astro check, check-ui, check-site)
  3. unit and Worker tests
  4. `build`, with `sources` from PR 4
  5. Playwright smoke, axe and privacy over the sitemap
  6. Lighthouse CI on the marketing routes
  7. sample syntax and type check
  8. the samples gate: if the pull request changes `apps/website/samples/`,
     `packages/integration-sdk/` or the integration API, its description must
     record a `./taskw devices:test` run (FR-018)

  Forks get placeholders and no secrets. Their builds read sources from the working
  tree, and the `literals` and `names` checks run against placeholder values only.
- **`.github/workflows/website-deploy.yml`**:
  - on pull requests touching the site: `wrangler versions upload`, with the preview
    URL posted as a check
  - on `main`: build with production variables, apply D1 migrations, then
    `wrangler deploy`
  - on manual dispatch: redeploy the current `main`, for example after a hosted
    deploy updates `WEBSITE_HOSTED_REF`

  Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WEBSITE_TEAM_ADDRESS`,
  `WEBSITE_D1_DATABASE_ID`, `WEBSITE_HOSTED_REF`, `WEBSITE_DENYLIST`. Variables:
  `PUBLIC_SITE_*`. Third-party actions are pinned by
  commit SHA, as in the existing workflows.
- **`tooling/docs/check_links.py`** skips `apps/website/src/content/`. Those links
  are site routes, checked by `starlight-links-validator`.

### SDK publishing (FR-024)

- **Package**: `packages/integration-sdk/package.json` gains `license`,
  `repository`, `homepage` and `publishConfig.provenance`, plus a `LICENSE` file.
  The README replaces "not published" with `npm install` and the docs link.
- **Workflow**: `.github/workflows/sdk-publish.yml` runs on `sdk-v*` tags. It builds
  and tests the SDK, checks that the tag matches `version`, and publishes with npm
  trusted publishing.
- **Owner decisions first**: the scope and name, and MIT or Apache-2.0
  ([R9](research.md#r9-publishing-the-sdk)).

### Cutover (US5)

- **Redirects**: `src/redirects.ts` lists the current site's paths. Same-path pages
  need no entry; renamed ones get a 301 (`/scan` → `/assessment`). The build writes
  `dist/_redirects`.
- **Host redirect**: `www` to the apex is a zone Redirect Rule, set in the runbook.
- **Runbook**: `docs/ops/website.md` starts in PR 2 with the inquiry delivery check
  (`wrangler d1 execute … "select status, count(*)"`) and failed inquiries. PR 3 adds
  secrets, deploy, the hosted commit update, DNS cutover and rollback. Concrete hosts
  and addresses stay in the private operations inventory.

## Pull requests

Each one is opened from `main` after the previous one merges. **They are not
stacked.**

0. **Spec, plan and tasks** (this branch), with ADR-020 and the constitution stack
   line. Documents only.
1. **Site foundation and marketing pages** (US1 without the form):
   - workspace, `site.config.ts` (reading `.local/website/website.env`), sitemap and
     styles
   - the committed feature switches in `hosted-release.json`
   - marketing routes and claims
   - `check-site.mjs` (`literals`, `rename`, `names`, `claims`, `redirects`)
   - `check-ui` reading `.astro`
   - the CI `website` job with axe, privacy and Lighthouse
   - `docs/dev/website.md`, and AGENTS.md and `docs/README.md` repository map rows
2. **Inquiry endpoint**:
   - the inquiry contract and fixtures, the Worker, the D1 migration
   - `wrangler.jsonc` for local development, the form island, Worker tests
   - `wrangler dev` verification, and the privacy notice facts
   - `docs/ops/website.md` (inquiry delivery) and the Worker section of
     `docs/dev/website.md`
3. **Deploy and cutover tooling**: the deploy-time Wrangler configuration,
   `website-deploy.yml`, `_redirects` generation, and the deploy and cutover sections
   of `docs/ops/website.md`. **This makes the marketing site deployable.** Cutover
   happens after the owner actions below.
4. **Docs foundation and generated reference** (US4, half of US3):
   - Starlight with the docs header, the `WEBSITE_HOSTED_REF` secret and `sources.mjs`
   - the API, events and agent-tools reference and the user guides
   - the changelog and its baseline, and the `features`, `reference`, `changelog` and
     `drafts` checks
   - the links validator, and the `check_links.py` exclusion
   - the docs section of `docs/dev/website.md`
5. **Hardware docs** (US2): the quickstart, the Sparkplug reference, the gateway,
   connection kit, firmware and gated adapter guides, the simulator kit download, the
   simulator path in `./taskw devices:test`, and the kit section of
   `docs/dev/website.md`.
6. **SDK publishing** (FR-024): package metadata, `LICENSE`, the publish workflow,
   and the SDK release steps in `docs/ops/release.md` and
   `docs/features/integrations.md`, after the owner's scope and license decision.
   Independent of 1–5.
7. **Developer docs** (US3): the quickstart, applications and tokens, webhooks, SDK
   pages, rate limits and errors, gated agent docs, the `samples/developer` files,
   `tooling/verify-website-samples.mjs` in the devices suite, the CI samples gate, and
   the samples section of `docs/dev/website.md`. The quickstart leaves draft once 6
   has published.

The roadmap's OpenAPI item ("publish the reference") is marked delivered for the
integration API by PR 4.

## Owner actions

- **Cloudflare**: an account, the marketing domain's zone moved to Cloudflare, Email
  Routing on with the team address verified, and an API token scoped to Workers, D1
  and the zone.
- **Team inquiry address**, plus whether the confirmation should promise a reply
  time (for example "within one working day").
- **SDK**: npm organization, scope and name, and MIT or Apache-2.0.
- **Privacy notice** text, using the facts in [R10](research.md#r10-privacy-and-analytics).
- **Claims review**: keep or drop each outcome figure from the current site, with
  its source.
- **Hosted release**: whether adapters and agent access are on in the hosted
  service, which sets the first `hosted-release.json`. Also the hosted commit, set as
  the `WEBSITE_HOSTED_REF` secret and in `.local/website/website.env`, and updated
  after each hosted deploy.
- **Names denylist** for the `names` check, kept as a GitHub secret.

## Project Structure

### Documentation (this feature)

```text
specs/013-website-developer-docs/
├── spec.md
├── plan.md                  # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── inquiry-api.md
│   ├── site-config.md
│   ├── hosted-release.schema.json
│   └── content.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source code (repository root)

```text
apps/website/
├── astro.config.mjs         # Starlight at /docs, React, Tailwind, OpenAPI, links validator
├── wrangler.jsonc           # assets, run_worker_first, D1, rate limit, send_email, cron
├── site.config.ts           # the only home of names, domains and addresses
├── hosted-release.json      # hosted feature switches (the commit is the WEBSITE_HOSTED_REF secret)
├── changelog-baseline.json  # operations and event types as of the last changelog entry
├── public/downloads/        # simulator kit (generated at build)
├── samples/developer/       # runnable quickstart and SDK samples
├── scripts/
│   ├── sources.mjs          # git archive from the hosted ref, generate reference inputs
│   └── check-site.mjs       # literals, rename, names, claims, features, reference, changelog, redirects, drafts
├── src/
│   ├── claims.yaml
│   ├── redirects.ts
│   ├── content.config.ts
│   ├── content/docs/docs/   # hand-written docs served at /docs (guides/ is generated, ignored)
│   ├── components/          # site-local Astro sections, Claim, ProtocolTable, EventTypes, AgentTools
│   ├── islands/             # InquiryForm, MobileMenu (React, @iot-os/ui)
│   ├── layouts/MarketingLayout.astro
│   ├── pages/               # marketing routes, 404
│   └── styles/              # site.css (kit globals), starlight.css (token mapping)
├── worker/
│   ├── index.ts
│   ├── routes/inquiry.ts
│   ├── scheduled.ts
│   └── migrations/0001_inquiries.sql
└── tests/                   # Vitest (scripts, Worker), Playwright (smoke, axe, privacy)

contracts/website/inquiry.v1.schema.json (+ fixtures)
packages/integration-sdk/    # license, metadata, README
packages/ui/scripts/check-ui.mjs   # also reads .astro
tooling/verify-website-samples.mjs
.github/workflows/{ci.yml, website-deploy.yml, sdk-publish.yml}
docs/adr/ADR-020-public-website.md, docs/dev/website.md, docs/ops/website.md
.local/website/website.env, .local/website/denylist.txt   # ignored, local only
```

**Structure Decision**: one new app in the existing `apps/*` workspace. The Worker
sits beside the site it serves, because it shares the deploy and nothing else uses
it. Shared inputs stay where they live today (`contracts/`,
`apps/api/resources/help`, `tooling/simulators`) and are read at the hosted commit,
never copied into the repository.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Site-local presentational components (Principle VIII expects UI to compose kit components and every kit component to have a story) | Marketing sections such as a hero or feature grid have no product use; putting them in `@iot-os/ui` would grow the kit with components the portal and admin never use | Building marketing pages only from kit `Panel`s makes the site look like an admin screen; the guardrail still holds because the sections use kit tokens and the type scale, `check-ui` scans `.astro`, and every control is a kit component |
