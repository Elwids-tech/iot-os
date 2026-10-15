# Project workflow

IoT OS: React portal/admin, Laravel control plane, Go data plane, per-tenant
adapter runtimes. Read [docs/README.md](docs/README.md) first; decisions are in the
[ADR index](docs/adr/README.md). The code is the source of truth: when a doc
disagrees with it, fix the doc. New features follow Spec Kit
([docs/dev/specs.md](docs/dev/specs.md)); every plan is checked against the
[constitution](.specify/memory/constitution.md).

## Repository map

- `apps/api` Laravel API and workers (`app/Domain/<Domain>`); `apps/portal`, `apps/admin` React apps
- `services/runtime` Go runtime (Sparkplug, storage, rules, DAGs, commands); `services/adapters` adapter manager
- `packages/ui` design-system kit; `packages/charts`, `api-client`, `workflow-editor`, `integration-sdk`
- `contracts/` JSON Schemas, fixtures, Sparkplug protobuf shared across languages
- `deploy/compose` dev stack; `deploy/release` + `tooling/release` single-node releases
- `tooling/` bootstrap, test harnesses, verification scripts, simulators

## Commands

- Prefix shell commands with `rtk`; use `rtk proxy` when unfiltered output is needed.
- Setup: `./tooling/bootstrap`, `./taskw devices:setup`, `./taskw devices:up` (full stack); `./taskw doctor`.
- Checks: `./taskw lint`, `./taskw test`, `cd apps/api && php artisan test --compact`,
  `pnpm --filter @iot-os/portal lint` (and admin), `./taskw devices:test`.
- Rebuild one service, keeping the stack's env files and overlays:
  `rtk proxy docker compose --env-file .env --env-file .local/devices/devices.env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml -f deploy/compose/compose.devices.yml up -d --build --no-deps <services>`
  ([which services](docs/dev/local-setup.md#rebuild-one-service)).

## Rules

- After making changes, rebuild the affected local containers and verify the
  running application before reporting completion. Follow
  [.agents/skills/local-container-verification/SKILL.md](.agents/skills/local-container-verification/SKILL.md).
  Rebuild again after any subsequent implementation fix.
- Preserve the user's unsaved browser edits when verifying rebuilt pages.
- Use suitable shared shadcn components for each interaction. Search within a
  selector belongs in a searchable selector, not a separate search field paired
  with a dropdown. Standalone search fields are appropriate for directory and
  table filters.
- Build UI from the design system in `@iot-os/ui`
  ([docs/dev/design-system.md](docs/dev/design-system.md), gallery: `apps/storybook`).
  Lists use `CollectionPage` with `DataTable`; content sits in a `Panel`; status
  comes from `statusOf`/`Status` in the kit, never a local map; times use
  `RelativeTime` or `Freshness`; use the named type scale (`text-title`,
  `text-heading`, `text-meta`...). Add a story for every new kit component.
  `pnpm --filter @iot-os/portal lint` (and admin) runs `tsc` plus the design system
  guardrails (`packages/ui/scripts/check-ui.mjs`).
- Toasts sit bottom-right. A sticky bottom action bar needs `ref={keepToastsAbove}`
  and a panel docked to the right edge needs `keepToastsLeftOf`, both from
  `@iot-os/ui/components/sonner`, or toasts will cover their buttons.
- New user references in API contracts use the integer `user_id`; users have no
  UUID ([ADR-013](docs/adr/ADR-013-integer-user-ids.md)).
- The repository is public. Keep host addresses, SSH key names, credentials,
  customer, prospect and pilot organization names, and local home paths out of
  code, specs and docs. Fixtures use `example.com`/`.test` hosts and documentation
  addresses (`192.0.2.0/24`, `203.0.113.0/24`); pilot specifics stay in the
  private operations inventory ([pilot](docs/ops/pilot.md)).
- Decisions change only through a new ADR. Known traps are in
  [docs/dev/gotchas.md](docs/dev/gotchas.md); add to it when something surprises you.
