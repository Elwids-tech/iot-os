# Quickstart: Developer Documentation and SDK Publishing

Part A is the everyday workflow for changing the docs. Part B lists the validation
scenarios each pull request runs (constitution IX). The docs are not part of the
Compose stack, so "where it runs" means `astro preview` locally and the published
GitHub Pages site, plus the rebuilt local stack for the samples.

## Prerequisites

- Node and pnpm as pinned (`./tooling/bootstrap`), then `pnpm install`.
- Placeholder configuration works out of the box. To check against real values, put
  the `PUBLIC_DOCS_*` variables and `DOCS_HOSTED_REF` in `.local/docs/docs.env`, and
  the names denylist in `.local/docs/denylist.txt`. Private files live under
  `.local/`, never in the app folder.
- For the samples (Part B, scenarios 2 and 4): the dev stack from
  `./taskw devices:setup` and `./taskw devices:up`.

## Part A: working on the docs

1. `pnpm --filter @iot-os/docs dev` serves the docs with hot reload. Generated
   sources come from the working tree in development (`DOCS_SOURCES=worktree`), so a
   help guide or contract edit shows immediately. Drafts are visible.
2. Write docs pages under `src/content/docs/docs/` following
   [contracts/content.md](contracts/content.md) (its lasting copy is
   `docs/dev/docs-site.md`).
3. Runnable code goes in `samples/` and is imported into the page.
4. `pnpm --filter @iot-os/docs lint` runs `astro check`, `check-ui` and the
   `literals` check. `pnpm --filter @iot-os/docs test` runs the script tests.
5. After a hosted deploy:
   1. Update the `DOCS_HOSTED_REF` secret (`gh secret set DOCS_HOSTED_REF`) and the
      value in `.local/docs/docs.env`. Never paste the commit anywhere public.
   2. Run `pnpm --filter @iot-os/docs exec node scripts/check-docs.mjs drafts`.
   3. Publish the drafts it lists by pull request, changing `hosted-release.json`
      only if a feature switch changed, or dispatch `docs-deploy.yml` when there is
      nothing to publish.
6. When a changelog entry is added, refresh the baseline with
   `node scripts/check-docs.mjs changelog --update` in the same pull request.

## Part B: validation scenarios

### 1. Docs foundation and generated reference (PR 1)

1. `pnpm --filter @iot-os/docs build`, then `pnpm --filter @iot-os/docs preview`.
   The docs render at 375 px and 1440 px, in light and dark, with no horizontal
   scroll. Every page's header links to the marketing site and the portal's sign-in
   (FR-002), and its footer has **Report a problem with this page** pointing at the
   contact page with the page address (FR-017).
2. Turn JavaScript off: every page is readable; only search needs scripting.
3. With `DOCS_HOSTED_REF` set to the current hosted commit, the `reference` check
   passes:
   - the API reference lists exactly the operations under `/integration/v1` in that
     commit's contract, each with its "Requires:" and "Rate limits:" lines (FR-010)
   - the events page lists the contract's `IntegrationEventType` values (SC-003)
   - `grep -r` for the commit's first 7 characters in `dist` finds nothing
4. Set `DOCS_HOSTED_REF` to an older commit with a different contract `info.version`,
   and build. The reference and changelog check follow that commit, and a change
   merged since does not appear (US3 scenario 1).
5. Each of these must fail `lint` or `build` with a message naming the file:
   - a literal configured domain in a page
   - a name from the denylist in page text
   - a corrupted `$ref` in a copy of the contract (with `DOCS_SOURCES=worktree`)
     (US3 scenario 2)
   - an operation or event type added to a copy of the contract without a changelog
     entry (FR-016)
   - a link to an `adapters/` page while `features.adapters` is `false` (FR-006)
6. `node scripts/check-docs.mjs rename` passes, and fails if the default product name
   is written literally in a page (SC-005).
7. A user guide's page shows the same revision as the portal's help panel (US3
   scenario 4). Its `/help/<slug>` links open the matching docs pages, and the guides
   appear in the sidebar grouped by section.
8. `pnpm --filter @iot-os/docs test:e2e` reports no serious or critical axe
   violations on any sitemap route. The privacy spec finds no `Set-Cookie`, an empty
   `document.cookie` and no request to another origin (FR-008). `lhci autorun`
   reports LCP ≤ 2,000 ms on the representative pages (SC-004).
9. After merge, `docs-deploy.yml` publishes to GitHub Pages:
   - the platform domain's root and `www` serve the landing page over HTTPS
   - the portal, API and broker still answer at their usual addresses
   - a deliberately failing build on a branch never reaches the deploy step (FR-019)
10. The landing page (US4, SC-006): sign-in, each published quickstart, the API
    reference and the company website are each one click away. A draft quickstart
    isn't linked, and no industry product, outcome figure or customer name appears.
11. `docs/dev/docs-site.md` and `docs/ops/docs-site.md` exist, are linked from
    `docs/README.md`, and describe the checks, the hosted commit update and the
    platform domain's DNS (constitution: docs change with behaviour).

### 2. Hardware path (PR 2)

1. In the local portal, create the two starter profiles from the hardware
   quickstart ("Simulated meter" and "Simulated light"), add a direct device and
   download the connection kit.
2. Download the simulator kit from the local docs build, unzip it beside the
   connection kit and run the command on the page. Then follow the page's onboarding
   path: by default, **Connect → Discovery** shows `meter` and `rgb-light` under the
   edge node, and both are onboarded with their profiles. Mapping suggestions match,
   activation completes, and readings are stored with good quality. A `Power`
   command sent to the light is confirmed (SC-001 dry run).
3. `./taskw devices:test` runs the same path unattended.

### 3. SDK publishing (PR 3)

1. Push the tag `sdk-v<version>`. `sdk-publish.yml` builds, tests, checks the tag
   against `version` and publishes with provenance.
2. `npm view <package>` shows the version, the license and provenance, and
   `npm install <package>` works in an empty folder (US2 scenario 6).

### 4. Developer path (PR 4)

1. `./taskw devices:test` runs `tooling/verify-docs-samples.mjs`. Each sample in
   `samples/developer/` runs against the fixture organization: it lists granted
   devices, reads latest values, follows the event feed from a checkpoint and
   verifies a signed webhook delivery.
2. With the SDK published, `npm install <package>` in an empty folder, followed by
   the quickstart, works against the local stack with `allowInsecureLocalhost`
   (SC-002 dry run).
3. On a pull request that changes a file in `apps/docs/samples/` without a recorded
   `./taskw devices:test` run in its description, the CI samples gate fails. Adding
   the run and its result makes it pass (FR-015).

### 5. Usability check (before announcing the docs)

Two people who did not build the platform each follow one quickstart against the
hosted service, with only the published docs. Record each one's time to finish and
where they got stuck in the pull request that fixes what they hit (SC-001, SC-002).
