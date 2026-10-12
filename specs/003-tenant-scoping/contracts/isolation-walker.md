# Contract: Isolation walker

The automated isolation check (spec User Story 1, FR-029 to FR-033). Code:
`apps/api/tests/Feature/Isolation/TenantIsolationTest.php`,
`apps/api/tests/Feature/Isolation/TenantIsolationSelfTest.php` and
`apps/api/tests/Support/Isolation/`. Design: [research.md](../research.md) D6.

## Which operations it checks

- The operations come from `App\Support\Contract\ContractRoutes::index()` (the router).
  The walker keeps those whose contract operation carries `x-organization-scoped: true`
  in `contracts/openapi/openapi.json`. That is 217 operations on 216 routes: 199
  portal, including organization administration, and 18 integration.
- A tenant route with no contract operation fails, as `RouteInventoryTest` already
  ensures.
- Each operation is identified by its contract key, `METHOD /path` (for example
  `GET /v1/organizations/{organization}/devices/{device}`).

## The world

`IsolationWorld::build()` creates, in platform mode (`PlatformWork::TestFixtures`):

- Organizations **A** and **B**, plus `unknownOrganization`, a random UUID with no row.
- In each organization: `admin` (Organization Admin, the whole ceiling), `bare` (a
  member with no roles), and a non-member `stranger` shared by both.
- In each organization: one record of every kind in `RecordKinds`, created through its
  factory with parents first. Each record's name, code or title contains the marker
  `iso-<org>-<kind>`, for example `iso-B-device`.
- In each organization: `app` (every ability, every device of its organization),
  `narrowApp` (no `alerts:read`, one device not granted) and a token for each.
  `narrowApp`'s token lacks one ability the application holds.
- Events of every `IntegrationEventType` on granted and ungranted devices.

### Record kinds

`tests/Support/Isolation/RecordKinds.php` returns entries keyed by route parameter
name:

```php
'device' => [
    'model' => Device::class,
    'parent' => null,                      // or the parent parameter, e.g. 'profile'
    'make' => fn (Organization $org, array $parents) => Device::create([...]),
    'key' => 'uuid',                       // route key
],
'parameter' => ['model' => ProfileParameter::class, 'parent' => 'profile', ...],
```

Reference fields map to kinds in `RecordKinds::FIELDS`: `device_uuid` and
`device_uuids` → `device`, `site_uuid` → `site`, `artifact_uuid` → `artifact`,
`user_id`, `recipient_ids` and `assignee` → `member`, `role_ids` → `role`, and so on.
`RecordKinds::NOT_REFERENCES` lists identifiers that are not tenant references, each
with a reason:

- `request_uuid`, `operation_uuid`, `request_id`: client-chosen keys (checked
  separately, FR-009).
- `source_device_id`, `edge_node_id`, `group_id`: protocol identifiers.
- `session_id`, `execution_id`, `sample_ids`: runtime-scoped values.

A contract field ending in `_uuid`, `_uuids`, `_id` or `_ids` that is in neither list
fails the walker: "classify `<field>` of `<operation>` in RecordKinds".

### Request fixtures

`tests/Support/Isolation/requests/<operationId>.php` returns a valid request for an
operation whose contract declares reference fields:

```php
return fn (IsolationWorld $w, string $org) => [
    'query' => [],
    'body' => ['name' => 'iso', 'site_uuid' => $w->record($org, 'site')->uuid, ...],
];
```

The walker substitutes each reference field in turn. An operation with a declared
reference field and no fixture fails: "add tests/Support/Isolation/requests/`<operationId>`.php".

## Checks

For every operation, the walker builds the request from A's world (path parameters
from A's records) and sends it as `A.admin`, or for integration operations with
`A.app`'s token.

| # | Check | Pass condition |
| --- | --- | --- |
| C1 | **Foreign path record.** Replace one record parameter with B's record of the same kind, then with a random identifier. | Same status, and same JSON body after replacing the substituted identifier with `<id>`. B's checksum is unchanged. |
| C2 | **Non-member.** `A.admin` calls B's operation with B's records (and, as a variant, A's records). | Equal to the response for `unknownOrganization` (same status and body). |
| C3 | **Leakage.** For every 2xx response to A. | No B marker and no B identifier appears anywhere in the body. |
| C4 | **Foreign reference.** For each reference field from the fixture, set B's record, then a random identifier; for a list field, replace one element. | Same status and body after replacement, and that response differs from the response with A's own reference (which proves the field was reached). B's checksum is unchanged. |
| C5 | **Foreign application** (integration only). `B.app`'s token on A's operation. | 404 with the not-found body |
| C6 | **Ungranted device** (integration only). `A.narrowApp` on its ungranted device. | 404 for device operations; the device's events and records are absent from lists, the feed and webhooks |
| C7 | **Missing ability** (integration only). A token that lacks the operation's `x-abilities`. | 403. A portal session cookie on an integration operation, and an integration token on a portal operation, both get 401 (FR-025). |
| C8 | **Event abilities** (feed and webhooks; added in PR 11). | Rules in [event-abilities.md](event-abilities.md) |

**B's checksum** is an ordered hash of every row, in every table with an organization
column and in the child tables of section 5 of [data-model.md](../data-model.md), that
belongs to B. It is computed before and after each mutating request (POST, PUT, PATCH,
DELETE).

**Placeholder comparison**: every occurrence of the substituted identifier, in its
string or integer form, is replaced with `<id>` in both bodies before comparing.
Statuses must match exactly.

## Contract checks for free

Every walker request passes through the response checker in `tests/TestCase.php` (gate
G4 of spec 001). A status the contract does not document fails the walker's test with
the usual G4 message, and the coverage recorder records the 403 and 404 pairs. Walker
tests never use `#[WithoutContractCheck]`.

## Known gaps and exemptions

`tests/Support/Isolation/known-gaps.php`:

```php
return [
    'GET /v1/organizations/{organization}/devices/{device}' => ['C1', 'C2'],
    // ...
];
```

- A listed check that **passes** fails the walker: "remove the known gap ... it is
  fixed". The list can only shrink.
- An unlisted check that fails fails the walker.
- At PR 1, the list holds C2 for every portal operation (today's 403) and C1 for every
  bound record (today's different 404 bodies). PR 2 removes all C2 entries and the C1
  body entries. PR 12 asserts that the file is empty.

`tests/Support/Isolation/exemptions.php` maps an operation key to
`['checks' => ['C1', ...], 'reason' => '...']`. Allowed reasons: shared data (for
example `GET .../runtime-status`, `GET .../help/*`), or checks that do not apply.
Every entry needs a reason of at least 20 characters, and adding one is a reviewed
change.

## Self-test (FR-033, SC-003)

`TenantIsolationSelfTest` proves the walker catches regressions:

- For each `BelongsToOrganization` and `BelongsToOrganizationThrough` model, disable
  that model's scope (`OrganizationScope::disableFor()`), run the walker on the
  operations that bind or reference the kind, and assert at least one failure.
- For each entry point (portal middleware, integration middleware), remove it from
  one test-only route and assert a failure.
- The self-test registers test-only routes at runtime under
  `api/v1/organizations/{organization}/__isolation`. They are not in the contract, so
  the self-test opts out of the G4 check with `#[WithoutContractCheck('test-only
  routes for the isolation self-test')]`. One route reads a record through a raw
  unscoped query and must fail C1. After PR 4, one route uses only structural scoping,
  with no hand-written check, and must pass C1 to C4 (SC-006).

## Environment

- Rate limiting is off: `withoutMiddleware(ThrottleRequests::class)` and the named
  limiters.
- `Queue::fake()`; `Http::preventStrayRequests()`; runtime and adapter-manager calls
  are faked with generic 200 responses (`contracts/` golden fixtures where they exist).
- AI providers are faked as elsewhere.
- The walker runs as part of `php artisan test`. CI's PostgreSQL job is authoritative
  (FR-032). Budget: under 3 minutes added wall-clock in CI.

## Failure messages

```text
isolation C1: GET /v1/organizations/{organization}/devices/{device} {device}:
  foreign record → 404 {"message":""}; random id → 404 {"message":"Not Found"}
  fix: make the record kind organization-owned (BelongsToOrganization) or bind it through its parent
isolation C3: GET /v1/organizations/{organization}/alerts 200: body contains marker iso-B-alert at /data/3/name
isolation C4: POST /v1/organizations/{organization}/devices site_uuid: foreign → 201, random → 422
```
