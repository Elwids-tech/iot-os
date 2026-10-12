# Research: Public API Contract

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-11

Each item resolves an unknown from the plan's Technical Context. Versions were read
from Packagist, the npm registry and GitHub releases on 2026-10-11 and are pinned
exactly, because the generated contract and types are committed and checked byte for
byte: a tool upgrade that changes output must arrive in its own pull request.

## Summary of decisions

| Concern | Decision | Version (exact pin) | Licence |
| --- | --- | --- | --- |
| Contract generation | Scramble (`dedoc/scramble`), dev dependency, with project transformers and hand-written supplements | 0.13.47 | MIT |
| Response checking in tests | In-house checker on `opis/json-schema` (JSON Schema 2020-12), driven by Laravel's matched route | 2.6.0 | Apache-2.0 |
| YAML parsing (supplements) | `symfony/yaml`, made an explicit dev dependency (already locked transitively) | 8.1.8 | MIT |
| Linting, filtering, bundling | Redocly CLI (`@redocly/cli`) with one `redocly.yaml` | 2.54.3 | MIT |
| TypeScript types | `openapi-typescript`, types only, reading the same `redocly.yaml` | 7.13.0 | MIT |
| Breaking-change detection | `oasdiff`, run with `go run` (the repository already uses Go) | v1.32.1 | Apache-2.0 |
| Reference renderer | Redoc via `redocly build-docs` (single static HTML) | as Redocly CLI | MIT |

## R1. How the contract is produced: generated where the code allows, supplemented where it does not

**Decision**: Generate `contracts/openapi/openapi.json` from the Laravel application with
Scramble, extended by project code in `apps/api/app/Support/Contract/`:

- an **operation transformer** that reads each route's middleware and writes the
  security requirement (session or application token), the integration ability
  (`AuthenticateApplication:<ability>`), organization membership
  (`ResolveOrganizationContext`), platform permissions (`can:` middleware), rate
  limits (`ThrottleRequests` and named limiters) and the shared error responses they
  imply (401, 403, 404, 419, 429);
- a **document transformer** that merges hand-written **supplements**
  (`contracts/openapi/supplements/*.yaml`) keyed by `METHOD /path`, adds shared
  components (error and pagination envelopes, the `integration-event.v1` envelope, the
  webhook delivery), and applies the **pending-schema list** (R7);
- a `contract:export` command that writes the file in a stable, pretty-printed form and
  a `--check` mode that fails when the committed file differs from a fresh export.

Scramble infers paths, methods, path constraints (`whereUuid`, `whereNumber`, `where`),
query and body parameters from inline `validate()` calls and form requests, API
resources and paginated collections, `abort()` status codes and `@status`/`@response`
annotations. Supplements carry what code cannot say: response bodies built by hand or
passed through from the runtime, `$ref`s to existing schemas in `contracts/`, prose for
compound ability rules, examples, and the webhook.

**Rationale**:

- Regenerating and diffing gives FR-018 (route inventory), FR-020 (validation rules)
  and FR-022 (contract-only edits fail) for all 247 operations, including the 155 whose
  bodies stay pending. That is exactly the "checked inventory" the owner chose for Q1.
- Only 16 API resource classes and 21 form requests exist; 35 controllers validate
  inline and most domains return arrays built by hand, and four telemetry-capture
  operations return runtime output. Pure inference would produce weak or wrong response
  schemas there, so responses are proven against real output in tests (R2), not trusted
  from inference.
- Scramble is the most actively maintained Laravel generator (2.2k stars, pushed
  2026-10-10, supports `illuminate/contracts ^13.0`), emits OpenAPI 3.1.0, and has
  extension points for operations, documents, exceptions and types.

**Production safety**: Scramble is a dev dependency. The release image installs with
`--no-dev`, so it is absent there. The dev image installs dev dependencies, so the
service provider that configures Scramble calls `Scramble::ignoreDefaultRoutes()` (no
`/docs/api` route anywhere) and is registered only when the class exists. SC-005 checks
that the in-scope route list is unchanged.

**Alternatives considered**:

- *Hand-authored contract with test validation only.* Inventory, parameters and
  validation drift would need hand maintenance for 247 operations and dedicated
  negative tests for every validation rule. Rejected: far more work, weaker FR-020.
- *Scribe (`knuckleswtf/scribe`).* Builds docs from example responses captured by
  calling endpoints; schemas are inferred from examples and are weak, and the docs site
  is its main output. Rejected.
- *swagger-php / L5-Swagger.* Every operation needs hand-written attributes, which drift
  from code exactly like the hand-written client does. Rejected.

**Risk**: inference quality is unmeasured. Phase 1 starts with a half-day spike that
exports the contract and records, for the 18 integration and 74 first `api/v1`
operations, whether parameters, statuses and bodies are inferred correctly. The plan's
estimates assume about half of the response bodies need supplements.

## R2. Proving responses against the contract

**Decision**: A small in-house checker in `apps/api/tests/Support/Contract/`, using
`opis/json-schema` 2.6.0:

- `Tests\TestCase` listens for `RequestHandled` while a test runs. For a response from
  an in-scope route it finds the operation from the **matched Laravel route** (method
  plus URI template, which equal the contract's method and path), then checks that the
  status is documented, required headers are present (`Retry-After` on 429,
  `Cache-Control: no-store` where documented), and the JSON body validates against the
  documented schema. A pending operation gets the status check only.
- A failure fails the test that made the request, naming the operation, status and JSON
  pointer of the first mismatch.
- Each checked `(operation, status)` pair is appended to a coverage file;
  `php artisan contract:coverage` (run after the suite in CI) fails when a required pair
  was never seen (R8).
- A test that deliberately produces an undocumented response opts out with a
  `#[WithoutContractCheck('reason')]` attribute; the count is printed so reviewers see
  it.
- External `$ref`s into `contracts/` resolve through an opis loader mapped to the
  repository's `contracts/` directory.

**Rationale**: the existing suite already makes about 880 JSON requests on PostgreSQL
in CI; checking every response they produce costs little and catches drift wherever a
test exists. Matching by Laravel's own route avoids path-matching ambiguity
(`dag/settings` versus `{workflow}`). opis implements JSON Schema 2020-12, the dialect of
OpenAPI 3.1 and of every schema already in `contracts/`.

**Alternatives considered**:

- *`league/openapi-psr7-validator` 0.24 and `osteel/openapi-httpfoundation-testing`.* The
  package states OpenAPI 3.0.2; Scramble emits 3.1 (type arrays with `null`, 2020-12
  keywords). Rejected.
- *Spectator (`hotmeteor/spectator`) 3.0.4.* Middleware-based, active, built on
  `cebe/php-openapi` and opis; 3.1 support is not stated, and it has no notion of
  pending operations, coverage or external `contracts/` references. It can be revisited
  if the in-house checker grows beyond about 300 lines.

**Limitation**: a runtime-shaped response is only as faithful as the runtime fake the
test uses. Where `contracts/` has a golden fixture (`location-fix.v1`), fakes must use
it. Telemetry-capture fakes have no golden fixture yet; that stays pending with the
Devices domain and belongs with spec 002.

## R3. Linting, filtering into audiences, and the user-id rule

**Decision**: `contracts/openapi/redocly.yaml` defines two APIs over the same file:

- `integration`: the `filter-in` decorator keeps operations and webhooks with
  `x-audience: integration`; `remove-unused-components` trims the rest. This is the
  published surface, the SDK's type source and the breaking-change subject.
- `platform`: everything (`x-audience` of `integration`, `account`, `organization` or
  `platform-admin`). This feeds the client library's types and the developer reference.

Lint uses Redocly's `recommended` ruleset (noisy rules tuned in the config),
`no-invalid-media-type-examples` (examples act as golden fixtures, principle IV) and a
local plugin rule `iot/user-reference-integer` that fails when a property named
`user_id`, `user_ids`, `recipient_ids`, `member_id`, matching
`^(acknowledged|created|assigned|updated|decided|invited|requested)_(by|to)$`, or marked
`x-user-reference: true` is not an integer or integer array (FR-011, SC-007).

**Rationale**: one MIT tool for linting, bundling, filtering and rendering, whose config
format `openapi-typescript` also reads. It is actively released (2.62.1 on 2026-10-09);
2.54.3 (2026-09-25) is pinned to avoid a release only days old.

**Alternatives considered**: Spectral (maintenance slowed after Stoplight's
acquisition); a hand-written JSON walker for the user-id rule (kept as a fallback if
the plugin API cannot express it).

## R4. TypeScript types for the client library and the SDK

**Decision**: `openapi-typescript` 7.13.0 generates types only:

- `packages/integration-sdk/src/generated/contract.ts` from the `integration` bundle, with
  `--enum-values` so the SDK gets a runtime array of known event types (FR-029), and
  `--root-types` for readable aliases;
- `packages/api-client/src/generated/contract.ts` from the `platform` bundle.

Both files are committed, start with a header naming the contract version and the
SHA-256 of the bundle, and CI regenerates them and fails on any difference (FR-026).
Hand-written types become aliases (`export type Device = Schemas['IntegrationDevice']`),
so exported names stay the same (FR-027, FR-029). The client library's methods and
request mechanics are untouched; the SDK keeps its runtime validators, now typed by
the generated types.

**Rationale**: the most used types-only generator (8.4k stars, MIT), supports 3.0 and
3.1, has no runtime dependency, and does not try to replace the hand-written client.
Version 7.13.0 (February 2026) is the current stable release.

**Alternatives considered**: `@hey-api/openapi-ts` and Orval (generate whole clients; the
spec keeps the client's methods); OpenAPI Generator (Java, heavy, client generation).

## R5. Breaking changes to the integration API

**Decision**: `oasdiff breaking --fail-on ERR --format json` compares the `integration`
bundle built from the base branch's `openapi.json` with the one from the pull request.
A Node script in `tooling/contract/` then:

1. passes when there are no ERR-level changes;
2. otherwise matches each change against entries **added in this pull request** to
   `contracts/openapi/breaking-exceptions.json` (contract in
   [contracts/breaking-exceptions.schema.json](contracts/breaking-exceptions.schema.json));
3. fails unless every change is matched and `packages/integration-sdk/package.json`
   has a higher version than on the base branch (FR-023, Q3);
4. prints the changes and the matched exceptions as a GitHub job summary so the
   reviewer approves them knowingly.

The same comparison on the `platform` bundle runs in report-only mode, posting
`api/v1` breaking changes as warnings (FR-024).

**Rationale**: oasdiff is the most capable open-source OpenAPI diff (Apache-2.0, 1.4k
stars, monthly releases, OpenAPI 3.1 generally available since v1.15.0, JSON output and
ignore files). v1.32.1 (2026-09-15) is pinned; `go run
github.com/oasdiff/oasdiff@v1.32.1` gives developers and CI the same binary through the
Go module proxy's checksum database, with no extra installer.

**Alternatives considered**: OpenAPITools `openapi-diff` (Java, limited 3.1); Optic
(future uncertain after its acquisition); Bump.sh (hosted service).

## R6. Reference renderer

**Decision**: `redocly build-docs integration -o integration-reference.html` (published
artefact) and `redocly build-docs platform -o platform-reference.html` (developer
artefact, never published). CI uploads both as workflow artefacts; where the
integration reference is hosted is the owner's choice and outside this spec.

**Rationale**: comes with the Redocly CLI already pinned; a single static HTML file
needs no server and adds no route (FR-030). Redoc is open source, which matches the
owner's open-source-only UI preference. A later Redocly CLI release moves `build-docs`
to Redoc 3; the exact pin keeps the output stable.

**Alternatives considered**: Scalar (good, but another tool to pin); Swagger UI (its
"try it out" invites pasting bearer tokens into a browser); Stoplight Elements
(maintenance has slowed).

## R7. Pending-schema ratchet

**Decision**: `contracts/openapi/pending-schemas.json` lists operations by
`METHOD /path` with their domain. The exporter replaces the success bodies of listed
operations with an open schema and sets `x-schema-status: pending`, so neither the
contract nor the generated types claim a shape nobody has checked (principle VI).
`php artisan contract:check` fails when:

- an unlisted operation has an open response schema (a new operation must be fully
  described);
- a listed operation does not exist, or is no longer open;
- the list has more entries than the base branch's copy (`git show
  origin/main:contracts/openapi/pending-schemas.json`);
- an `x-audience: integration` operation is listed (enabled from PR 3 on).

During this spec the list starts with all 247 in-scope operations and shrinks to the
155 agreed by the owner (FR-019a); the follow-up domain pull requests take it to zero.

## R8. Required coverage

**Decision**: `contract:coverage` requires, from the coverage file:

- every integration operation: one 2xx, 401, 403 and 404, plus 422 when it has a request
  body or a required query parameter;
- every fully described `api/v1` operation: one 2xx;
- every response seen for any in-scope operation: its status documented (already
  enforced per request).

Gaps are filled with data-driven tests (one test class iterating all 18 integration
operations for 401, 403 and 404), not one test per pair.

## R9. Unknown event types in the SDK

**Decision**: the SDK's event union becomes
`IntegrationEvent = KnownIntegrationEvent | UnknownIntegrationEvent`, where the unknown
variant has `type: "unknown"`, the original type in `event_type`, the checked envelope
fields, and `data: unknown` (contract in [contracts/sdk-events.md](contracts/sdk-events.md)).
A distinct literal keeps TypeScript's narrowing on `event.type` working for known types.
An unsupported `schema_version` still raises `IotContractError`. Released as 0.6.0.

**Trade-off**: code that switches exhaustively on `event.type` must add an `"unknown"`
case. Under semantic versioning for 0.x a minor bump may carry this; the README and
release notes call it out.

**Alternatives considered**: `type: string` on the unknown variant (breaks narrowing for
every consumer); a separate `unknown` array on the page (loses order, and
`verifyWebhook` would still need a new return type); throwing a dedicated error that
carries the envelope (still stops a naive consumer's loop, which is the bug Q5 fixes).

## R10. Contract version

**Decision**: `info.version` of the `integration` bundle follows `1.MINOR.PATCH`, set in
the info supplement. `contract:check` fails when the integration bundle's oasdiff
changelog is non-empty and the version did not change. The generated SDK types export
`CONTRACT_VERSION` and record it in their header (FR-032).

## R11. CI placement and time budget

**Decision**:

- **API (PostgreSQL) job**: `contract:export --check`, `contract:check` (ratchet,
  inventory), the suite with response checks on, then `contract:coverage`. The base
  branch is fetched with `git fetch --depth=1 origin main` for the ratchet.
- **New Contract job** (Node and Go, no database): Redocly lint; bundle both APIs; type
  freshness for both packages; oasdiff gates; reference builds uploaded as artefacts.
  It runs in parallel with the other jobs.

Expected added wall-clock is under 2 minutes (export about 30 to 60 seconds in the API
job; the Contract job finishes before the API job). SC-008 allows 3.

## R12. Exception review

**Decision**: an exception is reviewed in the pull request that adds it. The gate makes
it visible (job summary and annotations). Whether to also require a code owner's
approval for `contracts/openapi/breaking-exceptions.json` through a `CODEOWNERS` file
(none exists today) is left to the owner; see the plan's open decisions.

## R1 spike results (PR 1 spike, 2026-10-11)

Scramble 0.13.47 exported the application on branch `feat/001-contract-skeleton` (main
at `4ce84fa`) with the T004 configuration: `api_path` `api`, a route resolver keeping
`api/v1/*` and `api/integration/v1/*`, default routes off. Figures below come from that
export compared with `php artisan route:list --json` and the controllers.

**Verdict: Scramble serves the plan.** Route groups, the `auth:sanctum` and
`AuthenticateApplication:<ability>` middleware and named limiters are all readable from
each route (`Router::gatherRouteMiddleware`), so the security transformer needs nothing
from Scramble's inference. The gaps below are handled inside PR 1 or were already
planned as supplements; none changes the approach.

### What it inferred well

- **Inventory**: 247 operations for 247 in-scope route methods (18 integration, 229
  `api/v1`); every path template equals the route URI, so `METHOD /path` keys match the
  router exactly. The default method resolver documents only the first method of a
  route, which would have dropped `PUT workflows/dag/settings`; the provider resolves
  every method except HEAD.
- **Request input from form requests and inline `validate()`**: the form requests and
  inline rules of the 92 operations checked, with types, bounds and enums
  (for example `cursor` `maxLength 4096`, `limit` 1 to 100, `max_points` 10 to 1000,
  `trail_window` enum, `device_uuids` uuid items).
- **Success statuses**: right for all 92 operations (200, 201, 202, 204), including the
  202 of geofence create and update.
- **401 on session routes**: on all 224 `auth:sanctum` operations. **404**: on 225 of
  247 operations (route model binding and `firstOrFail`).
- **Speed**: about 3 seconds for the whole application, against a 60-second budget.

### What it missed or got wrong

| Area | Finding | Handling |
| --- | --- | --- |
| Database | Model inference reads the database schema. On an unmigrated database the export differs by 13,951 lines; migrated PostgreSQL and migrated SQLite exports are byte-identical. | `contract:export` migrates a private in-memory SQLite connection before generating, so the output does not depend on the developer's database. |
| Path constraints | Route `wheres` are ignored: none of the 247 operations carries `whereUuid`, `whereNumber` or `where`; 9 get `format: uuid` from a model's route key. R1's claim that path constraints are inferred was wrong. | `PathConstraintTransformer` (PR 1) writes each route's constraints into its path parameters, so G1 catches a changed constraint (quickstart B2, change 3). |
| Validation in helper methods (integration) | 6 of 18 operations miss rules: `GET devices` and `GET alerts` (`pagination()`: `page` 1 to 100000, `per_page` 1 to 100), `GET telemetry/history` and `GET telemetry/records` (`window()`: required `parameter_uuid`, `from`, `to`), `POST geofences` and `PUT geofences/{uuid}` (`input()`: the whole body, so no request body at all). The other 12 are right. | Scramble parameter attributes in PR 3 (T034, T035), as planned. |
| Unvalidated query reads (first 74) | `per_page` and `search` read with `$request->query()` are missing on `GET members`, `GET invitations` (`per_page` only) and `GET admin/{invitations,organizations,platform-team,roles,users}`; `organization` is missing on `GET admin/roles` and `GET admin/users` (7 operations). | Parameter attributes in PR 6 (T054 to T056). |
| Shared form requests on DELETE (first 74) | `DELETE alarm-templates/{alarm}` and `DELETE parameters/{parameter}` reuse the upsert form request, so every upsert field appears as an optional query parameter. It is what the code validates, but misleading. | Review in PR 7 (T060). |
| Rule evaluation (pending domains) | `PUT dashboards/{dashboard}/access` loses all request rules (`private const MAX_SHARES`); `DeviceController@index` `sort` and `ApplicationController@rotate` `abilities.*` lose one `Rule::in(self::…)` rule each. Scramble writes the error into the operation description with an absolute path. | The export strips the checkout path from descriptions; the rules are fixed when those domains leave the pending list. |
| Integration errors | No 401, 403 (ability), 419 or 429 for any integration operation: they come from `AuthenticateApplication` and `throttle`. 422 is missing where rules are missed; 503 and 504 (runtime) are never inferred. | Security transformer (PR 1) for 401, 403, 404, 419, 429; supplements (PR 3) for 503 and 504. |
| Integration bodies | 9 of 18 success bodies are open in part (telemetry `data` items, geofence geometry, location-map devices); the other 9 have wrong leaf types (compact-page `meta` fields as strings, location-fix `data` as a string). | All 18 are supplemented in PR 3, as planned. |
| First 74 bodies | 12 are 204 with no body. Of the other 62: 11 are closed and plausibly typed; 15 rely on a resource whose model Scramble cannot infer (JR001 on 9 resource classes, so `GET /v1/me` has `id: string` and string `capabilities`); 36 are open in part, mostly JSON columns cast to arrays (profile `definition`, `extensions`, `validation_logic`, notification `grid`). | 51 of 62 (82%) need a supplement or a `@mixin` docblock on the resource, against the "about half" assumed. Sizes of PR 6 and PR 7 updated in [plan.md](plan.md). |
| 403 and 419 on session routes | 403 only where the controller visibly aborts or authorizes (32 of 44 first-74 organization operations, 42 of 155 pending ones, all 19 platform-administration ones through `can:`); 419 never. | Security transformer adds 403 to every organization-scoped, ability or `can:` operation and 419 to every unsafe `api/v1` operation. |

### Other observations

- Without `Scramble::ignoreDefaultRoutes()` the application gains `GET docs/api` and
  `GET docs/api.json`; Scramble's development tools would add
  `GET _scramble/dev-tools/devtools.js` whenever `APP_DEBUG` is on, so
  `config/scramble.php` turns them off. With both, the route list has the same 262
  routes as main.
- Scramble passes `servers` through `url()`, which makes them absolute and dependent on
  `APP_URL`; the export writes `servers: [{url: /api}]` itself.
- PR 1 validates supplements and the pending list against `contracts/openapi/meta/`
  (T010, T013), which needs a JSON Schema validator, so the `opis/json-schema` 2.6.0
  dev dependency planned for PR 2 (T023) arrives in PR 1.
