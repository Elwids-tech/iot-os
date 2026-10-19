---

description: "Task list for developer documentation and SDK publishing (spec 013, rescoped)"
---

# Tasks: Developer Documentation and SDK Publishing

**Input**: Design documents from `/specs/013-website-developer-docs/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Revision**: regenerated on 2026-10-18 after the marketing website moved to its own
repository ([ADR-021](../../docs/adr/ADR-021-developer-docs-only.md)). The
2026-10-17 task list, whose PR 0 tasks merged in #80, is in git history.

**Tests**: Required. SC-003, SC-004 and SC-005 are automated checks, and the honesty
rules are enforced by `check-docs.mjs`. Test tasks are part of each story.

**Organization**: Tasks are grouped by user story. Each group names the pull request
(PR 0 to PR 4, plan.md "Pull requests") that carries it. Phases follow delivery
order, not story priority:
- US3 (docs stay true to the hosted service) lands first, with the foundation in
  PR 1, because every page depends on the generated sources.
- FR-021 (publishing the SDK) belongs to US2 but is its own pull request, PR 3, and
  doesn't depend on the docs.

Every pull request is opened from `main` after the previous one merges. **None are
stacked.**

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1 to US3)
- Paths are repository-relative. Docs paths are under `apps/docs/`.

## Before starting

Owner decisions and actions (plan.md "Owner actions"), and the tasks that wait for
each:

- Hosted feature switches (adapters, agent access): T012
- Marketing site home and contact URLs (placeholders until the site is live): T011
- Hosted commit (`DOCS_HOSTED_REF`), repository variables, the denylist secret, GitHub
  Pages and the docs subdomain: T040
- SDK npm scope and name, and the license (MIT or Apache-2.0): T053 to T058

---

## Phase 0: Rescope (PR 0)

**Purpose**: The documents-only pull request. Merging it accepts ADR-021, the
constitution amendment and the rescoped spec, plan and tasks.

- [x] T001 Write docs/adr/ADR-021-developer-docs-only.md, amending ADR-020: the marketing website leaves this repository; the developer docs stay in `apps/docs`, published to GitHub Pages; what is kept from and dropped from ADR-020; consequences
- [x] T002 [P] Update docs/adr/README.md (ADR-020 "Accepted; amended by ADR-021", new ADR-021 row) and the status line of docs/adr/ADR-020-public-website.md
- [x] T003 [P] Amend the **Stack** bullet in .specify/memory/constitution.md to name the docs site on GitHub Pages and the separate website repository (ADR-020, ADR-021), and bump to 1.0.4 (PATCH), Last Amended 2026-10-18
- [x] T004 Rescope specs/013-website-developer-docs/ (spec, research, plan, data model, contracts, quickstart, checklist and this task list) to developer docs and SDK publishing
- [x] T005 Run `python3 tooling/docs/check_links.py`, then open the documents-only pull request from `main`

---

## Phase 1: Setup (PR 1)

**Purpose**: The workspace and its tooling

- [ ] T006 Create apps/docs/package.json for `@iot-os/docs`:
  - `private: true`, `type: module`
  - scripts: `dev`, `build` (`node scripts/sources.mjs && astro build && node scripts/check-docs.mjs all`), `preview`, `lint` (`astro check && node ../../packages/ui/scripts/check-ui.mjs src && node scripts/check-docs.mjs literals`), `test` (vitest run), `test:e2e` (playwright test)
  - dependencies: `astro` 7.x, `@astrojs/starlight` 0.42.x, `@astrojs/react`, `starlight-openapi`, `starlight-links-validator`, `react` and `react-dom` ^19.2.0, `@tailwindcss/vite` and `tailwindcss` ^4.1.17 (match apps/portal/package.json), `@iot-os/ui` `workspace:*`
  - devDependencies: `typescript` ~5.9.3, `@astrojs/check`, `vitest`, `@playwright/test` ^1.62.1, `@axe-core/playwright` ^4.10.2, `@lhci/cli`, `ajv`, `ajv-formats`, `yaml`

  Run `pnpm install` and commit pnpm-lock.yaml.
- [ ] T007 [P] Create apps/docs/tsconfig.json (extends `astro/tsconfigs/strict`, `jsx: react-jsx`, includes `src`, `scripts`, `tests`, `samples`) and apps/docs/src/env.d.ts
- [ ] T008 [P] Add to .gitignore: `apps/docs/.sources/`, `apps/docs/src/content/docs/docs/guides/`, `apps/docs/public/downloads/`, `apps/docs/dist/`, `apps/docs/.lighthouseci/`, plus `apps/docs/.env*` as a safety net. Real local values live in `.local/docs/`, which is already ignored
- [ ] T009 [P] Confirm turbo.json caches `apps/docs/dist/**` for `build`, adding per-package outputs if the root pipeline doesn't. Confirm `pnpm --filter @iot-os/docs build` runs from the root
- [ ] T010 [P] Add an `apps/docs` row to the repository map in AGENTS.md and in docs/README.md: "Public developer docs (Astro, Starlight), published to GitHub Pages; ADR-021"

---

## Phase 2: Foundational (PR 1)

**Purpose**: Configuration, sources, the docs shell and the guardrails every page needs

**⚠️ CRITICAL**: No story work starts until this phase is complete

- [ ] T011 Create apps/docs/docs.config.ts exactly as contracts/docs-config.md lists:
  - before reading, load `.local/docs/docs.env` (resolved from the repository root) with `process.loadEnvFile` when the file exists
  - keys `productName`, `companyName`, `docsUrl`, `marketingUrl`, `contactUrl`, `portalUrl`, `apiBaseUrl`, `brokerHost`, each reading its `PUBLIC_DOCS_*` variable with the placeholder defaults from the contract
  - throw at build time when a URL is not absolute `https`, or `brokerHost` is not a bare hostname
- [ ] T012 Create apps/docs/hosted-release.json and its loader:
  - `schema_version: "hosted-release.v1"` and `features.adapters` / `features.agent_access` from the owner. No commit SHA: the hosted commit is a secret (T040)
  - copy specs/013-website-developer-docs/contracts/hosted-release.schema.json to apps/docs/schemas/hosted-release.schema.json
  - create apps/docs/src/lib/hosted-release.ts, which validates the file with ajv and throws on failure
- [ ] T013 Create apps/docs/scripts/sources.mjs. It reads the hosted commit from `DOCS_HOSTED_REF`, loading `.local/docs/docs.env` the same way as docs.config.ts, and never prints the value. Then:
  - with `DOCS_SOURCES=worktree`, it copies from the working tree
  - otherwise it runs `git archive "$DOCS_HOSTED_REF" contracts/openapi contracts/agents apps/api/resources/help packages/integration-sdk/package.json tooling/simulators | tar -x -C .sources/`. A missing or unknown commit fails with "set DOCS_HOSTED_REF and fetch history (fetch-depth: 0)", without echoing the value
  - it writes `.sources/meta.json` with `contract_version` (`info.version`), `sdk_version`, `operations` (sorted `METHOD /path` under `/integration/v1`), `event_types` and `guide_sections`. Never the commit
- [ ] T014 In apps/docs/scripts/sources.mjs, write `.sources/integration-openapi.json`:
  - keep only paths starting `/integration/v1`, the `webhooks` section, and every component reachable from them by a `$ref` walk (schemas, responses, parameters, headers, securitySchemes)
  - set `servers` to `[{ url: apiBaseUrl + '/api' }]`
  - prepend to each operation's `description` a "Requires:" line from `x-abilities` (for example `devices:read`, saying whether all or any are needed) and a "Rate limits:" line from `x-rate-limits` (for example "60 a minute per application, 240 a minute per address"), because the plugin doesn't render vendor extensions (FR-010)
  - fail on any unresolved `$ref`, and on an integration operation missing `x-abilities` or `x-rate-limits`
- [ ] T015 In apps/docs/scripts/sources.mjs, turn each `.sources/apps/api/resources/help/<slug>.md` into apps/docs/src/content/docs/docs/guides/<slug>.md:
  - **Parse**: the JSON front matter. Require exactly the HelpCatalog fields (`slug`, `title`, `section`, `contexts`, `keywords`, `required_capabilities`, `revision` as an integer ≥ 1, `summary`, `questions`) and fail on any missing or unknown field
  - **Write**: front matter `title`, `description` (= `summary`), `help_revision` (= `revision`), `requires` (= `required_capabilities`) and `sidebar.label`. Record each guide under its `section` in `meta.json` `guide_sections` (section → ordered slugs)
  - **Links**: rewrite `](/help/<slug>)` to `](/docs/guides/<slug>/)`, failing on an unknown slug
- [ ] T016 Create apps/docs/astro.config.mjs:
  - `site` from `docsUrl`, `output: 'static'`, `integrations: [react(), starlight(…)]`, `vite.plugins: [tailwindcss()]`
  - Starlight: `title` from `productName`, `customCss: ['./src/styles/starlight.css']`, plugins `starlightOpenAPI([{ base: 'docs/reference/api', schema: './.sources/integration-openapi.json' }])` and `starlightLinksValidator()`
  - the sidebar from plan.md "Docs" (Get started, Concepts, Hardware, Developers, User guides, Changelog). User guides is one group per section, built from `.sources/meta.json` `guide_sections` with explicit slugs, so URLs stay `/docs/guides/<slug>/`
  - confirm the build emits one `sitemap-index.xml` covering every docs route

  Create apps/docs/src/content.config.ts with `docsSchema({ extend: { help_revision, requires } })`. Exclude `docs/**/adapters/**` when `features.adapters` is false and `docs/**/agents/**` when `features.agent_access` is false:
  - first check that `docsLoader()` accepts a glob pattern with negation
  - if it doesn't, use Astro's `glob({ base: './src/content/docs', pattern })` loader with `docsSchema`

  Record which one is used in docs/dev/docs-site.md (T038).
- [ ] T017 [P] Create apps/docs/src/styles/docs.css (`@import "tailwindcss"`, `@import "@iot-os/ui/globals.css"`, `@source` lines for `src/**` and `../../packages/ui/src/**`) and apps/docs/src/styles/starlight.css, mapping Starlight's `--sl-color-*` (accents, grays, backgrounds) and `--sl-font` onto the kit tokens for light and dark (`:root[data-theme='light']`, `:root[data-theme='dark']`)
- [ ] T018 [P] Override Starlight's `Header` in apps/docs/src/components/docs/Header.astro: keep search and the theme toggle, and add links to the marketing site (`marketingUrl`) and **Sign in** (`portalUrl`) (FR-002). Override `Footer` in apps/docs/src/components/docs/Footer.astro with **Report a problem with this page**, linking to `contactUrl?type=question&page=<current path>` (FR-017)
- [ ] T019 [P] Extend packages/ui/scripts/check-ui.mjs so its file filter also reads `.astro` files, and update the usage comment. Run `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint` to confirm no new findings
- [ ] T020 Create apps/docs/scripts/check-docs.mjs with a subcommand registry and `all`, which runs every registered check. Each check exits non-zero with file and line on failure. Implement `literals` from contracts/docs-config.md:
  - every effective config value found in `src/**` outside docs.config.ts fails
  - `productName` matches as a whole phrase that is not part of a package specifier (`@iot-os/…`)
- [ ] T021 Implement `rename` in apps/docs/scripts/check-docs.mjs: run the build into a temporary directory with `PUBLIC_DOCS_PRODUCT_NAME="Renamed Product"`, then fail if the default product name appears in any built HTML text (SC-005)
- [ ] T022 [P] Implement `names` in apps/docs/scripts/check-docs.mjs. It reads newline-separated names from `DOCS_DENYLIST`, or from .local/docs/denylist.txt when the variable is unset, and matches each one case-insensitively as a whole word in `dist/**/*.html` text and `src/**`:
  - With no list, it warns locally.
  - In CI on `main` it fails.
  - On fork pull requests it skips, with a notice.
- [ ] T023 [P] Write apps/docs/tests/check-docs.test.ts (Vitest) covering `literals`, `rename` and `names`, with fixture trees under apps/docs/tests/fixtures/check-docs/
- [ ] T024 [P] Create apps/docs/playwright.config.ts (webServer `pnpm preview --port 4321`, projects at 375×812 and 1440×900, each in light and dark `colorScheme`). Create apps/docs/tests/e2e/axe.spec.ts: visit every URL in `dist/sitemap-index.xml`, wait until `document.getAnimations()` is empty, then fail on any serious or critical `@axe-core/playwright` violation
- [ ] T025 [P] Create apps/docs/tests/e2e/privacy.spec.ts. For every sitemap URL, it asserts:
  - no response carries a `Set-Cookie` header
  - `document.cookie` is empty after load
  - every request goes to the preview origin, none to another origin (FR-008)
- [ ] T026 [P] Create apps/docs/tests/e2e/chrome.spec.ts. On the docs index, one page per sidebar section and one generated API page, it checks:
  - the header links to `marketingUrl` and `portalUrl`
  - the footer's report link carries the page path
  - there is no horizontal scroll at 375 px
  - with `javaScriptEnabled: false` the main heading still renders (FR-002, FR-017)
- [ ] T027 [P] Create apps/docs/lighthouserc.json: `staticDistDir: ./dist`, the docs index, the hardware quickstart, one generated API page and one user guide, mobile preset, assertion `largest-contentful-paint` ≤ 2000 ms (SC-004)
- [ ] T028 Add a `docs` job to .github/workflows/ci.yml, modelled on the `web` job:
  - checkout with `fetch-depth: 0`; Node from `.nvmrc`; pnpm 11.19.0; store cache; `pnpm install --frozen-lockfile`
  - env: `PUBLIC_DOCS_*` from repository variables, falling back to the placeholders; `DOCS_HOSTED_REF` and `DOCS_DENYLIST` from secrets. When `DOCS_HOSTED_REF` is empty (forks, or before T040), set `DOCS_SOURCES=worktree` and print a notice
  - steps: `pnpm --filter @iot-os/docs lint`, `test`, `build`, `node scripts/check-docs.mjs rename`, `playwright install --with-deps --only-shell chromium`, `test:e2e`, `lhci autorun`
  - same SHA-pinned actions as the existing jobs
- [ ] T029 Create .github/workflows/docs-deploy.yml:
  - triggers: push to `main` touching `apps/docs/**`, `contracts/**`, `apps/api/resources/help/**`, `packages/integration-sdk/**`, `tooling/simulators/**` or `packages/ui/**`; and `workflow_dispatch`
  - build with `PUBLIC_DOCS_*` variables and the `DOCS_HOSTED_REF` secret, run `check-docs all`, then `actions/upload-pages-artifact` with `apps/docs/dist` and `actions/deploy-pages`
  - `permissions: contents: read, pages: write, id-token: write`; `concurrency: docs-deploy`; the `github-pages` environment; actions pinned by SHA
- [ ] T030 Make tooling/docs/check_links.py skip `apps/docs/src/content/`, whose links are site routes checked by `starlight-links-validator`. Add or extend a case in tooling/docs/test_*.py

**Checkpoint**: the docs shell builds from the hosted commit (or the working tree), lints, passes axe, privacy and Lighthouse, and fails on a planted literal or denylisted name

---

## Phase 3: User Story 3 - Docs stay true to the hosted service (Priority: P2) (PR 1)

**Goal**: The generated reference and user guides, published only from the hosted
commit, failing closed, and hiding switched-off or unreleased features

**Independent Test**: change a contract description and a help guide sentence; they
publish only after `DOCS_HOSTED_REF` points at a commit containing them
(quickstart B1)

- [ ] T031 [P] [US3] Create apps/docs/src/components/docs/EventTypes.astro, which renders a section per entry in `IntegrationEvent`'s discriminator mapping (type name, then a table of its `data` properties with type and description). Create apps/docs/src/components/docs/WebhookDelivery.astro, which renders `webhooks.integrationEvent` (method, headers, signature header, body). Both read `.sources/integration-openapi.json`
- [ ] T032 [P] [US3] Create apps/docs/src/components/docs/AgentTools.astro, a table of name, access level and description from `.sources/contracts/agents/tools.json`
- [ ] T033 [P] [US3] Override Starlight's `PageTitle` (or `MarkdownContent`) in apps/docs/src/components/docs/GuideMeta.astro to show "Guide revision N" and "Requires: <capability>" on pages with `help_revision`
- [ ] T034 [US3] Create the first docs pages in apps/docs/src/content/docs/docs/:
  - apps/docs/src/content/docs/docs/index.mdx: overview with the two quickstarts (linked once they exist) and the reference sections
  - apps/docs/src/content/docs/docs/developers/events.mdx: the envelope, ordering by commit, cursors and checkpoints, at-least-once delivery and deduplication by event `id`, the 409 after a grant change, `<EventTypes/>` and `<WebhookDelivery/>`
  - apps/docs/src/content/docs/docs/changelog.mdx: a first entry for the hosted contract's `info.version` and SDK 0.5.0

  Then create apps/docs/changelog-baseline.json with `node scripts/check-docs.mjs changelog --update`: sorted `operations` and `event_types` from `meta.json`.
- [ ] T035 [US3] Implement and register four subcommands in apps/docs/scripts/check-docs.mjs:
  - `features`: fail when built HTML links to a route under a gated folder whose switch is off, or to a `draft: true` page (FR-006)
  - `reference` (SC-003, FR-010):
    - the generated API pages under `/docs/reference/api/` match `meta.json` `operations` one to one
    - each page shows its "Requires:" and "Rate limits:" lines
    - the events page lists exactly `meta.json` `event_types`
    - no file in `dist` contains the hosted commit, in full or as a 7-or-more-character prefix
  - `changelog` (FR-016):
    - fail when changelog.mdx has no entry naming `meta.json`'s `contract_version` and `sdk_version`
    - fail when `operations` or `event_types` differ from apps/docs/changelog-baseline.json
    - `--update` rewrites the baseline after an entry is added
  - `drafts`: list draft pages whose introducing commit (`git log --diff-filter=A --format=%H -- <file> | tail -1`) passes `git merge-base --is-ancestor <commit> "$DOCS_HOSTED_REF"`. Print paths only, never the commit
- [ ] T036 [P] [US3] Write apps/docs/tests/sources.test.ts and apps/docs/tests/check-reference.test.ts (Vitest) with fixtures:
  - the filter keeps exactly the integration paths and their referenced components
  - an unresolved `$ref` fails, and an operation missing `x-abilities` fails
  - descriptions gain "Requires:" and "Rate limits:" lines
  - guide front matter maps correctly, an unknown field fails, and `/help/` links are rewritten
  - `features`, `reference`, `changelog` (including a baseline mismatch and `--update`) and `drafts` behave as in T035
- [ ] T037 [US3] Update the OpenAPI item under "Integrations" in docs/roadmap.md: publishing the reference is delivered for the integration API by spec 013, and the other items remain
- [ ] T038 [P] [US3] Create docs/dev/docs-site.md and link it from the Development list in docs/README.md, so the rules outlive the spec freeze (constitution gate: docs change with behaviour). It covers:
  - local development: `pnpm --filter @iot-os/docs dev`, real values and `DOCS_HOSTED_REF` in `.local/docs/docs.env`, the denylist in `.local/docs/denylist.txt`, `DOCS_SOURCES=worktree`
  - the writing rules from contracts/content.md: hand-written pages, `draft: true`, gated folders and which loader does the gating (T016), generated pages and their sources
  - the checks (`literals`, `rename`, `names`, `features`, `reference`, `changelog`, `drafts`), with how to fix each failure, and refreshing the changelog baseline

  Later pull requests extend it (T050, T064).
- [ ] T039 [P] [US3] Create docs/ops/docs-site.md and link it from the Operations list in docs/README.md. Keep concrete hosts in the private inventory. It covers:
  - the deploy workflow, GitHub Pages settings, the docs subdomain's CNAME and HTTPS
  - the Actions variables and secrets
  - updating the hosted commit after a hosted deploy: `gh secret set DOCS_HOSTED_REF` and the same value in `.local/docs/docs.env`; run `check-docs drafts`; open a pull request publishing the drafts it lists, or dispatch `docs-deploy.yml` when there are none. Never paste the commit into issues, pull requests or logs
  - what to do when a deploy fails (the previous version stays online)
- [ ] T040 [US3] Owner: set up publishing (repository settings and .local/docs/docs.env), then confirm the PR 1 CI run builds from the hosted commit without printing it (search the job log for the first 7 characters):
  - set the Actions secret `DOCS_HOSTED_REF` (read by .github/workflows/ci.yml and .github/workflows/docs-deploy.yml) to the full hosted commit, and the same value in `.local/docs/docs.env`
  - set the `PUBLIC_DOCS_*` repository variables and the `DOCS_DENYLIST` secret
  - enable GitHub Pages with "GitHub Actions" as the source
  - add the docs subdomain's CNAME record and set it as the custom domain, with HTTPS enforced
- [ ] T041 [US3] Run [quickstart.md](quickstart.md) B1 (steps 1–10) and record the results in the PR 1 description. Tick T006–T041

**Checkpoint**: the docs build only from the hosted commit, with generated API, events, agent tools and guides, published on the docs subdomain

---

## Phase 4: User Story 1 - Connect a first device as a hardware engineer (Priority: P1) (PR 2)

**Goal**: A hardware engineer reaches stored readings and a confirmed command using
only the docs and the simulator kit

**Independent Test**: quickstart B2 against the local stack. `./taskw devices:test`
runs the same path.

- [ ] T042 [US1] In the local stack, prove the hardware path with tooling/simulators/sparkplug_simulator.py before any page is written (research.md R8). The simulator is one edge node (NBIRTH: `bdSeq`, `Node Control/Rebirth`, `Uptime`) with two downstream devices.
  1. Create two starter profiles:
     - "Simulated meter": `Voltage L1`, `Voltage L2`, `Voltage L3`, `Imported energy`, `Exported energy`, all Double
     - "Simulated light": controllable `Power` (Boolean), `Color` (String), `Mode` (String) and `Brightness` (Int32). `rgb-light` is the only device that accepts commands
  2. Preferred path: add a direct device and download its kit. Run `python sparkplug_simulator.py --config device-config.json --state-file state.json` from the kit folder. Then onboard `meter` and `rgb-light` from **Connect → Discovery** under that edge node with the two profiles. Confirm good stored readings, and confirm a `Power` command on `rgb-light`.
  3. Fallback, if discovery onboarding under a direct device's edge node isn't allowed: add the smallest flag to tooling/simulators/sparkplug_simulator.py that births one device's metrics as the edge node's own and accepts NCMD writes for them, with a test in tooling/simulators/test_*.py.

  Record the path used and the exact profile fields for T044.
- [ ] T043 [US1] In apps/docs/scripts/sources.mjs, build public/downloads/simulator-kit.zip from `.sources/tooling/simulators/` (sparkplug_simulator.py, sparkplug_b_pb2.py, requirements.txt) plus a generated README.md: Python 3.12 or later, a virtual environment, `pip install -r requirements.txt`, and the run command from T042
- [ ] T044 [US1] Write apps/docs/src/content/docs/docs/get-started/connect-a-device.mdx (US1 scenario 1):
  - prerequisites: an account with `Device.manage`, the two starter profiles from T042 with their parameter tables, the simulator kit, Python
  - the portal steps in order, following the path T042 proved. For the preferred path: **Devices → Add device**, direct, download the kit, start the simulator, then **Connect → Discovery** to onboard `meter` and `rgb-light` with their profiles, map, review, activate
  - what success looks like at each step, then sending a `Power` command to the light and seeing it confirmed
  - links to the Sparkplug reference
- [ ] T045 [P] [US1] Write apps/docs/src/content/docs/docs/hardware/sparkplug.mdx from services/runtime/internal/sparkplug and docs/reference/sparkplug.md (US1 scenario 2, FR-013). It lists what the runtime requires and rejects, as a checklist with one row per rule:
  - the `spBv1.0/<group>/…` namespace
  - NBIRTH `seq = 0` with `bdSeq`
  - DBIRTH metrics, aliases and datatypes
  - `Node Control/Rebirth`, and `STATE/<host_id>`
  - TLS 1.2 or later with the kit's CA, and credentials per gateway
  - NCMD and DCMD with acknowledgement, and why a command can end "uncertain"

  It links to the Eclipse specification.
- [ ] T046 [P] [US1] Write apps/docs/src/content/docs/docs/hardware/connection-kits.mdx (kit contents, TLS verification with the kit's CA, credentials private to one device, the broker host from config) and apps/docs/src/content/docs/docs/hardware/gateways.mdx (gateways, **Connect → Discovery**, discovered sources, one source per device) (US1 scenario 3)
- [ ] T047 [P] [US1] Write apps/docs/src/content/docs/docs/hardware/reference-firmware.mdx from firmware/waveshare-audio: how the board connects, births its metrics and handles a command. State that it is an example, not a supported product, and leave out network names and hosts (US1 scenario 4)
- [ ] T048 [P] [US1] Write apps/docs/src/content/docs/docs/hardware/adapters/vendor-mqtt.mdx (a gated folder): connect `vendor_water_meter.py` through an adapter with a sample decoder (US1 scenario 5)
- [ ] T049 [P] [US1] Write the concept pages in apps/docs/src/content/docs/docs/concepts/: organizations.mdx, devices-and-profiles.mdx, sources-and-gateways.mdx, measurements-and-quality.mdx (unknown is not zero, stale values are labelled), commands.mdx, alerts.mdx, automation.mdx and dashboards.mdx. Each links to its user guides
- [ ] T050 [P] [US1] Extend docs/dev/docs-site.md with the simulator kit: how it is built from the hosted commit, the two starter profiles, the onboarding path T042 proved, and the devices-suite step from T051
- [ ] T051 [US1] Add the simulator kit path to tooling/test-devices.mjs: build the kit with `DOCS_SOURCES=worktree node apps/docs/scripts/sources.mjs`, run it with an exported connection kit through the path T042 proved, and assert good-quality stored readings from `meter` and one confirmed `Power` command on `rgb-light`
- [ ] T052 [US1] Run [quickstart.md](quickstart.md) B2 and `./taskw devices:test`, and record the results in the PR 2 description. Tick T042–T052

---

## Phase 5: User Story 2, SDK publishing (Priority: P1) (PR 3)

**Goal**: The integration SDK is installable from npm (FR-021). It doesn't depend on
PRs 1 and 2.

**Independent Test**: quickstart B3: `npm view <name>` shows the version with
provenance, and `npm install <name>` works in an empty folder

- [ ] T053 [US2] In packages/integration-sdk/package.json:
  - set `name` to the owner's choice
  - add `license` (the owner's choice of `MIT` or `Apache-2.0`)
  - add `repository` (`{ type: "git", url, directory: "packages/integration-sdk" }`)
  - add `publishConfig: { access: "public", provenance: true }`

  Leave `homepage` to the workflow (T056).
- [ ] T054 [P] [US2] Add packages/integration-sdk/LICENSE with the chosen license text, the copyright holder being the company, and add `LICENSE` to `files`
- [ ] T055 [P] [US2] In packages/integration-sdk/README.md, replace the "available from the workspace or a local tarball; not published" paragraph and the tarball steps with `npm install <name>` and a pointer to the developer docs. Keep the rest
- [ ] T056 [US2] Create .github/workflows/sdk-publish.yml:
  - trigger: tags `sdk-v*`; permissions `contents: read`, `id-token: write`
  - setup-node with `registry-url: https://registry.npmjs.org`, then `pnpm install --frozen-lockfile`
  - `pnpm --filter <name> test`; fail unless the tag equals `sdk-v<version>`
  - `npm pkg set homepage=$PUBLIC_DOCS_URL` from repository variables
  - `npm publish --provenance --access public` through npm trusted publishing
  - actions pinned by SHA
- [ ] T057 [P] [US2] Add an "Integration SDK" section to docs/ops/release.md: bump `version`, add a changelog entry, tag `sdk-v<version>`, the trusted-publishing workflow, verifying provenance. In docs/features/integrations.md "SDK and sample host", replace "not published to a registry" with the npm package name and the docs link
- [ ] T058 [US2] Owner: register the npm organization and the trusted publisher for this repository and .github/workflows/sdk-publish.yml, then push tag `sdk-v0.5.0`. Run [quickstart.md](quickstart.md) B3, and record the results in the PR 3 description. Tick T053–T058

---

## Phase 6: User Story 2 - Build a first integration as a product engineer (Priority: P1) (PR 4)

**Goal**: A product engineer lists devices, reads values, follows the event feed and
verifies a webhook using only the docs

**Independent Test**: quickstart B4. `./taskw devices:test` runs every developer
sample against the fixture organization.

- [ ] T059 [P] [US2] Create the samples in apps/docs/samples/developer/. Each reads `IOT_API_BASE_URL`, `IOT_ORGANIZATION` and `IOT_APPLICATION_TOKEN` (plus `IOT_WEBHOOK_SECRET` for the webhook sample), and sets `allowInsecureLocalhost` only for loopback URLs:
  - list-devices.mjs
  - latest-telemetry.mjs
  - event-feed.mjs: checkpoint, then pages; stores the cursor atomically with its output; deduplicates by event `id`
  - webhook-verify.mjs: a local HTTP endpoint verifying the signature on the raw body with the SDK
- [ ] T060 [US2] Create tooling/verify-docs-samples.mjs, reusing the fixture from tooling/verify-integration-sdk.php:
  - create an application with `devices:read`, `telemetry:read`, `alerts:read` and `events:read` and issue a token
  - run each sample, asserting its output
  - send one signed test delivery to webhook-verify.mjs

  Call it from tooling/test-devices.mjs. In the CI `docs` job:
  - add `node --check` and `tsc --noEmit --allowJs --checkJs` over `samples/`
  - add a samples gate step (FR-015). On pull requests, if `git diff --name-only origin/main...HEAD` touches `apps/docs/samples/`, `packages/integration-sdk/`, `apps/api/app/Domain/Integrations/` or `contracts/openapi/supplements/integration*.yaml`, it fails unless the description records a `./taskw devices:test` run and its result. Pass the description through `env: PR_BODY: ${{ github.event.pull_request.body }}` and read `"$PR_BODY"` in the script, never interpolating it into the shell command, which would allow script injection
- [ ] T061 [US2] Write apps/docs/src/content/docs/docs/get-started/build-an-integration.mdx with `draft: true` (US2 scenario 1):
  - create an application in **Connect → Integrations** (needs `Device.view` and `Device.manage`)
  - choose abilities and devices; token expiry is 1–90 days and the token stays on the server
  - `npm install <name>`
  - the samples through `<Code>`, then the event feed and a webhook
- [ ] T062 [P] [US2] Write four pages in apps/docs/src/content/docs/docs/developers/ (US2 scenarios 2–4, FR-014):
  - applications.mdx: the abilities table; 1–100 granted devices; one active token, with rotation invalidating the previous one; a grant change invalidates the token and cursors and disables the webhook; 50 applications per organization
  - rate-limits-and-errors.mdx: 60 a minute per application and 240 per address, 429 with `Retry-After`, and the meaning of 401, 403, 404, 409, 422, 503 and 504
  - webhooks.mdx: verification on the raw body with the SDK and as language-neutral steps, retries and delivery history
  - sdk.mdx: client options, errors (`IotApiError`, `IotTransportError`, `IotContractError`), pagination, `AbortSignal`, timeouts, and no automatic retry
- [ ] T063 [P] [US2] Write apps/docs/src/content/docs/docs/developers/agents/connect.mdx and apps/docs/src/content/docs/docs/developers/agents/tools.mdx (a gated folder) (US2 scenario 5):
  - the connector address `<apiBaseUrl>/mcp`
  - the organization switch under **Settings → AI apps**
  - **Read** and **Read and drafts**, and that agents never perform live actions
  - `<AgentTools/>`
- [ ] T064 [P] [US2] Extend docs/dev/docs-site.md with the developer samples: where they live, how `<Code>` imports them, `tooling/verify-docs-samples.mjs`, and the samples gate, with what to write in the pull request description
- [ ] T065 [US2] After T058, remove `draft: true` from build-an-integration.mdx and add the SDK's npm publication to changelog.mdx (refresh the baseline if needed). Link both quickstarts from apps/docs/src/content/docs/docs/index.mdx
- [ ] T066 [US2] Run [quickstart.md](quickstart.md) B4 and `./taskw devices:test`, and record the results in the PR 4 description. Tick T059–T066

---

## Phase 7: Polish and cross-cutting concerns

- [ ] T067 [P] Add to docs/dev/gotchas.md only the surprises met during implementation, for example:
  - Starlight needs docs in a `docs/` content subfolder to serve them at `/docs`
  - `git archive` of the hosted commit needs `fetch-depth: 0` in CI
  - axe contrast failures during colour fades
- [ ] T068 Run [quickstart.md](quickstart.md) B5: two people who did not build the platform each complete one quickstart against the hosted service, using only the published docs. Record their times and where they got stuck in a follow-up pull request that fixes what they hit (SC-001, SC-002)
- [ ] T069 After the last implementation pull request merges, rerun quickstart B1 against the published docs, and confirm SC-003 to SC-005. Then freeze specs/013-website-developer-docs/ (docs/dev/specs.md), leaving the lasting behaviour in docs/dev/docs-site.md, docs/ops/docs-site.md, ADR-020 and ADR-021

---

## Dependencies and execution order

### Phase dependencies

- **Rescope (PR 0)**: none. It blocks everything.
- **Setup, Foundational and US3 (PR 1)**: depend on PR 0, and block US1 and the US2
  docs.
- **PR 1's CI and deploy** need the `DOCS_HOSTED_REF` secret and Pages set up
  (T040). Until then, CI builds use `DOCS_SOURCES=worktree`, like forks.
- **US1 (PR 2)**: depends on PR 1.
- **SDK publishing (PR 3)**: depends only on PR 0 and the owner's npm decisions. It
  can merge at any point.
- **US2 developer docs (PR 4)**: depends on PR 1. T065 waits for PR 3 to be
  published.
- **Polish**: after PR 4.

### Within each pull request

Sources and checks come before the pages they guard, and code before its tests.
Each pull request updates docs/dev/docs-site.md or docs/ops/docs-site.md for the
behaviour it adds (constitution: docs change with behaviour). The quickstart run and
recorded results come last. Before opening each pull request, run:
- `pnpm --filter @iot-os/docs lint test build`
- `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint`
- `python3 tooling/docs/check_links.py`

### Parallel opportunities

- PR 0: T002 and T003 after T001.
- PR 1: T007–T010 together; T017–T019 and T022–T027 together after T016; T031–T033
  together; T036 alongside T035; T038 and T039 together.
- PR 2: T045–T050 together after T042.
- PR 3 by a second person at any time after PR 0.
- PR 4: T059, T062, T063 and T064 together.

## Parallel example: User Story 1

```bash
Task: "Write hardware/sparkplug.mdx in apps/docs/src/content/docs/docs/hardware/"
Task: "Write hardware/connection-kits.mdx and hardware/gateways.mdx"
Task: "Write hardware/reference-firmware.mdx from firmware/waveshare-audio"
Task: "Write hardware/adapters/vendor-mqtt.mdx (gated)"
Task: "Write the eight concept pages in apps/docs/src/content/docs/docs/concepts/"
```

## Implementation strategy

### MVP first

1. PR 0 (ADR-021, constitution, rescope), then PR 1 (docs foundation and generated
   reference).
2. **Stop and validate**: quickstart B1. The docs subdomain serves the API reference,
   events, agent tools and user guides from the hosted commit. That's already enough
   for the marketing site to link its platform claims to.

### Incremental delivery

1. PR 2: hardware docs (US1).
2. PR 3, any time: SDK on npm.
3. PR 4: developer docs (US2). The developer quickstart leaves draft once the SDK is
   published.
4. Polish: the usability check with outside engineers, then freeze.
