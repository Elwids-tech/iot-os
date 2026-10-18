---

description: "Task list for the marketing website and developer documentation (spec 013)"
---

# Tasks: Marketing Website and Developer Documentation

**Input**: Design documents from `/specs/013-website-developer-docs/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. SC-003, SC-004, SC-006 and SC-007 are automated checks, the
inquiry endpoint carries a contract (constitution IV), and the honesty rules are
enforced by `check-site.mjs`. Test tasks are part of each story.

**Organization**: Tasks are grouped by user story. Each group names the pull request
(PR 0 to PR 7, plan.md "Pull requests") that carries it. Phases follow delivery
order, not story priority:

- US5 (deploy and cutover tooling) comes before the docs stories, so the marketing
  site can go live without the docs.
- FR-024 (publishing the SDK) belongs to US3 but is its own pull request, PR 6. It
  doesn't depend on the site.

Every pull request is opened from `main` after the previous one merges. **None are
stacked.**

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1 to US5)
- Paths are repository-relative. Site paths are under `apps/website/`.

## Before starting

Owner decisions and actions (plan.md "Owner actions"), and the tasks that wait for
each:

- Hosted feature switches (adapters, agent access): T013
- Hosted commit, as the `WEBSITE_HOSTED_REF` secret and in `.local/website/website.env`: T077
- Outcome figures to keep, with their sources: T027, T032
- Confirmation wording (reply time): T050
- Privacy notice text: T053
- Cloudflare account, zone moved, Email Routing with the team address verified, API
  token: T056, T060, T061
- Names denylist secret: T019
- SDK npm scope and name, and the license (MIT or Apache-2.0): T090 to T095

---

## Phase 0: Plan acceptance (PR 0)

**Purpose**: The documents-only pull request. Merging it accepts the spec, the plan,
ADR-020 and the constitution amendment (docs/dev/specs.md).

- [x] T001 Write docs/adr/ADR-020-public-website.md, following the format of docs/adr/ADR-019-mosquitto-only-broker.md:
  - **Header**: Status Accepted, Date 2026-10-17, Relates to ADR-001, ADR-007, ADR-012 and ADR-016.
  - **Context**: no public site or docs for outside engineers; the current marketing site targets business buyers only; the product is sold as a hosted service.
  - **Decision**:
    - one static Astro and Starlight site in `apps/website`, with marketing pages at the root and docs at `/docs`
    - deployed to Cloudflare as Worker static assets by its own workflow, the repository's first continuous deployment, for the site only
    - one Worker route for inquiries, stored in D1 and emailed to the team
    - generated reference built from the hosted commit. The commit is kept out of the public repository (an Actions secret, and `.local/website/website.env` locally), and only the hosted feature switches are committed, in `apps/website/hosted-release.json`
    - names and hosts from deploy-time configuration
    - no call to the platform
  - **Consequences**: a new vendor, deploy secrets and a DNS zone on Cloudflare; site deploys independent of platform releases; the hosted commit secret is updated after each hosted deploy; and lasting rules live in docs/dev/website.md and docs/ops/website.md.
  - **Alternatives**: link specs/013-website-developer-docs/research.md R1 to R3.
  - State that ADR-001 is unchanged: the customer and administration apps stay React SPAs, and the site's interactive parts are React islands using `@iot-os/ui`.
- [x] T002 [P] Add the ADR-020 row ("Public website and developer docs: static Astro site on Cloudflare, outside the product's deployment profiles", Accepted) to the table in docs/adr/README.md
- [x] T003 [P] Amend the **Stack** bullet under "Engineering Constraints" in .specify/memory/constitution.md: append "; the public website and developer docs are a static Astro and Starlight site deployed to Cloudflare (ADR-020)". Bump the version line from 1.0.2 to 1.0.3 (PATCH: an engineering constraint gains an entry and no principle changes), keeping Ratified 2026-10-11 and Last Amended 2026-10-17
- [x] T004 Run `python3 tooling/docs/check_links.py` (must pass, and ADR-020 must be reachable from docs/README.md through docs/adr/README.md). Then open the documents-only pull request from `main` with the files below. Its description lists the owner actions from plan.md:
  - specs/013-website-developer-docs/ (spec, checklist, plan, research, data model, contracts, quickstart, tasks)
  - docs/adr/ADR-020-public-website.md and docs/adr/README.md
  - .specify/memory/constitution.md

---

## Phase 1: Setup (PR 1)

**Purpose**: The workspace and its tooling

- [ ] T005 Create apps/website/package.json for `@iot-os/website`:
  - `private: true`, `type: module`
  - scripts: `dev`, `build` (`astro build && node scripts/check-site.mjs all`; T062 puts `node scripts/sources.mjs` in front in PR 4), `preview`, `lint` (`astro check && node ../../packages/ui/scripts/check-ui.mjs src && node scripts/check-site.mjs literals`), `test` (vitest run), `test:e2e` (playwright test)
  - dependencies: `astro` 7.x, `@astrojs/react`, `@astrojs/sitemap`, `react` and `react-dom` ^19.2.0, `@tailwindcss/vite` and `tailwindcss` ^4.1.17 (match apps/portal/package.json), `@iot-os/ui` `workspace:*`. Starlight and its plugins come in T065
  - devDependencies: `typescript` ~5.9.3, `@astrojs/check`, `vitest`, `@playwright/test` ^1.62.1, `@axe-core/playwright` ^4.10.2, `@lhci/cli`, `wrangler`, `@cloudflare/vitest-pool-workers`, `ajv`, `ajv-formats`, `yaml`

  Run `pnpm install` and commit pnpm-lock.yaml.
- [ ] T006 [P] Create apps/website/tsconfig.json (extends `astro/tsconfigs/strict`, `jsx: react-jsx`, includes `src`, `scripts`, `worker`, `tests`, `samples`) and apps/website/src/env.d.ts
- [ ] T007 [P] Create apps/website/astro.config.mjs with `site` from site.config.ts `siteUrl`, `output: 'static'`, `integrations: [react(), sitemap()]` and `vite.plugins: [tailwindcss()]`. The sitemap gives the axe and privacy specs their route list from PR 1. Starlight is added in T065
- [ ] T008 [P] Add to .gitignore: `apps/website/.sources/`, `apps/website/src/content/docs/docs/guides/`, `apps/website/public/downloads/`, `apps/website/.wrangler/`, `apps/website/dist/`, `apps/website/.lighthouseci/`, plus `apps/website/.env*` and `apps/website/.dev.vars` as a safety net. Real local values live in `.local/website/`, which is already ignored
- [ ] T009 [P] Confirm turbo.json caches `apps/website/dist/**` for `build`, adding per-package outputs if the root pipeline doesn't. Confirm `pnpm --filter @iot-os/website build` runs from the root
- [ ] T010 [P] Add an `apps/website` row to the repository map in AGENTS.md and in docs/README.md: "Public marketing site and developer docs (Astro, Starlight); deployed to Cloudflare, ADR-020"

---

## Phase 2: Foundational (PR 1)

**Purpose**: Configuration, styles, layout and guardrails that every page needs

**⚠️ CRITICAL**: No story work starts until this phase is complete

- [ ] T011 Create apps/website/site.config.ts exactly as contracts/site-config.md lists:
  - keys `productName`, `companyName`, `siteUrl`, `docsUrl`, `portalUrl`, `apiBaseUrl`, `brokerHost`, `contactAddress`
  - before reading, load `.local/website/website.env` (resolved from the repository root) with `process.loadEnvFile` when the file exists
  - each reads its `PUBLIC_SITE_*` variable, with the placeholder defaults from the contract
  - throw at build time when a URL is not absolute `https`, `brokerHost` is not a bare hostname, or `contactAddress` is not an email address
- [ ] T012 [P] Create apps/website/src/styles/site.css: `@import "tailwindcss"`, `@import "@iot-os/ui/globals.css"`, and `@source` lines for `src/**` and `../../packages/ui/src/**`, so kit classes used by islands are generated
- [ ] T013 Create apps/website/hosted-release.json and its loader:
  - `schema_version: "hosted-release.v1"` and `features.adapters` / `features.agent_access` from the owner. No commit SHA: the hosted commit is a secret (T077)
  - copy specs/013-website-developer-docs/contracts/hosted-release.schema.json to apps/website/schemas/hosted-release.schema.json
  - create apps/website/src/lib/hosted-release.ts, which validates the file with ajv and throws on failure
- [ ] T014 Create apps/website/src/layouts/MarketingLayout.astro:
  - **Header**: skip link; product name from config; links to `/engineers/hardware`, `/engineers/product`, `/leaders`, `/solutions` and `/docs/`; **Sign in** → `portalUrl`; **Request a demo** → `/contact?type=demo`, visible without scrolling at 1440 px
  - **Footer**: company name, contact address, `/privacy`, `/security`
  - **Head**: `<title>`, description, canonical URL and Open Graph from props
  - **Theme**: light and dark from `prefers-color-scheme` using kit tokens
  - **Scripts**: none except hydrated islands
- [ ] T015 [P] Create apps/website/src/islands/MobileMenu.tsx with the kit `Sheet` from `@iot-os/ui/components/sheet`, holding the header links plus Sign in and Request a demo. Mount it in MarketingLayout with `client:media="(max-width: 767px)"`
- [ ] T016 [P] Extend packages/ui/scripts/check-ui.mjs so its file filter also reads `.astro` files, and update the usage comment. Run `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint` to confirm no new findings
- [ ] T017 Create apps/website/scripts/check-site.mjs with a subcommand registry and `all`, which runs every registered check. Each check exits non-zero with file and line on failure. PR 1 registers `literals`, `rename`, `names`, `claims` and `redirects`; PR 4 adds `features`, `reference`, `changelog` and `drafts` (T072), so `all` never calls a check that doesn't exist yet. Implement `literals` from contracts/site-config.md:
  - every effective config value found in `src/**` outside site.config.ts fails
  - `productName` matches as a whole phrase that is not part of a package specifier (`@iot-os/…`)
- [ ] T018 Implement `rename` in apps/website/scripts/check-site.mjs: run `astro build` into a temporary directory with `PUBLIC_SITE_PRODUCT_NAME="Renamed Product"`, then fail if the default product name appears in any built HTML text (SC-007)
- [ ] T019 [P] Implement `names` in apps/website/scripts/check-site.mjs. It reads newline-separated names from `WEBSITE_DENYLIST`, or from .local/website/denylist.txt when the variable is unset, and matches each one case-insensitively as a whole word in `dist/**/*.html` text and `src/**`:
  - With no list, it warns locally.
  - In CI on `main` it fails.
  - On fork pull requests it skips, with a notice.
- [ ] T020 [P] Write apps/website/tests/check-site.test.ts (Vitest) covering `literals`, `rename` and `names`, with fixture trees under apps/website/tests/fixtures/check-site/
- [ ] T021 [P] Create apps/website/playwright.config.ts (webServer `pnpm preview --port 4321`, projects at 375×812 and 1440×900, each in light and dark `colorScheme`). Create apps/website/tests/e2e/axe.spec.ts: visit every URL in `dist/sitemap-index.xml` (from T007), wait until `document.getAnimations()` is empty, then fail on any serious or critical `@axe-core/playwright` violation
- [ ] T022 [P] Create apps/website/tests/e2e/privacy.spec.ts. For every sitemap URL, it asserts:
  - no response carries a `Set-Cookie` header
  - `document.cookie` is empty after load
  - every request goes to the preview origin, none to another origin (FR-008)
- [ ] T023 [P] Create apps/website/lighthouserc.json: `staticDistDir: ./dist`, the marketing routes, mobile preset, assertion `largest-contentful-paint` ≤ 2000 ms (SC-004)
- [ ] T024 Add a `website` job to .github/workflows/ci.yml, modelled on the `web` job:
  - checkout with `fetch-depth: 0`; Node from `.nvmrc`; pnpm 11.19.0; store cache; `pnpm install --frozen-lockfile`
  - env: `PUBLIC_SITE_*` from repository variables, falling back to the placeholders; `WEBSITE_DENYLIST` from secrets
  - steps: `pnpm --filter @iot-os/website lint`, `test`, `build`, `node scripts/check-site.mjs rename`, `playwright install --with-deps --only-shell chromium`, `test:e2e` (axe, privacy, marketing), `lhci autorun`
  - same SHA-pinned actions as the existing jobs

**Checkpoint**: an empty site builds, lints, passes axe, privacy and Lighthouse, and fails on a planted literal or denylisted name

---

## Phase 3: User Story 1 - Evaluate the platform and request a demo (Priority: P1) 🎯 MVP (PR 1, PR 2)

**Goal**: The marketing pages for all three audiences, with honest claims, and a demo
and assessment form that never drops an inquiry

**Independent Test**: with only the marketing pages built, a tester reaches the form
from every page in one step and submits it. The team receives it with its source
page, and the tester sees a confirmation (quickstart B1, B2).

### Marketing pages (PR 1)

- [ ] T025 [P] [US1] Create site-local sections in apps/website/src/components/marketing/: Hero.astro, FeatureGrid.astro, AudienceCard.astro, Steps.astro and CtaBand.astro. Use only kit tokens and the named type scale (`text-display`, `text-title`, `text-heading`, `text-body`, `text-meta`); `check-ui` must pass
- [ ] T026 [US1] Create apps/website/src/components/Claim.astro with props `doc` (a site route) or `id` (a key in src/claims.yaml), exactly one required. It:
  - renders its slot inside an element carrying `data-claim-doc` or `data-claim-id`
  - throws at build time for an unknown id
  - renders nothing when the claim's `feature` switch is off in hosted-release.json
- [ ] T027 [P] [US1] Create apps/website/src/claims.yaml and apps/website/src/lib/claims.ts, which validates each entry: `text`, `source`, `reviewed_by`, `reviewed_on` (ISO date) required; `feature` optional and one of `adapters` or `agent_access`. Add entries for statements that have no docs page yet. Add outcome figures from the current site only with the source the owner provides
- [ ] T028 [P] [US1] Create apps/website/src/components/marketing/ProtocolTable.astro with three rows:
  - Sparkplug B: native
  - vendor MQTT: through adapters, rendered only when `features.adapters` is true
  - Modbus, OPC-UA and BACnet: "through a Sparkplug-capable edge gateway"

  Each row is wrapped in `<Claim>` (US1 scenario 6).
- [ ] T029 [US1] Create apps/website/src/pages/index.astro: what the platform does; who it is for (operations and business leaders, hardware engineers, product engineers); that it is a hosted service; AudienceCards to each audience page; a link to `/solutions` and `/docs/` (US1 scenario 1)
- [ ] T030 [P] [US1] Create apps/website/src/pages/engineers/hardware.astro, apps/website/src/pages/engineers/product.astro and apps/website/src/pages/leaders.astro. Every capability goes in `<Claim>`, and the product page uses ProtocolTable
- [ ] T031 [P] [US1] Create apps/website/src/pages/platform.astro (how it works: connect, describe, store, act, integrate) and apps/website/src/pages/security.astro (tenant isolation, TLS with per-gateway credentials, AI that proposes and never acts live). Every capability goes in `<Claim>`
- [ ] T032 [P] [US1] Create apps/website/src/pages/solutions/index.astro, solutions/factory.astro, solutions/carbonops.astro and solutions/water.astro, rewritten from the current site's solution pages at the same paths:
  - every capability in `<Claim>`
  - outcome figures only through a `<Claim id>` with a recorded source
  - **Book an assessment** (`/contact?type=assessment`) next to **Request a demo**
- [ ] T033 [P] [US1] Create apps/website/src/pages/assessment.astro (the 30-day assessment offer, with **Book an assessment**) and apps/website/src/pages/404.astro (navigation, a link to `/docs/`, the contact address)
- [ ] T034 [US1] Create apps/website/src/pages/contact.astro (heading, the contact address and a placeholder region for the form island from T051) and apps/website/src/pages/privacy.astro (a structure with a slot for the company's text, filled in T053)
- [ ] T035 [US1] Implement `claims` in apps/website/scripts/check-site.mjs, reading built marketing HTML (all routes outside `/docs/`):
  - every `data-claim-id` exists in claims.yaml with `source`, `reviewed_by` and `reviewed_on`
  - every `data-claim-doc` is a built route
  - text matching `\d+(\.\d+)?\s?%`, a numeric range such as `5–9`, or `\d+x` outside a `data-claim-id` element fails (FR-005)
- [ ] T036 [US1] Create apps/website/src/redirects.ts exporting `currentSitePaths` (`/`, `/platform`, `/solutions`, `/solutions/factory`, `/solutions/carbonops`, `/solutions/water`, `/scan`, `/contact`) and `redirects` (`{ from: '/scan', to: '/assessment' }`). Implement `redirects` in check-site.mjs: every `to` is a built page, and every current-site path is a built page or the `from` of a redirect (SC-006)
- [ ] T037 [P] [US1] Write apps/website/tests/check-claims.test.ts and apps/website/tests/check-redirects.test.ts (Vitest) with fixtures: a figure outside a claim fails, an id with no source fails, a missing redirect target fails, and the happy paths pass
- [ ] T038 [US1] Write apps/website/tests/e2e/marketing.spec.ts (Playwright) for US1 scenarios 1 and 2:
  - every route has **Request a demo** in the viewport at 1440 px and in the mobile menu at 375 px
  - **Sign in** points at `portalUrl`
  - no horizontal scroll at 375 px
  - with `javaScriptEnabled: false` every route renders its main heading and `/contact` shows the contact address
- [ ] T039 [P] [US1] Create docs/dev/website.md and link it from the Development list in docs/README.md, so the rules outlive the spec freeze (constitution gate: docs change with behaviour). It covers:
  - local development: `pnpm --filter @iot-os/website dev`, real values in `.local/website/website.env`, the denylist in `.local/website/denylist.txt`
  - the scripts, and the PR 1 checks (`literals`, `rename`, `names`, `claims`, `redirects`), with how to fix each failure
  - the marketing rules from contracts/content.md "Marketing pages": claims and the claims list, protocols, no open-source wording, no private names

  Later pull requests extend it (T054, T076, T088, T102).
- [ ] T040 [US1] Run [quickstart.md](quickstart.md) B1 (steps 1–5), including the four planted failures, and record the results in the PR 1 description. Tick T005–T040

### Inquiry endpoint (PR 2)

- [ ] T041 [P] [US1] Create contracts/website/inquiry.v1.schema.json from specs/013-website-developer-docs/contracts/inquiry-api.md:
  - `schema_version` const `"inquiry.v1"`; `id` format `uuid`
  - `type` enum `demo`, `assessment`, `question`; `role` enum `hardware`, `product`, `business`
  - `name` 1–120 characters; `email` format `email`, ≤ 254 characters; `company` 1–160 characters; `message` 1–5,000 characters
  - `source_page` matching `^/[^\s]{0,511}$`; `rendered_at` integer; `website` string ≤ 200 characters
  - `additionalProperties: false`

  Add fixtures in contracts/website/fixtures/: `valid.json`, one `invalid-<field>.json` per rule above, `unknown-field.json`, `wrong-version.json`, `honeypot.json`. Add a `website/` entry to contracts/README.md.
- [ ] T042 [US1] Create apps/website/worker/migrations/0001_inquiries.sql with table `inquiries`, exactly the columns in data-model.md "Inquiry":
  - `id` TEXT PRIMARY KEY
  - `type`, `role` and `status` with CHECK constraints on their enum values (`status` IN ('pending','delivered','failed'))
  - `attempts` INTEGER NOT NULL DEFAULT 0
  - `received_at` NOT NULL
  - index `inquiries_status_next_attempt` on (`status`, `next_attempt_at`)
- [ ] T043 [US1] Create apps/website/wrangler.jsonc for local development:
  - `main: worker/index.ts`, current `compatibility_date`
  - `assets`: `{ directory: "./dist", binding: "ASSETS", run_worker_first: ["/api/*"] }`
  - `d1_databases` binding `DB` with `migrations_dir: worker/migrations`
  - `ratelimits` binding `INQUIRY_LIMIT` (`simple: { limit: 5, period: 60 }`)
  - `send_email` binding `TEAM_MAIL` with `destination_address` from a placeholder `team@example.com`
  - `vars`: `SITE_URL` `http://localhost:8787` (so the `Origin` check passes locally), `MAIL_FROM` `website@example.com`, `MAIL_FAIL` `"0"`. Test flags are passed with `wrangler dev --var MAIL_FAIL:1`, so no `.dev.vars` file is needed
  - `triggers.crons: ["*/5 * * * *"]`
- [ ] T044 [US1] Implement apps/website/worker/routes/inquiry.ts per contracts/inquiry-api.md. In order:
  1. 403 unless `Origin` equals `SITE_URL`
  2. 413 above 16 KiB
  3. 400 for invalid JSON or schema failure, using the schema from contracts/website (ajv). The body lists field names only
  4. a non-empty `website`, or `Date.now() - rendered_at < 3000`, answers 202 and stores nothing
  5. `INQUIRY_LIMIT.limit({ key: CF-Connecting-IP })`, which answers 429 with `Retry-After: 60`
  6. `INSERT OR IGNORE` with `status` `pending`, `attempts` 0 and `next_attempt_at` = now; a D1 error answers 503 `{status:"unavailable", contact}`
  7. 202 `{status:"received"}`, with `ctx.waitUntil(deliver(id))`

  Every response carries `Cache-Control: no-store`. Logs contain only `id`, status and error class.
- [ ] T045 [US1] Implement apps/website/worker/deliver.ts, which builds the email from contracts/inquiry-api.md "Delivery email" and sends it with `TEAM_MAIL.send`:
  - **Message**: plain-text MIME. To the team; From `MAIL_FROM`; Reply-To the inquiry's email; subject `[<type>] <company>: <name>`; body with every field, `source_page`, `received_at` (UTC) and `id`
  - **On success**: `status = 'delivered'`, `delivered_at` = now, `next_attempt_at = NULL`
  - **On failure**: `attempts + 1`; `next_attempt_at` per the backoff "5 minutes, 15 minutes, 1 hour, then hourly"; `last_error` set to the error class only
  - **Test flag**: `MAIL_FAIL` `"1"` forces the failure path. It is set only locally, through `--var`
- [ ] T046 [US1] Implement apps/website/worker/scheduled.ts:
  - select at most 50 rows where `status = 'pending' AND next_attempt_at <= now` and deliver each
  - set `status = 'failed'` and `next_attempt_at = NULL` where `received_at` is more than 24 hours old and still pending
  - delete delivered rows more than 30 days old and failed rows more than 90 days old
- [ ] T047 [US1] Implement apps/website/worker/index.ts: `fetch` routes `POST /api/inquiry` to T044, answers 405 for other methods on that path, and answers 404 JSON for any other `/api/*` path. `scheduled` calls T046
- [ ] T048 [P] [US1] Write apps/website/tests/worker/inquiry.test.ts (Vitest with `@cloudflare/vitest-pool-workers`, local D1, a stubbed `TEAM_MAIL`), reading contracts/website/fixtures:
  - valid → 202, one `pending` → `delivered` row, one captured mail with Reply-To and source page
  - the same `id` twice → one row and one mail
  - honeypot, or rendered under 3 s → 202, no row
  - the sixth request in a minute → 429 with `Retry-After`
  - each invalid fixture → 400 naming only that field
  - over 16 KiB → 413; foreign `Origin` → 403; a D1 failure → 503 with the contact address
- [ ] T049 [P] [US1] Write apps/website/tests/worker/scheduled.test.ts:
  - a failing `TEAM_MAIL` leaves the row `pending` with `next_attempt_at` following the backoff, and a later run delivers it
  - a row older than 24 hours becomes `failed` and is kept
  - delivered rows are purged after 30 days and failed rows after 90
- [ ] T050 [US1] Create apps/website/src/islands/InquiryForm.tsx:
  - **Fields**: the kit form fields from `@iot-os/ui/components/form-fields` for name, work email, company and message; kit `RadioGroup` for type and role; kit `Button`
  - **Preset**: `type` from `?type=`; `source_page` from `?page=` when present, else `location.pathname`
  - **Hidden values**: `id` (`crypto.randomUUID()`) and `rendered_at` at mount
  - **Honeypot**: field `website`, visually hidden, `aria-hidden`, `tabIndex={-1}`, `autoComplete="off"`
  - **Validation**: the same JSON schema in the browser
  - **Results**: on 202, an inline confirmation naming who replies and when (owner wording); on 400, field errors; on 429, 503 or a network failure, the contact address. No toasts.
- [ ] T051 [US1] Mount InquiryForm in apps/website/src/pages/contact.astro with `client:visible`, with a `<noscript>` block showing the contact address
- [ ] T052 [P] [US1] Write apps/website/tests/inquiry-form.test.ts (Vitest with Testing Library): every fixture in contracts/website/fixtures passes or fails client validation exactly as the Worker does, `?type=assessment` preselects the type, and the 429 path shows the contact address
- [ ] T053 [US1] Fill apps/website/src/pages/privacy.astro with the facts from research.md R10:
  - the fields collected and why
  - the processor: Cloudflare, for hosting, inquiry storage and email delivery
  - retention: 30 days once delivered, 90 days if delivery failed
  - no cookies and no analytics scripts
  - a contact for requests

  Place the company's supplied text in the slot.
- [ ] T054 [US1] Create docs/ops/website.md and link it from the Operations list in docs/README.md. It covers the inquiry pipeline:
  - states and retention, from data-model.md "Inquiry"
  - the delivery check (`wrangler d1 execute DB --remote --command "select status, count(*) from inquiries group by status"`)
  - reading and handling `failed` rows
  - turning on Turnstile in reserve, with the privacy-notice change

  Add a "Form backend" section to docs/dev/website.md: `wrangler d1 migrations apply DB --local`, `wrangler dev --test-scheduled`, `--var MAIL_FAIL:1`, the contract fixtures and the Worker tests.
- [ ] T055 [US1] Run [quickstart.md](quickstart.md) B2 (steps 1–8) in `wrangler dev --test-scheduled` and record the results in the PR 2 description. Tick T041–T055

**Checkpoint**: US1 works end to end locally, ready to deploy

---

## Phase 4: User Story 5 - Replace the current site safely (Priority: P2) (PR 3)

**Goal**: The site deploys independently of the platform, every old URL lands on a
page, and the switch can be rolled back

**Independent Test**: every current-site URL answers 200 or 301 to a page on the
preview deployment (quickstart B3)

- [ ] T056 [US5] Create apps/website/scripts/wrangler-config.mjs. It reads wrangler.jsonc and writes apps/website/.wrangler/deploy.jsonc with these production values, so none are committed:
  - `routes` for the apex and `www` (custom domains from `PUBLIC_SITE_URL`)
  - the D1 `database_id` from `WEBSITE_D1_DATABASE_ID`
  - `send_email.destination_address` from `WEBSITE_TEAM_ADDRESS`
  - `vars.SITE_URL` and `vars.MAIL_FROM` from the environment
- [ ] T057 [P] [US5] Write `dist/_redirects` from `redirects` in apps/website/src/redirects.ts, one `from to 301` line each, using an Astro integration hook (`astro:build:done`) in apps/website/astro.config.mjs
- [ ] T058 [US5] Create .github/workflows/website-deploy.yml:
  - **Pull requests** touching `apps/website/**`, `contracts/website/**` or `packages/ui/**`, and not from forks: build with production variables, run `check-site all`, then `wrangler versions upload --config .wrangler/deploy.jsonc`, writing the preview URL to the job summary
  - **Push to `main`**: build, `wrangler d1 migrations apply DB --remote`, `wrangler deploy`
  - **`workflow_dispatch`**: redeploy `main`
  - `permissions: contents: read`; `concurrency: website-deploy`; actions pinned by SHA; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WEBSITE_TEAM_ADDRESS`, `WEBSITE_D1_DATABASE_ID`, `WEBSITE_DENYLIST`, and `PUBLIC_SITE_*` variables
- [ ] T059 [US5] Extend docs/ops/website.md (from T054), keeping concrete hosts and addresses in the private inventory. Add:
  - secrets and variables, deploy and preview
  - DNS cutover: zone moved, TTL 300 a day ahead, apex and `www` routed to the Worker, a zone Redirect Rule `www` → apex
  - rollback: point the apex at the old server, kept running for 30 days
- [ ] T060 [US5] Run [quickstart.md](quickstart.md) B3 on the PR 3 preview URL: one inquiry reaches the team address, and the `curl -sI` loop over `currentSitePaths` gives 200 or 301 to a 200 page. Record the results in the PR 3 description. Tick T056–T060
- [ ] T061 [US5] After the owner actions (zone on Cloudflare, Email Routing verified, secrets set), run the cutover in quickstart B8 following docs/ops/website.md: TTL lowered a day ahead, apex and `www` switched, the `curl` loop against production, one real inquiry delivered, and a rollback drill on the preview domain. Record the date and results in the PR 3 thread or the private operations log, not in the repository

**Checkpoint**: the marketing site is live on the company domain (MVP)

---

## Phase 5: User Story 4 - Docs stay true to the hosted service (Priority: P2) (PR 4)

**Goal**: The docs shell, plus reference generated from the hosted commit that fails
closed and hides switched-off or unreleased features

**Independent Test**: change a contract description and a help guide sentence; they
publish only after `WEBSITE_HOSTED_REF` points at a commit containing them
(quickstart B4)

- [ ] T062 [US4] Create apps/website/scripts/sources.mjs. It reads the hosted commit from `WEBSITE_HOSTED_REF`, loading `.local/website/website.env` the same way as site.config.ts, and never prints the value. Then:
  - with `WEBSITE_SOURCES=worktree`, it copies from the working tree
  - otherwise it runs `git archive "$WEBSITE_HOSTED_REF" contracts/openapi contracts/agents apps/api/resources/help packages/integration-sdk/package.json tooling/simulators | tar -x -C .sources/`. A missing or unknown commit fails with "set WEBSITE_HOSTED_REF and fetch history (fetch-depth: 0)", without echoing the value
  - it writes `.sources/meta.json` with `contract_version` (`info.version`), `sdk_version`, `operations` (sorted `METHOD /path` under `/integration/v1`), `event_types` and `guide_sections`. Never the commit

  Also:
  - prepend `node scripts/sources.mjs &&` to the `build` script in apps/website/package.json
  - pass `WEBSITE_HOSTED_REF` from secrets in the CI `website` job and in .github/workflows/website-deploy.yml
  - on fork pull requests, where the secret is empty, set `WEBSITE_SOURCES=worktree` with a notice
- [ ] T063 [US4] In apps/website/scripts/sources.mjs, write `.sources/integration-openapi.json`:
  - keep only paths starting `/integration/v1`, the `webhooks` section, and every component reachable from them by a `$ref` walk (schemas, responses, parameters, headers, securitySchemes)
  - set `servers` to `[{ url: apiBaseUrl + '/api' }]`
  - prepend to each operation's `description` a "Requires:" line from `x-abilities` (for example `devices:read`, saying whether all or any are needed) and a "Rate limits:" line from `x-rate-limits` (for example "60 a minute per application, 240 a minute per address"), because the plugin doesn't render vendor extensions (FR-013)
  - fail on any unresolved `$ref`, and on an integration operation missing `x-abilities` or `x-rate-limits`
- [ ] T064 [US4] In apps/website/scripts/sources.mjs, turn each `.sources/apps/api/resources/help/<slug>.md` into apps/website/src/content/docs/docs/guides/<slug>.md:
  - **Parse**: the JSON front matter. Require exactly the HelpCatalog fields (`slug`, `title`, `section`, `contexts`, `keywords`, `required_capabilities`, `revision` as an integer ≥ 1, `summary`, `questions`) and fail on any missing or unknown field
  - **Write**: front matter `title`, `description` (= `summary`), `help_revision` (= `revision`), `requires` (= `required_capabilities`) and `sidebar.label`. Record each guide under its `section` in `meta.json` `guide_sections` (section → ordered slugs), which T065 uses to build sidebar groups
  - **Links**: rewrite `](/help/<slug>)` to `](/docs/guides/<slug>/)`, failing on an unknown slug
- [ ] T065 [US4] Install `@astrojs/starlight` 0.42.x, `starlight-openapi` and `starlight-links-validator` in apps/website/package.json. Add Starlight to apps/website/astro.config.mjs:
  - `title` from `productName`, `customCss: ['./src/styles/starlight.css']`
  - the sidebar from plan.md "Docs" (Get started, Concepts, Hardware, Developers, User guides, Changelog). User guides is one group per section, built from `.sources/meta.json` `guide_sections` with explicit slugs, so URLs stay `/docs/guides/<slug>/`
  - plugins `starlightOpenAPI([{ base: 'docs/reference/api', schema: './.sources/integration-openapi.json' }])` and `starlightLinksValidator()`
  - confirm the build emits exactly one `sitemap-index.xml` covering marketing and docs routes, and remove the explicit `sitemap()` if Starlight adds its own

  Create apps/website/src/content.config.ts with `docsSchema({ extend: { help_revision, requires } })`. Exclude `docs/**/adapters/**` when `features.adapters` is false and `docs/**/agents/**` when `features.agent_access` is false:
  - first check that `docsLoader()` accepts a glob pattern with negation
  - if it doesn't, use Astro's `glob({ base: './src/content/docs', pattern })` loader with `docsSchema`

  Record which one is used in docs/dev/website.md (T076).
- [ ] T066 [P] [US4] Create apps/website/src/styles/starlight.css, mapping Starlight's `--sl-color-*` (accents, grays, backgrounds) and `--sl-font` onto the kit tokens for light and dark (`:root[data-theme='light']`, `:root[data-theme='dark']`)
- [ ] T067 [P] [US4] Override Starlight's `Header` in apps/website/src/components/docs/Header.astro: keep search and the theme toggle, and add the marketing links, **Sign in** (`portalUrl`) and **Request a demo** (`/contact?type=demo`). Extend apps/website/tests/e2e/marketing.spec.ts so the Request a demo and Sign in checks also run on the docs index, one page per docs section and one generated API page (FR-002)
- [ ] T068 [P] [US4] Create apps/website/src/components/docs/EventTypes.astro, which renders a section per entry in `IntegrationEvent`'s discriminator mapping (type name, then a table of its `data` properties with type and description). Create apps/website/src/components/docs/WebhookDelivery.astro, which renders `webhooks.integrationEvent` (method, headers, signature header, body). Both read `.sources/integration-openapi.json`
- [ ] T069 [P] [US4] Create apps/website/src/components/docs/AgentTools.astro, a table of name, access level and description from `.sources/contracts/agents/tools.json`
- [ ] T070 [P] [US4] Override Starlight's `PageTitle` (or `MarkdownContent`) in apps/website/src/components/docs/ to show "Guide revision N" and "Requires: <capability>" on pages with `help_revision`. Override `Footer` with **Report a problem with this page**, linking to `/contact?type=question&page=<current path>` (FR-020)
- [ ] T071 [US4] Create the docs pages in apps/website/src/content/docs/docs/:
  - apps/website/src/content/docs/docs/index.mdx: overview with the two quickstarts and the reference sections
  - apps/website/src/content/docs/docs/developers/events.mdx: the envelope, ordering by commit, cursors and checkpoints, at-least-once delivery and deduplication by event `id`, the 409 after a grant change, `<EventTypes/>` and `<WebhookDelivery/>`
  - apps/website/src/content/docs/docs/changelog.mdx: a first entry for the hosted contract's `info.version` and SDK 0.5.0

  Then create apps/website/changelog-baseline.json with `node scripts/check-site.mjs changelog --update`: sorted `operations` and `event_types` from `meta.json`.
- [ ] T072 [US4] Implement and register four subcommands in apps/website/scripts/check-site.mjs:
  - `features`: fail when built HTML links to a route under a gated folder whose switch is off, or to a `draft: true` page
  - `reference` (SC-003, FR-013):
    - the generated API pages under `/docs/reference/api/` match `meta.json` `operations` one to one
    - each page shows its "Requires:" and "Rate limits:" lines
    - the events page lists exactly `meta.json` `event_types`
    - no file in `dist` contains the hosted commit, in full or as a 7-or-more-character prefix
  - `changelog` (FR-019):
    - fail when changelog.mdx has no entry naming `meta.json`'s `contract_version` and `sdk_version`
    - fail when `operations` or `event_types` differ from apps/website/changelog-baseline.json
    - `--update` rewrites the baseline after an entry is added
  - `drafts`: list draft pages whose introducing commit (`git log --diff-filter=A --format=%H -- <file> | tail -1`) passes `git merge-base --is-ancestor <commit> "$WEBSITE_HOSTED_REF"`. Print paths only, never the commit
- [ ] T073 [P] [US4] Write apps/website/tests/sources.test.ts and apps/website/tests/check-docs.test.ts (Vitest) with fixtures:
  - the filter keeps exactly the integration paths and their referenced components
  - an unresolved `$ref` fails
  - guide front matter maps correctly, an unknown field fails, and `/help/` links are rewritten
  - `features`, `reference`, `changelog` (including a baseline mismatch and `--update`) and `drafts` behave as in T072
  - operations missing `x-abilities` fail T063, and descriptions gain "Requires:" and "Rate limits:" lines
- [ ] T074 [US4] Make tooling/docs/check_links.py skip `apps/website/src/content/`, whose links are site routes checked by `starlight-links-validator`. Add or extend a case in tooling/docs/test_*.py
- [ ] T075 [US4] Update the OpenAPI item under "Integrations" in docs/roadmap.md: publishing the reference is delivered for the integration API by spec 013, and the other items remain
- [ ] T076 [US4] Extend docs/dev/website.md with the docs rules:
  - generated pages and their sources, `draft: true`, gated folders and which loader does the gating (T065)
  - the changelog and refreshing its baseline
  - the `features`, `reference`, `changelog` and `drafts` checks

  Extend docs/ops/website.md with updating the hosted commit after a hosted deploy:
  1. `gh secret set WEBSITE_HOSTED_REF`, and the same value in `.local/website/website.env`
  2. run `check-site drafts`
  3. open a pull request publishing the drafts it lists, or dispatch `website-deploy.yml` when there are none

  Never paste the commit into issues, pull requests or logs.
- [ ] T077 [US4] Owner: set the Actions secret `WEBSITE_HOSTED_REF` (read by .github/workflows/ci.yml and .github/workflows/website-deploy.yml) to the full hosted commit, and the same value in `.local/website/website.env`. Confirm the PR 4 CI run builds from it without printing it (search the job log for the first 7 characters)
- [ ] T078 [US4] Run [quickstart.md](quickstart.md) B4 (steps 1–7) and record the results in the PR 4 description. Point marketing `<Claim id>` entries that now have a docs page at `doc` instead. Tick T062–T078

**Checkpoint**: the docs build only from the hosted commit, with generated API, events and guides

---

## Phase 6: User Story 2 - Connect a first device as a hardware engineer (Priority: P1) (PR 5)

**Goal**: A hardware engineer reaches stored readings and a confirmed command using
only the docs and the simulator kit

**Independent Test**: quickstart B5 against the local stack. `./taskw devices:test`
runs the same path.

- [ ] T079 [US2] In the local stack, prove the hardware path with tooling/simulators/sparkplug_simulator.py before any page is written (research.md R8). The simulator is one edge node (NBIRTH: `bdSeq`, `Node Control/Rebirth`, `Uptime`) with two downstream devices.
  1. Create two starter profiles:
     - "Simulated meter": `Voltage L1`, `Voltage L2`, `Voltage L3`, `Imported energy`, `Exported energy`, all Double
     - "Simulated light": controllable `Power` (Boolean), `Color` (String), `Mode` (String) and `Brightness` (Int32). `rgb-light` is the only device that accepts commands
  2. Preferred path: add a direct device and download its kit. Run `python sparkplug_simulator.py --config device-config.json --state-file state.json` from the kit folder. Then onboard `meter` and `rgb-light` from **Connect → Discovery** under that edge node with the two profiles. Confirm good stored readings, and confirm a `Power` command on `rgb-light`.
  3. Fallback, if discovery onboarding under a direct device's edge node isn't allowed: add the smallest flag to tooling/simulators/sparkplug_simulator.py that births one device's metrics as the edge node's own and accepts NCMD writes for them, with a test in tooling/simulators/test_*.py.

  Record the path used and the exact profile fields for T081.
- [ ] T080 [US2] In apps/website/scripts/sources.mjs, build public/downloads/simulator-kit.zip from `.sources/tooling/simulators/` (sparkplug_simulator.py, sparkplug_b_pb2.py, requirements.txt) plus a generated README.md: Python 3.12 or later, a virtual environment, `pip install -r requirements.txt`, and the run command from T079
- [ ] T081 [US2] Write apps/website/src/content/docs/docs/get-started/connect-a-device.mdx (US2 scenario 1):
  - prerequisites: an account with `Device.manage`, the two starter profiles from T079 with their parameter tables, the simulator kit, Python
  - the portal steps in order, following the path T079 proved. For the preferred path: **Devices → Add device**, direct, download the kit, start the simulator, then **Connect → Discovery** to onboard `meter` and `rgb-light` with their profiles, map, review, activate
  - what success looks like at each step, then sending a `Power` command to the light and seeing it confirmed
  - links to the Sparkplug reference
- [ ] T082 [P] [US2] Write apps/website/src/content/docs/docs/hardware/sparkplug.mdx from services/runtime/internal/sparkplug and docs/reference/sparkplug.md (US2 scenario 2, FR-016). It lists what the runtime requires and rejects, as a checklist with one row per rule:
  - the `spBv1.0/<group>/…` namespace
  - NBIRTH `seq = 0` with `bdSeq`
  - DBIRTH metrics, aliases and datatypes
  - `Node Control/Rebirth`, and `STATE/<host_id>`
  - TLS 1.2 or later with the kit's CA, and credentials per gateway
  - NCMD and DCMD with acknowledgement, and why a command can end "uncertain"

  It links to the Eclipse specification.
- [ ] T083 [P] [US2] Write apps/website/src/content/docs/docs/hardware/connection-kits.mdx (kit contents, TLS verification with the kit's CA, credentials private to one device, the broker host from config) and apps/website/src/content/docs/docs/hardware/gateways.mdx (gateways, **Connect → Discovery**, discovered sources, one source per device) (US2 scenario 3)
- [ ] T084 [P] [US2] Write apps/website/src/content/docs/docs/hardware/reference-firmware.mdx from firmware/waveshare-audio: how the board connects, births its metrics and handles a command. State that it is an example, not a supported product, and leave out network names and hosts (US2 scenario 4)
- [ ] T085 [P] [US2] Write apps/website/src/content/docs/docs/hardware/adapters/vendor-mqtt.mdx (a gated folder): connect `vendor_water_meter.py` through an adapter with a sample decoder (US2 scenario 5)
- [ ] T086 [P] [US2] Write the concept pages in apps/website/src/content/docs/docs/concepts/: organizations.mdx, devices-and-profiles.mdx, sources-and-gateways.mdx, measurements-and-quality.mdx (unknown is not zero, stale values are labelled), commands.mdx, alerts.mdx, automation.mdx and dashboards.mdx. Each links to its user guides
- [ ] T087 [US2] Add the simulator kit path to tooling/test-devices.mjs: build the kit with `WEBSITE_SOURCES=worktree node apps/website/scripts/sources.mjs`, run it with an exported connection kit through the path T079 proved, and assert good-quality stored readings from `meter` and one confirmed `Power` command on `rgb-light`
- [ ] T088 [P] [US2] Extend docs/dev/website.md with the simulator kit: how it is built from the hosted commit, the two starter profiles, the onboarding path T079 proved, and the devices-suite step from T087
- [ ] T089 [US2] Point the hardware page's claims in apps/website/src/pages/engineers/hardware.astro at the new docs routes. Run quickstart B5 and `./taskw devices:test`, and record the results in the PR 5 description. Tick T079–T089

---

## Phase 7: User Story 3, SDK publishing (Priority: P1) (PR 6)

**Goal**: The integration SDK is installable from npm (FR-024). It doesn't depend on
PRs 1–5.

**Independent Test**: `npm view <name>` shows the version with provenance, and
`npm install <name>` works in an empty folder

- [ ] T090 [US3] In packages/integration-sdk/package.json:
  - set `name` to the owner's choice
  - add `license` (the owner's choice of `MIT` or `Apache-2.0`)
  - add `repository` (`{ type: "git", url, directory: "packages/integration-sdk" }`)
  - add `publishConfig: { access: "public", provenance: true }`

  Leave `homepage` to the workflow (T093).
- [ ] T091 [P] [US3] Add packages/integration-sdk/LICENSE with the chosen license text, the copyright holder being the company, and add `LICENSE` to `files`
- [ ] T092 [P] [US3] In packages/integration-sdk/README.md, replace the "available from the workspace or a local tarball; not published" paragraph and the tarball steps with `npm install <name>` and a pointer to the developer docs. Keep the rest
- [ ] T093 [US3] Create .github/workflows/sdk-publish.yml:
  - trigger: tags `sdk-v*`; permissions `contents: read`, `id-token: write`
  - setup-node with `registry-url: https://registry.npmjs.org`, then `pnpm install --frozen-lockfile`
  - `pnpm --filter <name> test`; fail unless the tag equals `sdk-v<version>`
  - `npm pkg set homepage=$WEBSITE_DOCS_URL` from repository variables
  - `npm publish --provenance --access public` through npm trusted publishing
  - actions pinned by SHA
- [ ] T094 [P] [US3] Add an "Integration SDK" section to docs/ops/release.md: bump `version`, add a changelog entry, tag `sdk-v<version>`, the trusted-publishing workflow, verifying provenance. In docs/features/integrations.md "SDK and sample host", replace "not published to a registry" with the npm package name and the docs link
- [ ] T095 [US3] Owner: register the npm organization and the trusted publisher for this repository and .github/workflows/sdk-publish.yml, then push tag `sdk-v0.5.0`. Confirm `npm view <name>` shows 0.5.0 with provenance, and record it in the PR 6 description. Tick T090–T095

---

## Phase 8: User Story 3 - Build a first integration as a product engineer (Priority: P1) (PR 7)

**Goal**: A product engineer lists devices, reads values, follows the event feed and
verifies a webhook using only the docs

**Independent Test**: quickstart B6. `./taskw devices:test` runs every developer
sample against the fixture organization.

- [ ] T096 [P] [US3] Create the samples in apps/website/samples/developer/. Each reads `IOT_API_BASE_URL`, `IOT_ORGANIZATION` and `IOT_APPLICATION_TOKEN` (plus `IOT_WEBHOOK_SECRET` for the webhook sample), and sets `allowInsecureLocalhost` only for loopback URLs:
  - list-devices.mjs
  - latest-telemetry.mjs
  - event-feed.mjs: checkpoint, then pages; stores the cursor atomically with its output; deduplicates by event `id`
  - webhook-verify.mjs: a local HTTP endpoint verifying the signature on the raw body with the SDK
- [ ] T097 [US3] Create tooling/verify-website-samples.mjs, reusing the fixture from tooling/verify-integration-sdk.php:
  - create an application with `devices:read`, `telemetry:read`, `alerts:read` and `events:read` and issue a token
  - run each sample, asserting its output
  - send one signed test delivery to webhook-verify.mjs

  Call it from tooling/test-devices.mjs. In the CI `website` job:
  - add `node --check` and `tsc --noEmit --allowJs --checkJs` over `samples/`
  - add a samples gate step (FR-018). On pull requests, if `git diff --name-only origin/main...HEAD` touches `apps/website/samples/`, `packages/integration-sdk/`, `apps/api/app/Domain/Integrations/` or `contracts/openapi/supplements/integration*.yaml`, it fails unless the description records a `./taskw devices:test` run and its result. Pass the description through `env: PR_BODY: ${{ github.event.pull_request.body }}` and read `"$PR_BODY"` in the script, never interpolating it into the shell command, which would allow script injection
- [ ] T098 [US3] Write apps/website/src/content/docs/docs/get-started/build-an-integration.mdx with `draft: true` (US3 scenario 1):
  - create an application in **Connect → Integrations** (needs `Device.view` and `Device.manage`)
  - choose abilities and devices; token expiry is 1–90 days and the token stays on the server
  - `npm install <name>`
  - the samples through `<Code>`, then the event feed and a webhook
- [ ] T099 [P] [US3] Write four pages in apps/website/src/content/docs/docs/developers/ (US3 scenarios 2–4, FR-017):
  - applications.mdx: the abilities table; 1–100 granted devices; one active token, with rotation invalidating the previous one; a grant change invalidates the token and cursors and disables the webhook; 50 applications per organization
  - rate-limits-and-errors.mdx: 60 a minute per application and 240 per address, 429 with `Retry-After`, and the meaning of 401, 403, 404, 409, 422, 503 and 504
  - webhooks.mdx: verification on the raw body with the SDK and as language-neutral steps, retries and delivery history
  - sdk.mdx: client options, errors (`IotApiError`, `IotTransportError`, `IotContractError`), pagination, `AbortSignal`, timeouts, and no automatic retry
- [ ] T100 [P] [US3] Write apps/website/src/content/docs/docs/developers/agents/connect.mdx and apps/website/src/content/docs/docs/developers/agents/tools.mdx (a gated folder) (US3 scenario 5):
  - the connector address `<apiBaseUrl>/mcp`
  - the organization switch under **Settings → AI apps**
  - **Read** and **Read and drafts**, and that agents never perform live actions
  - `<AgentTools/>`
- [ ] T101 [US3] After T095, remove `draft: true` from build-an-integration.mdx and add the SDK's npm publication to changelog.mdx. Point the product page's claims in apps/website/src/pages/engineers/product.astro at the new docs routes
- [ ] T102 [P] [US3] Extend docs/dev/website.md with the developer samples: where they live, how `<Code>` imports them, `tooling/verify-website-samples.mjs`, and the samples gate, with what to write in the pull request description
- [ ] T103 [US3] Run [quickstart.md](quickstart.md) B6 and `./taskw devices:test`, and record the results in the PR 7 description. Tick T096–T103

---

## Phase 9: Polish and cross-cutting concerns

- [ ] T104 [P] Add to docs/dev/gotchas.md only the surprises met during implementation, for example:
  - Starlight needs docs in a `docs/` content subfolder to serve them at `/docs`
  - `git archive` of the hosted commit needs `fetch-depth: 0` in CI
  - axe contrast failures during colour fades
- [ ] T105 Run [quickstart.md](quickstart.md) B7: two people who did not build the platform each complete one quickstart against the hosted service, using only the published docs. Record their times and where they got stuck in a follow-up pull request that fixes what they hit (SC-001, SC-002)
- [ ] T106 After the last implementation pull request merges, rerun quickstart B1–B4 and B8's `curl` loop against production, and confirm SC-003 to SC-007. Then freeze specs/013-website-developer-docs/ (docs/dev/specs.md), leaving the lasting behaviour in docs/dev/website.md, docs/ops/website.md and ADR-020

---

## Dependencies and execution order

### Phase dependencies

- **Plan acceptance (PR 0)**: none. It blocks everything.
- **Setup and Foundational (PR 1)**: depend on PR 0, and block every story.
- **US1 marketing pages (PR 1)**: with the foundation, in the same pull request.
- **US1 inquiry endpoint (PR 2)**: depends on PR 1.
- **US5 (PR 3)**: depends on PR 2. Cutover (T061) also waits for the owner's
  Cloudflare setup.
- **US4 (PR 4)**: depends on PR 1. It can be built while PRs 2 and 3 are reviewed,
  and is opened from `main` after PR 3 merges.
- **US2 (PR 5)**: depends on PR 4 (the docs shell, `sources.mjs`, gating).
- **PR 4's CI builds** need the `WEBSITE_HOSTED_REF` secret (T077). Until it is set,
  they use `WEBSITE_SOURCES=worktree`, like forks.
- **SDK publishing (PR 6)**: depends only on PR 0 and the owner's npm decisions. It
  can merge at any point.
- **US3 developer docs (PR 7)**: depends on PR 4. T101 waits for PR 6 to be published.
- **Polish**: after PR 7.

### Within each pull request

Contracts and fixtures come before the code that reads them, and the code before its
tests. Checks are written before the pages they guard. Each pull request updates
docs/dev/website.md or docs/ops/website.md for the behaviour it adds (constitution:
docs change with behaviour). The quickstart run and recorded results come last.
Before opening each pull request, run:
- `pnpm --filter @iot-os/website lint test build`
- `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint`
- `python3 tooling/docs/check_links.py`

### Parallel opportunities

- PR 0: T002 and T003 after T001.
- PR 1: T006–T010 together; T012, T015, T016 and T019–T023 together after T011;
  T025, T027, T028 together; then T030–T033 together; T039 alongside T037.
- PR 2: T041 first. Then T042, T043 and T048–T049 alongside T044–T047. T052
  alongside T050.
- PR 4: T066, T067, T068–T070 together after T065. T073 alongside T072.
- PR 5: T082–T086 together after T079.
- PR 6 by a second person at any time after PR 0.
- PR 7: T096, T099 and T100 together.

## Parallel example: User Story 2

```bash
Task: "Write hardware/sparkplug.mdx in apps/website/src/content/docs/docs/hardware/"
Task: "Write hardware/connection-kits.mdx and hardware/gateways.mdx"
Task: "Write hardware/reference-firmware.mdx from firmware/waveshare-audio"
Task: "Write hardware/adapters/vendor-mqtt.mdx (gated)"
Task: "Write the eight concept pages in apps/website/src/content/docs/docs/concepts/"
```

## Implementation strategy

### MVP first

1. PR 0 (accept the plan, ADR-020, constitution), PR 1 (marketing pages and checks),
   PR 2 (inquiries), PR 3 (deploy).
2. **Stop and validate**: quickstart B1–B3, then the cutover (T061). The company
   domain serves the new site, with the old site restorable for 30 days.

### Incremental delivery

1. PR 4: docs shell and generated reference. The API reference and user guides are
   public.
2. PR 5: hardware docs (US2).
3. PR 6, any time: SDK on npm.
4. PR 7: developer docs (US3). The developer quickstart leaves draft once the SDK is
   published.
5. Polish: the usability check with outside engineers, then freeze.
