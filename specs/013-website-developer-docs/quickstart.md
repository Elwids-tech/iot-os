# Quickstart: Marketing Website and Developer Documentation

Part A is the everyday workflow for changing the site. Part B lists the validation
scenarios each pull request runs (constitution IX). The site is not part of the
Compose stack, so "where it runs" means `wrangler dev` locally and the pull request's
preview URL, plus the rebuilt local stack for the samples.

## Prerequisites

- Node and pnpm as pinned (`./tooling/bootstrap`), then `pnpm install`.
- Placeholder configuration works out of the box. To check against real values, put
  the `PUBLIC_SITE_*` variables and `WEBSITE_HOSTED_REF` in
  `.local/website/website.env`, and the names denylist in
  `.local/website/denylist.txt`. Private files live under `.local/`, never in the app
  folder.
- For the samples (Part B, scenario 6): the dev stack from `./taskw devices:setup`
  and `./taskw devices:up`.

## Part A: working on the site

1. `pnpm --filter @iot-os/website dev` serves marketing pages and docs with hot
   reload. Generated sources come from the working tree in development
   (`WEBSITE_SOURCES=worktree`), so a help guide or contract edit shows immediately.
   Drafts are visible.
2. Write marketing copy with `<Claim>` around every capability statement, and
   docs pages under `src/content/docs/docs/` following [contracts/content.md](contracts/content.md)
   (its lasting copy is `docs/dev/website.md`).
3. Runnable code goes in `samples/` and is imported into the page.
4. `pnpm --filter @iot-os/website lint` runs `astro check`, `check-ui` and
   `check-site`. `pnpm --filter @iot-os/website test` runs the script and Worker
   tests.
5. After a hosted deploy:
   1. Update the `WEBSITE_HOSTED_REF` secret (`gh secret set WEBSITE_HOSTED_REF`) and
      the value in `.local/website/website.env`. Never paste the commit anywhere
      public.
   2. Run `pnpm --filter @iot-os/website exec node scripts/check-site.mjs drafts`.
   3. Publish the drafts it lists by pull request, changing `hosted-release.json`
      only if a feature switch changed, or dispatch `website-deploy.yml` when there
      is nothing to publish.
6. When a changelog entry is added, refresh the baseline with
   `node scripts/check-site.mjs changelog --update` in the same pull request.

## Part B: validation scenarios

### 1. Marketing pages and honesty checks (PR 1)

1. `pnpm --filter @iot-os/website build`, then `pnpm --filter @iot-os/website
   preview`. Every route in the [plan](plan.md#marketing-pages-us1) renders at 375 px
   and 1440 px, in light and dark, with no horizontal scroll. **Request a demo** and
   **Sign in** are on every page (US1 scenario 2).
2. Turn JavaScript off: every page is readable, and `/contact` shows the contact
   address.
3. Each of these must fail `lint` or `build` with a message naming the file:
   - a literal configured domain in a page
   - `40%` outside a `<Claim>`
   - a `<Claim id>` with no `source`
   - a name from the denylist in page text
4. `pnpm --filter @iot-os/website test:e2e` reports no serious or critical axe
   violations on any sitemap route. The privacy spec finds no `Set-Cookie`, an empty
   `document.cookie` and no request to another origin (FR-008). `lhci autorun`
   reports LCP ≤ 2,000 ms on the marketing routes (SC-004).
5. `docs/dev/website.md` exists, is linked from `docs/README.md`, and describes the
   checks above (constitution: docs change with behaviour).

### 2. Inquiries (PR 2)

1. Run `pnpm --filter @iot-os/website exec wrangler d1 migrations apply DB --local`,
   then `pnpm --filter @iot-os/website exec wrangler dev --test-scheduled`.
2. Submit `/contact` in the browser. You should see the on-screen confirmation, a
   `pending` → `delivered` row in local D1, and the captured email in the Wrangler
   output with `Reply-To` set to the visitor and the source page in the body (SC-005).
3. Submit the same `id` twice; you should get one row and one email.
4. Fill the honeypot, or submit within 3 seconds: you get 202, with no row and no
   email.
5. Send six requests in a minute: the sixth gets 429 with `Retry-After`, and the
   form shows the contact address.
6. Restart with `wrangler dev --test-scheduled --var MAIL_FAIL:1` and submit: the
   row stays `pending`. Run the cron with
   `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` and see `attempts` and
   `next_attempt_at` advance. Restart without the flag, run it again, and the row is
   `delivered`.
7. The contract fixtures in `contracts/website/fixtures/` pass and fail in both the
   form's validation tests and the Worker tests.
8. `docs/ops/website.md` describes the delivery check and failed inquiries, and its
   query works against local D1 (`--local` instead of `--remote`).

### 3. Preview deploy and redirects (PR 3)

1. The pull request's preview URL serves the site and the form. A submission
   reaches the team address.
2. For each path in `src/redirects.ts` and each same-path page, `curl -sI
   <preview>/<path>` answers 200 or 301 to a page that answers 200 (SC-006).

### 4. Docs follow the hosted release (PR 4)

1. With `WEBSITE_HOSTED_REF` set to the current hosted commit, build. The
   `reference` check passes:
   - the API reference lists exactly the operations under `/integration/v1` in that
     commit's contract, each with its "Requires:" and "Rate limits:" lines (FR-013)
   - the events page lists the contract's `IntegrationEventType` values (SC-003)
   - `grep -r` for the commit's first 7 characters in `dist` finds nothing
2. Set `WEBSITE_HOSTED_REF` to an older commit with a different contract
   `info.version`, and build. The reference and changelog check follow that commit,
   and a change merged since does not appear (US4 scenario 1).
3. Add an operation or event type to a copy of the contract (with
   `WEBSITE_SOURCES=worktree`). `check-site changelog` fails until a changelog entry
   is added and `--update` refreshes the baseline (FR-019).
4. Corrupt a `$ref` in a copy of the contract with `WEBSITE_SOURCES=worktree`. The
   build fails and names the reference (US4 scenario 2).
5. Set `features.adapters` to `false`. No page under `adapters/`, no adapter claim
   and no link to one is in `dist`, and a page linking to one fails the build.
6. A user guide's page shows the same revision as the portal's help panel (US4
   scenario 4). Its `/help/<slug>` links open the matching docs pages, and the guides
   appear in the sidebar grouped by section.
7. The docs index, a page in each section and a generated API page show **Sign in**
   and **Request a demo** in the header (FR-002).

### 5. Hardware path (PR 5)

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

### 6. Developer path (PR 7)

1. `./taskw devices:test` runs `tooling/verify-website-samples.mjs`. Each sample in
   `samples/developer/` runs against the fixture organization: it lists granted
   devices, reads latest values, follows the event feed from a checkpoint and
   verifies a signed webhook delivery.
2. With the SDK published (PR 6), `npm install <package>` in an empty folder,
   followed by the quickstart, works against the local stack with
   `allowInsecureLocalhost` (SC-002 dry run).
3. On a pull request that changes a file in `apps/website/samples/` without a
   recorded `./taskw devices:test` run in its description, the CI samples gate fails.
   Adding the run and its result makes it pass (FR-018).

### 7. Usability check (before cutover)

Two people who did not build the platform each follow one quickstart against the
hosted service, with only the published docs. Record each one's time to finish and
where they got stuck in the pull request that removes the quickstarts' draft flags
(SC-001, SC-002).

### 8. Cutover (owner actions done)

1. Lower the apex record's TTL to 300 s a day ahead. Switch the apex and `www` to the
   Worker.
2. Repeat scenario 3's `curl` loop against production, and send one real inquiry.
3. Rollback drill on the preview domain: repoint, confirm the old site answers, and
   restore. Keep the old server for 30 days (FR-023).
