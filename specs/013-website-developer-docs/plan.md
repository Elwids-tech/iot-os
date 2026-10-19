# Implementation Plan: Developer Documentation and SDK Publishing

**Branch**: `spec/013-rescope-developer-docs` | **Date**: 2026-10-17, revised 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-website-developer-docs/spec.md`

**Revision**: the marketing website moved to its own repository
([ADR-021](../../docs/adr/ADR-021-developer-docs-only.md)). This plan now covers the
developer docs and SDK publishing only. The website's earlier design (Cloudflare,
the inquiry Worker, redirects and cutover) stays in [research.md](research.md) as
input for that repository.

## Summary

A new workspace, `apps/docs`, holds the public developer docs: a static Astro and
Starlight site served under `/docs` on its own subdomain. It uses the `@iot-os/ui`
tokens and type scale, and is published to GitHub Pages independently of the hosted
platform.

The docs combine hand-written guides with reference generated at build time. The
generated parts come from the commit the hosted service runs. That commit is a CI
secret (and a `.local/` value for local builds), so the public repository never shows
it. Only the hosted feature switches are committed, in `apps/docs/hosted-release.json`.
The generated parts are:
- the integration API and events from the OpenAPI contract
- agent tools from the tool catalogue
- user guides from the in-product help

Build checks enforce the spec's honesty rules:
- no configured values written literally, and a working rename
- no private names
- no links to switched-off or unreleased features
- a reference that matches the contract
- a changelog that keeps up

The integration SDK is published to npm so the developer quickstart can tell people
to install it.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 22.23 (`.nvmrc`). Astro 7.x, Starlight
0.42.x, React 19 islands where needed.

**Primary Dependencies**:
- Astro, `@astrojs/starlight`, `@astrojs/react`, `@tailwindcss/vite` 4
- `starlight-openapi`, `starlight-links-validator`
- `@iot-os/ui` (workspace)

**Storage**: none. The docs are static files.

**Testing**:
- Vitest for `scripts/`
- Playwright with `@axe-core/playwright` against `astro preview`
- Lighthouse CI (mobile preset)
- `check-docs.mjs`
- `./taskw devices:test` for the samples against the local stack

**Target Platform**: evergreen browsers at 320 px and up, with JavaScript optional
except for search; GitHub Pages.

**Project Type**: static documentation site in the existing pnpm and Turbo monorepo.

**Performance Goals**: LCP ≤ 2,000 ms on Lighthouse's mobile preset for
representative docs pages (SC-004).

**Constraints**:
- Public repository: real domains and the names denylist arrive as CI variables or
  secrets, never as commits. For local builds they live in `.local/docs/docs.env` and
  `.local/docs/denylist.txt`, never in the app folder (constitution: private
  environment files live under `.local/`).
- The hosted commit never appears in the repository, in workflow logs or in built
  pages ([R4](research.md#r4-docs-follow-the-hosted-release)).
- No cookies or third-party scripts.
- Docs generated only from the hosted commit.

**Scale/Scope**:
- about 30 hand-written docs pages
- 27 generated user guides, 16 API paths, 8 event types and the agent tools
- 1 new CI job, 2 new workflows (docs deploy, SDK publish)

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. The docs never call the platform. They are built from files in this repository. |
| II. Immutable versions | Pass. Nothing versioned is touched. The docs pin to the hosted commit through the hosted release record. |
| III. Tenant isolation | Pass. No tenant data is read or shown. Docs are not personalised and explain where each value is found in the portal. |
| IV. Contracts first | Pass. The reference is generated from `contracts/openapi` at the hosted commit and fails closed. No public HTTP API changes, so `packages/api-client` is unchanged. |
| V. AI proposes | Pass. No AI features. The agent docs describe proposals and the never-live-actions rule as built. |
| VI. Show uncertainty | Pass. Switched-off and unreleased features are not published. The reference must match the contract, and a failed generation leaves the previous version online. |
| VII. Durable messaging | Not applicable. No messages or storage. |
| VIII. One design system | Pass. Kit tokens and type scale, Starlight mapped onto them, kit controls for any island, and `check-ui` extended to `.astro` and run on the docs. No marketing components and no new kit components. |
| IX. Verified where it runs | Pass. No container changes. Each change is checked with `astro preview` and the CI build, then on the published Pages site. Samples run against the rebuilt local stack in `./taskw devices:test`. |

**Pull request gates**: every implementation pull request updates the lasting docs
for the behaviour it adds, so nothing depends on `specs/` after the freeze:
- `docs/dev/docs-site.md`, created in PR 1 (local development, checks, writing rules,
  generated pages) and extended in PRs 2 and 4
- `docs/ops/docs-site.md`, created in PR 1 (deploy, the hosted commit update, the
  docs subdomain)
- `docs/ops/release.md` and `docs/features/integrations.md` for the SDK in PR 3

**Engineering constraints**: ADR-021 amends ADR-020, and the constitution's stack
line names the docs site (1.0.4), in this documents pull request. Secrets stay out
of git:
- the hosted commit and denylist are GitHub Actions secrets; real domains are Actions
  variables
- locally, all of them live in `.local/docs/`

**Post-design re-check**: unchanged. The design adds no tenant data path, no
platform API and no product container.

## Design

### Workspace and configuration

- **`apps/docs`** (`@iot-os/docs`) joins the pnpm workspace and Turbo with `dev`,
  `build` (`sources.mjs`, `astro build`, `check-docs all`), `preview`, `lint`
  (`astro check`, `check-ui` on `src`, `check-docs literals`), `test` and `test:e2e`
  scripts.
- **`docs.config.ts`**: the only place for the product name, company name, docs URL,
  marketing-site URL and contact page, portal URL, API base URL and broker host.
  Each value reads a `PUBLIC_DOCS_*` variable and defaults to an `example.com`
  placeholder, so forks build and real values exist only in the deploy environment
  ([contract](contracts/docs-config.md)). For local builds, `docs.config.ts` loads
  `.local/docs/docs.env` with `process.loadEnvFile` when that file exists.
- **Hosted release record**:
  - the committed `apps/docs/hosted-release.json` holds only `schema_version`,
    `features.adapters` and `features.agent_access`
    ([schema](contracts/hosted-release.schema.json))
  - the commit comes from `DOCS_HOSTED_REF`: an Actions secret in CI, so it is masked
    in public logs, and `.local/docs/docs.env` locally
  - no script prints it and nothing in `dist` contains it
  - `content.config.ts` excludes `docs/**/adapters/**` and `docs/**/agents/**` when
    their switch is off. PR 1 first checks that Starlight's `docsLoader` accepts a
    glob pattern; if it doesn't, the collection uses Astro's `glob()` loader with
    `docsSchema`
- **`scripts/sources.mjs`** (the first step of `build`): `git archive` from the
  hosted commit into `.sources/`. It then generates:
  - the filtered integration contract. Each operation's `x-abilities` and
    `x-rate-limits` are written into its description as "Requires" and "Rate limits"
    lines, because the OpenAPI plugin does not render vendor extensions (FR-010)
  - the user guide pages under `src/content/docs/docs/guides/` (ignored). Starlight
    routes follow the content path, so docs live in a `docs/` subfolder to be served
    at `/docs`
  - the simulator kit zip in `public/downloads/`
  - `.sources/meta.json` with the contract's `info.version`, the SDK version, the
    integration operations (method and path), the event types and the guide sections.
    It never includes the commit
- `.gitignore` gains `apps/docs/.sources/`, the generated guides directory and
  `apps/docs/public/downloads/`.

### Docs

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
  confirmed command. PR 2 proves the onboarding path before the page is written
  ([R8](research.md#r8-running-the-samples)).
- **Sparkplug reference**: written from `services/runtime/internal/sparkplug` and
  `docs/reference/sparkplug.md`, with a checklist of each requirement and rejection.
- **Developer quickstart and SDK pages**: show `samples/developer/*.mjs`. They stay
  `draft: true` until the SDK is on npm (FR-021).
- **Header**: a Starlight `Header` override adds links to the marketing site and the
  portal's sign-in (FR-002).
- **Footer**: every docs page gets **Report a problem with this page**, linking to
  the marketing site's contact page with `?type=question&page=<path>` (FR-017).
- **Theme**: `src/styles/starlight.css` maps Starlight's variables onto the kit
  tokens.

### Checks and CI

- **`check-docs.mjs`**: `literals`, `rename`, `names`, `features`, `reference`,
  `changelog` and `drafts` ([R7](research.md#r7-build-checks)). The `rename` check is
  described in the [docs configuration contract](contracts/docs-config.md).
  - `reference` checks that the generated API pages match the filtered contract's
    operations one to one, that each page shows its abilities and rate limits, that
    the events page lists exactly the contract's event types, and that `dist` never
    contains the hosted commit (SC-003)
  - `changelog` compares the operations and event types in `meta.json` with the
    committed `apps/docs/changelog-baseline.json`. A difference fails until the pull
    request adds a changelog entry and refreshes the baseline with
    `check-docs changelog --update`
- **Playwright `privacy.spec.ts`**: on every sitemap route, no `Set-Cookie`, an empty
  `document.cookie` and no request to another origin (FR-008).
- **CI job `docs`** in `.github/workflows/ci.yml`:
  1. install, with `fetch-depth: 0`
  2. `lint` (astro check, check-ui, check-docs literals)
  3. unit tests
  4. `build`, with `DOCS_HOSTED_REF` from secrets. Forks and pull requests without
     the secret use `DOCS_SOURCES=worktree`, with a notice
  5. `check-docs rename`
  6. Playwright axe and privacy over the sitemap
  7. Lighthouse CI on representative docs pages
  8. sample syntax and type check
  9. the samples gate: if the pull request changes `apps/docs/samples/`,
     `packages/integration-sdk/` or the integration API, its description must record
     a `./taskw devices:test` run (FR-015)
- **`.github/workflows/docs-deploy.yml`**: on push to `main` and manual dispatch,
  build with production variables and `DOCS_HOSTED_REF`, run `check-docs all`, then
  `actions/upload-pages-artifact` and `actions/deploy-pages`. Permissions:
  `contents: read`, `pages: write`, `id-token: write`. Concurrency group
  `docs-deploy`. Actions pinned by commit SHA, as in the existing workflows. A
  `public/CNAME` file isn't needed: the custom domain is set in the repository's
  Pages settings.
- **`tooling/docs/check_links.py`** skips `apps/docs/src/content/`. Those links are
  site routes, checked by `starlight-links-validator`.

### SDK publishing (FR-021)

- **Package**: `packages/integration-sdk/package.json` gains `license`,
  `repository` and `publishConfig.provenance`, plus a `LICENSE` file. `homepage` is
  set by the publish workflow from the docs URL variable. The README replaces "not
  published" with `npm install` and the docs link.
- **Workflow**: `.github/workflows/sdk-publish.yml` runs on `sdk-v*` tags. It builds
  and tests the SDK, checks that the tag matches `version`, and publishes with npm
  trusted publishing.
- **Owner decisions first**: the scope and name, and MIT or Apache-2.0
  ([R9](research.md#r9-publishing-the-sdk)).

## Pull requests

Each one is opened from `main` after the previous one merges. **They are not
stacked.**

0. **Rescope** (this branch): ADR-021, the ADR index, the constitution stack line
   (1.0.4), and this revised spec, plan and tasks. Documents only.
1. **Docs foundation and generated reference** (US3, part of US2):
   - the workspace, `docs.config.ts`, the hosted release record, `sources.mjs`
   - Starlight with the header, footer and theme
   - the API, events and agent-tools reference, the user guides, the changelog and
     its baseline
   - `check-docs.mjs`, `check-ui` reading `.astro`, the links validator and the
     `check_links.py` exclusion
   - the CI `docs` job (axe, privacy, Lighthouse) and `docs-deploy.yml`
   - `docs/dev/docs-site.md`, `docs/ops/docs-site.md`, and the AGENTS.md and
     `docs/README.md` repository map rows
2. **Hardware docs** (US1): the quickstart, the Sparkplug reference, the gateway,
   connection kit, firmware and gated adapter guides, the concept pages, the
   simulator kit download, the simulator path in `./taskw devices:test`, and the kit
   section of `docs/dev/docs-site.md`.
3. **SDK publishing** (FR-021): package metadata, `LICENSE`, the publish workflow,
   and the SDK release steps in `docs/ops/release.md` and
   `docs/features/integrations.md`, after the owner's scope and license decision.
   Independent of 1 and 2.
4. **Developer docs** (US2): the quickstart, applications and tokens, webhooks, SDK
   pages, rate limits and errors, gated agent docs, the `samples/developer` files,
   `tooling/verify-docs-samples.mjs` in the devices suite, the CI samples gate, and
   the samples section of `docs/dev/docs-site.md`. The quickstart leaves draft once
   3 has published.

The roadmap's OpenAPI item ("publish the reference") is marked delivered for the
integration API by PR 1.

## Owner actions

- **Docs subdomain**: a CNAME record at the company's DNS pointing at GitHub Pages,
  Pages enabled with "GitHub Actions" as the source, and the custom domain set with
  HTTPS enforced.
- **Marketing site URLs** (home and contact page) for the header and the "Report a
  problem" link. Placeholders work until the new site is live.
- **SDK**: npm organization, scope and name, and MIT or Apache-2.0.
- **Hosted release**: whether adapters and agent access are on in the hosted
  service, which sets the first `hosted-release.json`. Also the hosted commit, set as
  the `DOCS_HOSTED_REF` secret and in `.local/docs/docs.env`, and updated after each
  hosted deploy.
- **Names denylist** for the `names` check, as the `DOCS_DENYLIST` secret.

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
│   ├── docs-config.md
│   ├── hosted-release.schema.json
│   └── content.md
├── checklists/requirements.md
└── tasks.md
```

### Source code (repository root)

```text
apps/docs/
├── astro.config.mjs         # Starlight at /docs, React, Tailwind, OpenAPI, links validator
├── docs.config.ts           # the only home of names, domains and addresses
├── hosted-release.json      # hosted feature switches (the commit is the DOCS_HOSTED_REF secret)
├── changelog-baseline.json  # operations and event types as of the last changelog entry
├── public/downloads/        # simulator kit (generated at build)
├── samples/developer/       # runnable quickstart and SDK samples
├── scripts/
│   ├── sources.mjs          # git archive from the hosted commit, generate reference inputs
│   └── check-docs.mjs       # literals, rename, names, features, reference, changelog, drafts
├── src/
│   ├── content.config.ts
│   ├── content/docs/docs/   # hand-written docs served at /docs (guides/ is generated, ignored)
│   ├── components/docs/     # Header, Footer, EventTypes, WebhookDelivery, AgentTools, GuideMeta
│   └── styles/              # docs.css (kit globals), starlight.css (token mapping)
└── tests/                   # Vitest (scripts), Playwright (axe, privacy)

packages/integration-sdk/    # license, metadata, README
packages/ui/scripts/check-ui.mjs   # also reads .astro
tooling/verify-docs-samples.mjs
.github/workflows/{ci.yml, docs-deploy.yml, sdk-publish.yml}
docs/adr/ADR-021-developer-docs-only.md, docs/dev/docs-site.md, docs/ops/docs-site.md
.local/docs/docs.env, .local/docs/denylist.txt   # ignored, local only
```

**Structure Decision**: one new app in the existing `apps/*` workspace, named for
what it is. Shared inputs stay where they live today (`contracts/`,
`apps/api/resources/help`, `tooling/simulators`) and are read at the hosted commit,
never copied into the repository.

## Complexity Tracking

No constitution violations to justify. The site-local marketing components that
needed an exception in the 2026-10-17 plan left with the marketing site.
