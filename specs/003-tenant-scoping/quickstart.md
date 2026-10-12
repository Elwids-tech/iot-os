# Quickstart: Structural Tenant Scoping

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Part A is the developer workflow once this feature has landed. Part B lists the
validation scenarios that prove each user story. Interfaces are in
[contracts/](contracts/) and data in [data-model.md](data-model.md); this guide links
to them rather than repeating them.

## Prerequisites

- The API dependencies installed in `apps/api` (`composer install`).
- To run the suite as CI does, a throwaway PostgreSQL database
  ([docs/dev/testing.md](../../docs/dev/testing.md#laravel)). SQLite runs locally, but
  CI's PostgreSQL job is authoritative.
- The committed contract is current: `cd apps/api && php artisan contract:export --check`.

## Part A: adding tenant functionality

### A1. Add a tenant route and pass the walker

1. **Model.** A new organization-owned model uses `BelongsToOrganization`. A child
   model looked up by identifier from input uses `BelongsToOrganizationThrough` with
   its parent relation. Never set or filter `organization_id` by hand; the creating
   hook fills it from the context
   ([data-model.md](data-model.md#5-model-classification)).
2. **Relations for binding.** Add the child relation named after the route parameter
   to its parent: `Organization::things()` for `{thing}`, or `Thing::parts()` for
   `{part}` under `{thing}` ([data-model.md](data-model.md#56-relations-for-scoped-bindings-and-parent-scopes)).
3. **Route.** Put the route in a group with `auth:sanctum`, the `organization`
   middleware and `->scopeBindings()`, and constrain every parameter with `whereUuid`
   or `whereNumber`. The route test fails if the middleware is missing.
4. **Controller.** Type-hint the models, call the domain service for the permission
   (for example `DeviceAuthorization::authorize($user, DevicePermission::MANAGE)`),
   and validate references with `TenantRecord::exists(Thing::class, 'uuid')`. Do not
   compare `organization_id` or parent keys yourself.
5. **Contract.** Run `php artisan contract:export` and commit
   `contracts/openapi/openapi.json`. The operation is `x-organization-scoped`
   automatically.
6. **Walker fixtures.** Add a `RecordKinds` entry for the new parameter. If the
   contract declares reference fields for the operation, add
   `tests/Support/Isolation/requests/<operationId>.php`
   ([contracts/isolation-walker.md](contracts/isolation-walker.md#record-kinds)).
7. **Run it.**

   ```sh
   cd apps/api
   php artisan test --compact --filter=TenantIsolation
   ```

   Expected: the walker picks up the operation, and C1 to C4 pass. A failure names the
   check, the operation and the field, with a fix line.

### A2. Add a queued job

Implement `RunsInOrganization` (organization and principal from the job's own
identifiers) and return `EnterOrganizationForJob` from `middleware()`. A job that spans
organizations implements `PlatformWide` and returns a `PlatformWork` case. The
architecture test fails for a job that does neither
([contracts/organization-context.md](contracts/organization-context.md#job-interfaces)).

### A3. Add work that spans organizations

Add a case to `PlatformWork` with its reason, wrap the work in
`OrganizationContext::platform()`, and use `run($organization, $principal, ...)` for
each item it handles. Add a test that the work leaves another organization's records
alone.

### A4. Add an integration event type

Add a case to `IntegrationEventType` with its required ability, use it in the writer,
and add the type to `docs/reference/events.md`
([contracts/event-abilities.md](contracts/event-abilities.md)).

## Part B: validation scenarios

### B1. Every tenant route is checked (US1, SC-001, SC-003)

```sh
cd apps/api && php artisan test --compact --filter='TenantIsolation(Self)?Test'
```

Expected:

- The walker reports 217 operations checked.
- `known-gaps.php` is empty (after PR 12), and the exemptions list only
  shared-data routes, each with a reason.
- The self-test disables each scoped model in turn, and each run reports at least one
  failure.

### B2. Foreign and missing records look the same (US2, SC-002, SC-011)

On the running stack (`./taskw devices:up`), sign in to the portal at
`http://localhost:5173` as `acme.member@example.test`, and take a Northstar device UUID
from the database. Then, with the session cookie from the browser (API at
`http://localhost:8001`):

```sh
API=http://localhost:8001/api/v1/organizations
curl -s -H "Cookie: $COOKIE" -H 'Accept: application/json' $API/<acme>/devices/<northstar-device>
curl -s -H "Cookie: $COOKIE" -H 'Accept: application/json' $API/<acme>/devices/$(uuidgen)
curl -s -H "Cookie: $COOKIE" -H 'Accept: application/json' $API/<northstar>/devices
curl -s -H "Cookie: $COOKIE" -H 'Accept: application/json' $API/$(uuidgen)/devices
```

Expected: all four are `404 {"message":"Not Found"}`.

### B3. Background work stays in its organization (US3, SC-007)

```sh
cd apps/api && php artisan test --compact --filter=BackgroundIsolation
```

Expected:

- Each job class, worker, scheduled task and assistant tool in the inventory has a
  passing test.
- A job whose acting person has lost membership ends without side effects.
- Work with no context throws `MissingOrganizationContext`.

On the stack: rebuild `api` and every service built from the API image (`automation-worker`,
`alerts-worker`, `webhooks-worker`, `assistant-worker`, `scheduler`; plus
`adapter-worker` with the adapter overlay; see
[docs/dev/local-setup.md](../../docs/dev/local-setup.md)). Trigger an alert email, an assistant answer
and a webhook delivery, and check that each completes.

### B4. Integration applications see only what they were granted (US4, SC-010)

```sh
cd apps/api && php artisan test --compact --filter='TenantIsolation|IntegrationEventAbilities'
```

Expected: for each ability combination in
[contracts/event-abilities.md](contracts/event-abilities.md#examples), the feed and the
webhook deliveries contain exactly the listed types.

### B5. Permissions are resolved once (US5, SC-004, SC-008)

```sh
cd apps/api && php artisan test --compact --filter=PermissionResolution
```

Expected:

- Adapter candidate activation resolves one snapshot.
- `GET devices/{device}` runs at most 2 authorization queries, against 4 at baseline.
- The snapshot equivalence test (every seeded role × every tenant permission) matches
  the pre-change services.
- `grep -rn setPermissionsTeamId apps/api/app apps/api/database` finds only
  `OrganizationContext`.

### B6. Platform administrators act through the grant (US6, SC-009)

```sh
cd apps/api && php artisan test --compact --filter=PlatformGrant
```

Expected:

- Every platform administrator journey passes.
- A super administrator opening Northstar without membership succeeds, and one
  `platform_access_events` row is written per request.
- After the `super-administrator` role is removed from that user, the same request
  returns 404.

On the stack, sign in to the portal as the bootstrap administrator, open an
organization you are not a member of, and query the new rows:

```sh
docker compose exec timescaledb psql -U "$IOT_POSTGRES_USER" "$IOT_POSTGRES_DATABASE" \
  -c "select operation, permissions, write from platform_access_events order by id desc limit 5"
```

### B7. Nothing legitimate changed (SC-005)

```sh
cd apps/api && php artisan test --compact && php artisan contract:coverage
cd apps/api && php artisan contract:export --check
```

Expected:

- The full suite passes on PostgreSQL.
- The contract diff after PR 2 is limited to the `NotFound` and `Forbidden`
  descriptions, and after PR 11 to the event-feed description.
- `php artisan route:list --json` is unchanged apart from middleware names.
