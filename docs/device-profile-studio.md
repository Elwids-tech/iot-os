# Tenant Device Profile Studio

The Studio is the organization-scoped authoring application in `apps/portal`. It uses Laravel authoring resources through `packages/api-client`, with shared shadcn/Radix components. No platform-administration role is required.

## Local addresses and access

| Surface | Default address |
| --- | --- |
| Tenant portal | http://localhost:5173 |
| Platform administration | http://localhost:5174 |
| Laravel API | http://localhost:8001 |
| Invitation mail inbox | http://localhost:8025 |

Use a consistent hostname (`localhost` or `127.0.0.1`) across browser tabs so session cookies are shared. The local clients match the API hostname to the browser hostname.

In an already demo-seeded environment, `shared.operator@example.test` / `password` can author profiles in **Acme Manufacturing**. The same user has view/validate access, without edit or publish access, in **Northstar Utilities**. `super-admin@example.test` / `password` is the separate platform-administration demo login. Existing customized passwords are not reset on startup.

Profile URLs include the authorized organization UUID: `/organizations/:organizationUuid/device-profiles/:profileUuid/:section`. Selection is remembered locally, checked against current memberships, and protected by the unsaved-changes guard.

## Starting and upgrading

Run `./taskw stack:up` for the Docker development stack. The API startup runs outstanding migrations, but **does not run demo seeders**. This avoids overwriting account names, passwords, and memberships on every restart.

When upgrading an existing database, run the additive Studio permission seeder after rebuilding the API:

```bash
docker compose --env-file .env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml exec -T api php artisan db:seed --class=DeviceProfilePermissionSeeder --force
```

This registers profile permissions and adds their default grants to existing built-in tenant roles. It does not change platform roles, custom tenant roles, accounts, memberships, profiles, or other permission grants. Custom roles can be granted profile permissions through [organization administration](organization-administration.md), within the organization's permission ceiling.

For a **new, empty development environment only**, explicitly run the normal `DatabaseSeeder` once to create demo accounts. The demo seeder updates its example accounts; do not use it as a routine upgrade command.

For frontend hot reload with the existing API running:

```bash
pnpm install --frozen-lockfile
pnpm --filter @iot-os/portal dev
pnpm --filter @iot-os/admin dev
```

Stop the corresponding frontend container before starting a hot-reload server on its default port. Both servers use strict ports and will not silently choose another one.

Configure `IOT_PORTAL_PORT` and `IOT_PORTAL_URL` together for Docker. The portal uses `VITE_API_URL`; administration uses `VITE_API_URL` and optional `VITE_PORTAL_URL`. Laravel `FRONTEND_URL` now points invitation acceptance links to the portal. If changing origins, also update `CORS_ALLOWED_ORIGINS` and `SANCTUM_STATEFUL_DOMAINS` together. Changing a Vite environment value requires rebuilding that frontend image.

## Authoring workflow

To load an optional, editable meter example, see the [Schneider three-phase energy meter seeder](schneider-energy-meter-seeder.md). It creates a tenant-scoped draft without resetting accounts or modifying existing profiles.

1. Search/filter the directory, create a profile, or open a saved profile.
2. Edit Overview metadata with explicit Save/Cancel.
3. Add groups and parameters. The grouped table is searchable and paginated; reorder mode has keyboard-operable move buttons and its own Save/Cancel. Removing a group moves its parameters to Ungrouped.
4. Use Basics, Behavior, Validation, and Advanced in the parameter sheet. Mobile sheets occupy the full screen and keep Save/Cancel visible. Type-specific controls include capabilities, presentation choices, precision/step, staleness hints, counter settings, and validation.
5. Create calculations for derived parameters using named inputs and arithmetic expressions. Run non-saving samples. Configure optional alarm templates as reusable suggestions, not live alarms.
6. Validate the exact saved draft, inspect changes against the published definition, and publish a new immutable revision. Earlier artifacts remain read-only in history. Publication does not claim device activation.

Ordinary editing does not require JSON. Advanced configuration uses a bounded, lazy-loaded CodeMirror editor with highlighting, folding, search, format, copy, and expansion. Guided controls and JSON share the same form values. Unsupported expressions remain intact and require advanced editing or an explicit confirmed replacement.

The shared theme uses blue primary actions, cool neutral surfaces, semantic status colors with text labels, and light/dark/system modes. Theme tokens are shared by navigation, fields, focus states, notifications, and JSON syntax.

## Persistence and safety contract

- Authoring payload types follow Laravel resources; compiled definition types remain a separate, read-only representation. There is no fixture-backed authoring store.
- TanStack Query keys include the tenant and profile. React Hook Form keeps local edits separate from saved server state.
- Mutations are serialized and refresh the authoritative draft. If refresh fails after a successful write, further mutations are blocked until refresh succeeds.
- Every draft mutation, including deletion and reordering, supplies `draft_revision`. A conflict retains the local form/order. The user explicitly compares saved values and chooses whether to reapply edits. Destructive conflicts require refreshing and reopening confirmation.
- Failed saves leave the local form intact. Navigation, organization changes, sheet closure, sign-out, and browser exit protect unsaved work. Session recovery retains the pending form while the user signs in again.
- Duplicate keys return field errors. Parameter deletion is blocked when calculations, alarm templates, or mappings reference it, with named dependants. Only unused never-published draft profiles can be deleted.
- Validation, compilation, and preview responses identify their source draft revision. Publishing locks and revalidates that exact saved draft. Editing afterward creates pending changes, not a mutation of a published artifact.
- Expressions are evaluated by a bounded, restricted server evaluator. Unsupported operators, unknown input aliases, type errors, missing references/calculations, and dependency cycles prevent successful validation/publication.

## API additions

Under `/api/v1/organizations/{organization}/device-profiles/{profile}`:

- `PATCH/DELETE parameter-groups/{group}` and `PUT group-order` complement group creation.
- `GET artifacts` paginates published metadata; `GET artifacts/{revision}` returns the immutable definition.
- `POST preview` accepts `kind: validation` or `kind: calculation`, a draft revision, candidate configuration, and sample values. It does not save anything.
- Profile listing accepts validated `search`, `status`, `category`, `page`, and `per_page` inputs.
- Organization context includes `capabilities.device_profiles` for listing, viewing, creating, editing, deleting drafts, validating, and publishing.

Draft operations remain independent of the UI. Future chat can propose changes and display a reviewable diff, then use these same permission-checked APIs only after approval. Chat is not implemented here and must never silently publish.

## Verification

```bash
pnpm typecheck
pnpm build
pnpm --filter @iot-os/portal test
cd apps/api && php artisan test --compact
```

PHPUnit forces SQLite `:memory:` and refuses unsafe cached database configuration. It does not use the developer database.

Run the real-API browser suite from the repository root:

```bash
node tooling/test-profile-studio.mjs
```

The harness creates a disposable SQLite database, seeds isolated accounts/invitations and a 500-parameter profile, starts an API on `127.0.0.1:8013` and a portal on `127.0.0.1:4173`, and runs Playwright. It isolates configuration caches, database-backed sessions, and captured mail; rejects occupied ports/non-loopback hosts; and stops only its own processes. Database files, API logs, screenshots, and failure traces remain in the printed temporary directory outside the repository. It never resets the developer database. Override `STUDIO_API_URL` and `STUDIO_BASE_URL` only with unused local test addresses.

The browser suite covers CRUD/reload persistence, invitation acceptance, failed saves, duplicate keys, cancellation/navigation warnings, session recovery, stale drafts/deletions, custom JSON round-tripping, published history, tenant permissions, 500-parameter search/pagination, keyboard operations, contrast checks, and desktop/mobile light/dark layouts. It uses Chromium; Safari/Firefox, full assistive-technology testing, and production infrastructure need separate validation.

## Release boundaries

Chat authoring, transport-binding UX, live activation, alarm execution, production deployment, and simultaneous collaborative editing are outside this release. Conflict handling is explicit optimistic concurrency, not real-time collaborative merging.
