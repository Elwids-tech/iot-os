# Feature Specification: Public API Contract

**Feature Branch**: `spec/001-openapi-contract`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "The platform is sold as API-first, but its public HTTP API has no machine-readable contract. `contracts/openapi/` was removed as empty; `packages/api-client` is a ~2,000-line hand-written TypeScript client that casts every response (`return payload as T`) across ~255 routes; the integration SDK (`packages/integration-sdk`) duplicates types for the external `integration/v1` API; drift has already caused bugs (for example users are referenced by integer `user_id`, never uuid — ADR-013). Some endpoints pass the Go runtime's internal response shape straight through to clients (e.g. telemetry capture). Outcome wanted: a machine-readable description of the public HTTP API that is produced from (or verified against) the Laravel application itself, kept in the repo, checked in CI so that an API change without a matching contract change fails the build, and used to generate the TypeScript types used by `packages/api-client` and `packages/integration-sdk`. Start with the external `integration/v1` API (third-party applications, bearer tokens, abilities) and the tenant `api/v1` endpoints the portal and admin use; internal runtime endpoints (`/api/internal/...`) are out of scope (spec 002 covers internal contracts). Must not change any endpoint's behaviour or break existing portal/admin/SDK call sites; error formats, pagination envelopes, authentication schemes and abilities must be described accurately. Published human-readable API reference for integrators is desirable."

## Clarifications

### Session 2026-10-11

- Q: How complete must the checked `api/v1` response schemas be before this spec is done? → A: A checked inventory of all 229 `api/v1` operations (method, path, authentication, parameters, status codes), plus full checked response schemas for the account and public, platform-administration, Administration and Device-profile operations (74). CI blocks any new operation without a full schema; the remaining domains follow in small pull requests.
- Q: Should the published reference cover only the integration API, or also the session-only `api/v1`? → A: Publish the integration API reference; build the `api/v1` reference for developers only, unpublished.
- Q: When a pull request makes a breaking change to `integration/v1`, should CI always fail it, or allow a reviewed exception? → A: Fail unless the pull request records a reviewed exception with a reason and an SDK version bump.
- Q: How should responses passed straight through from the runtime be described? → A: Exactly as returned today, marked runtime-shaped.
- Q: When the SDK receives an event type newer than the contract it was built from, what should it do? → A: Return it as an "unknown" event whose envelope is checked and whose payload is untyped; release the SDK as a minor version.

## User Scenarios & Testing *(mandatory)*

**Who is involved**

- **Integrator**: a developer of a third-party application that calls the integration
  API (`/api/integration/v1/organizations/{organization}/…`) with an application token.
  This is the only API a third party can call: the tenant API accepts first-party
  browser sessions only.
- **Platform developer**: changes an endpoint in the control plane, the portal/admin
  client library (`packages/api-client`) or the integration SDK
  (`packages/integration-sdk`).
- **Reviewer**: relies on pull-request checks to catch an API change that was not
  reflected everywhere.
- **First-party clients**: the portal and admin, which call the tenant API through the
  client library, and `apps/vertical-demo`, which calls the integration API through the
  SDK.

### User Story 1 - Integrators get an integration API contract that matches the platform (Priority: P1)

An integrator obtains one machine-readable description of the integration API that
lists all 18 operations (14 reads, 4 writes) with how to authenticate, which ability
each operation needs, every parameter and limit, and every success and error response.
Because the description is checked against the platform's real responses on every pull
request, the integrator can generate a client from it and trust it.

**Why this priority**: The platform is sold as API-first and the integration API is
its only third-party surface. It is small enough (18 operations, one SDK consumer) to
prove the whole loop — describe, verify against the platform, enforce in CI — before
applying it to the much larger tenant API.

**Independent Test**: With only this story delivered, the repository holds the
integration API description; an automated check run in CI confirms that each of the 18
operations exists in the platform with the same method, path, authentication and
ability, and that real responses (success and documented errors) conform. Renaming one
response field in the platform makes the check fail.

**Acceptance Scenarios**:

1. **Given** the contract, **When** an integrator looks up `GET devices/{uuid}/telemetry/history`, **Then** it states the application bearer token, the `telemetry:read` ability, the required `parameter_uuid`, `from` and `to` and optional `max_points` (10–1000), the 31-day window, the `telemetry-history.v1` response, and the 401, 403, 404, 422, 429 and 503 responses.
2. **Given** the contract, **When** an integrator looks up `GET events`, **Then** it states that `events:read` also needs `alerts:read` or `geofences:read`, that an ability must be granted on both the application and the token, the `cursor` and `limit` (1–100) rules, the `{data, next_cursor, has_more}` page, 409 after a grant change, 422 for another application's cursor, and every event type the platform emits, including `automation.triggered.v1`.
3. **Given** the contract, **When** an integrator looks up `POST geofences`, **Then** it states that `geofences:activate` also needs `geofences:manage`, the request body including `operation_uuid` and `expected_revision`, and the 202 response carrying the geofence and the activation batch to poll.
4. **Given** the platform returns a field the contract does not describe as required, omits a required field, or changes a field's type, **When** the verification runs, **Then** it fails and names the operation, the status and the field.
5. **Given** any integration operation, **When** an integrator reads it, **Then** the contract states both rate limits (60 requests per minute per application, 240 per minute per source address), the `Retry-After` header on 429, and `Cache-Control: no-store` on responses to authenticated requests.

---

### User Story 2 - A pull request that changes the API without the contract fails (Priority: P2)

A platform developer who adds, removes or changes a public route, a parameter, a
validation rule, an ability or a response field — without updating the contract — sees
the pull-request checks fail with a message that names the operation and the
difference. A contract edit with no matching platform change fails too. For the
integration API, a breaking change is reported as breaking, not just as a difference.

**Why this priority**: This is the "cannot drift" guarantee the feature exists for. It
builds on Story 1 (response drift on the 18 operations already fails there) and extends
it to route inventory, request rules, contract-only edits, breaking-change detection and
stale generated types across every in-scope route.

**Independent Test**: In a scratch branch, apply each seeded drift (listed in SC-003)
one at a time; every one fails the pull-request checks with a readable message. A change
that updates platform and contract together passes.

**Acceptance Scenarios**:

1. **Given** a new route under `/api/v1/` or `/api/integration/v1/` with no contract entry, **When** CI runs, **Then** it fails and names the method and path.
2. **Given** an operation removed from the platform but still in the contract, **When** CI runs, **Then** it fails and names the orphaned operation.
3. **Given** a changed validation rule (for example a new required field or a narrower bound), **When** CI runs without a contract change, **Then** it fails and names the operation and field.
4. **Given** an integration operation whose required ability changes, **When** CI runs, **Then** it fails as a breaking change.
5. **Given** the contract changed but the generated client types were not regenerated, **When** CI runs, **Then** it fails and says the types are stale.
6. **Given** a new route under `/api/internal/` or outside `/api`, **When** CI runs, **Then** the contract checks ignore it.

---

### User Story 3 - The tenant and administration API is described and verified (Priority: P2)

A platform developer can rely on the contract for the `api/v1` API the portal and admin
use: 228 routes carrying 229 operations — 5 that need no sign-in (sign-in, password
recovery and reset, invitation lookup and acceptance), 6 account-level operations
(profile, sign-out, unit catalogue, personal notification preferences and events), 199
organization operations across 12 domains, and 19 platform-administration operations.
Every one of them is in a checked inventory (method, path, authentication, parameters,
status codes). The 74 account and public, platform-administration, Administration and
Device-profile operations also get full checked response schemas. The other 155 are on
a pending-schema list that can only shrink, and their domains follow in small pull
requests after this spec.

**Why this priority**: The portal and admin are the largest API consumers and where the
hand-written client drifts. It is lower than P1 because no third party can call this API
and it is roughly twelve times larger.

**Independent Test**: The route inventory check reports zero undescribed and zero
orphaned `api/v1` operations, response verification passes for the 74 fully described
operations, and adding an operation that has no full schema and is not on the pending
list fails CI.

**Acceptance Scenarios**:

1. **Given** the contract, **When** a developer looks up any organization operation, **Then** it states that the caller must be a member of the organization in the path (404 for an unknown organization, 403 for a non-member); for a fully described operation it also states the tenant permissions the operation checks.
2. **Given** the contract, **When** a developer looks up `PUT alerts/{alert}/assignee`, **Then** the body field `user_id` is an integer, as is every other user reference (ADR-013).
3. **Given** the contract, **When** a developer looks up a fully described list operation, **Then** it shows the pagination envelope that operation actually returns (full metadata with links, compact metadata, cursor, or unpaginated), not a single generic envelope.
4. **Given** an operation on the pending-schema list, such as `GET telemetry-captures/{capture}`, **When** a developer looks it up, **Then** it shows the method, path, authentication, parameters and status codes and says its response schema is pending; when the Devices domain's schemas land, the response is described exactly as returned today and marked runtime-shaped.
5. **Given** a new `api/v1` operation without a full response schema, **When** CI runs, **Then** it fails, because only operations already on the pending list may lack one.

---

### User Story 4 - Client libraries use types generated from the contract (Priority: P3)

The integration SDK and the portal/admin client library take their request and response
types from the contract instead of declaring them by hand. Portal, admin and SDK call
sites keep working unchanged, and a contract change shows up as a type error where a
caller depends on the changed field.

**Why this priority**: It removes the duplicate type declarations (194 exported types in
the client library, a parallel set in the SDK) that let drift happen, but depends on the
contract existing. The SDK part needs only Story 1; the client-library part needs
Story 3.

**Independent Test**: The client library and SDK type-check, portal and admin build and
pass their unit tests, the SDK and `apps/vertical-demo` tests pass, and no hand-written
type remains for a fully described payload. The SDK accepts an `automation.triggered.v1`
event and returns an event type missing from its contract as an unknown event.

**Acceptance Scenarios**:

1. **Given** generated types, **When** the portal and admin are built, **Then** no call site needs changing, except where a hand-written type was wrong against real responses; each such correction is recorded in the drift log.
2. **Given** the SDK built on generated types, **When** it receives an `automation.triggered.v1` event from the feed or a webhook, **Then** it returns the event, typed from the contract, instead of raising a contract error.
3. **Given** the SDK receives an event whose envelope is a valid `integration-event.v1` but whose `type` is not in the contract it was built from, **When** it reads the feed or verifies a webhook, **Then** it returns an unknown event (envelope checked, `data` untyped) so the consumer can skip it and keep advancing its cursor; an envelope with an unsupported `schema_version` is still rejected.
4. **Given** a client-library method for an operation on the pending-schema list, **When** this story is done, **Then** it keeps its hand-written type until the operation leaves the list, and its type then comes from the contract.

---

### User Story 5 - Integrators can read a published API reference (Priority: P4)

An integrator reads a human-readable reference for the integration API, generated from
the contract, that shows each operation's purpose, authentication, ability, parameters,
examples, errors and rate limits, without reading source code. Platform developers can
build a second reference that covers `api/v1`; it is not published.

**Why this priority**: Desirable rather than required; it is a rendering of the
contract, so it adds little risk once the contract is correct.

**Independent Test**: Both references build from the repository without a running
platform; the published one contains the 18 integration operations and no `api/v1`
operation, and for any integration operation a reader can find the required abilities,
parameters and error responses.

**Acceptance Scenarios**:

1. **Given** a contract change merged to main, **When** the references are rebuilt, **Then** they reflect the change with no separate manual edit.
2. **Given** the published reference, **When** an integrator opens the event feed, **Then** it explains cursors, checkpoints and the event envelope with an example.
3. **Given** the published reference, **When** anyone searches it for an `api/v1` path, **Then** there is none.

---

### Edge Cases

- **One route, two methods**: `workflows/dag/settings` accepts GET and PUT on one route
  (hence 228 routes but 229 operations). Each method is its own operation. HEAD, added
  automatically for every GET, is not described separately.
- **Request bodies that depend on state**: an assistant message body differs by
  conversation scope (help conversations prohibit `source_ids`, `answers`, `target` and
  `execution_id`). The contract describes each accepted variant.
- **Action-style endpoints**: `POST telemetry-captures/{capture}` takes an `action`
  (`stop`, `delete`, `suspend`, `resume`), and `suspend` requires `confirm`.
- **Non-JSON traffic**: the connection-kit archive downloads as a zip, an assistant
  source downloads as a file, and assistant sources upload as multipart form data.
- **Runtime-shaped responses**: four telemetry-capture operations return the runtime's
  own body unchanged, including internal scope fields (`connection_uuid`,
  `edge_node_id`, `user_id`) and lists that are `null`, not empty, when there is nothing
  in them. The integration location fix returns the runtime's `data` verbatim, and
  location-map device entries are runtime output with fields added by the control plane.
- **Several pagination envelopes**: full page metadata with links (paginated resource
  collections in Administration and Device profiles), compact
  `{data, meta: {current_page, last_page, total}}` (most other paginated lists, built
  by hand in about 17 places), cursor feeds (event feed, telemetry records, workflow
  timelines), and unpaginated `{data: [...]}` lists. `docs/reference/api.md` claims only the compact form; the
  contract follows the code.
- **Several error shapes**: message only; message plus per-field errors (runtime
  rejections appear under a `runtime` field); profile validation with `diagnostics`; the
  draft conflict with `code: profile.draft_conflict`; 419 for an expired anti-forgery
  token; 429 with `Retry-After`; 503 when the runtime is unavailable or not configured;
  504 when a range read exceeds the runtime's limit.
- **Compound abilities**: `events:read` alone is not enough (also needs `alerts:read` or
  `geofences:read`), `geofences:activate` alone is not enough (also needs
  `geofences:manage`), and an ability must be on both the application and the token.
- **Two rate limits on one request**: the integration API applies 240 per minute per
  source address at the route and 60 per minute per application in the authentication
  step; either can return 429.
- **Path constraints**: malformed UUIDs return 404 because the route does not match;
  member, role, revision and activation-item ids are numeric; help article slugs follow
  a pattern; invitation routes take an opaque token.
- **Routes no first-party client calls**: six `api/v1` routes have no caller in the
  portal, admin or client library (`GET`/`PUT admin/platform-team`,
  `GET organizations/{organization}/administration`, `GET workflows/dag/health`,
  `POST workflows/dag/commands/{command}/reconcile`,
  `GET workflows/{workflow}/transitions`). They are reachable, so they are described.
- **Hand-written types more permissive than the platform** (for example fields marked
  optional because "older payloads omit it"): generated types may be stricter. The fix
  goes in the types, never in the platform, and is recorded.
- **Additive fields**: an integration response gaining a new optional field is
  additive and passes; removing or renaming a field, narrowing a type or adding a
  required input is breaking.
- **A client header the platform ignores**: the client library sends
  `X-Organization-UUID` on every request; no platform code reads it. The contract does
  not describe it as a parameter.
- **Operations whose response schema is pending**: the 155 `api/v1` operations outside
  the first 74 have method, path, authentication, parameters and status codes in the
  contract, but an open success body. A test that receives a status the contract does
  not list for them still fails; their body is not checked until their domain leaves
  the pending list.
- **An event type newer than the SDK**: a feed page or webhook carrying a valid
  `integration-event.v1` envelope with an unrecognised `type` yields an unknown event
  from the SDK rather than an error, so the consumer's cursor keeps moving. An
  unrecognised `schema_version` is still an error.
- **A breaking integration change that is intended**: for example correcting a field
  the contract described wrongly. It passes only with a recorded, reviewed exception and
  an SDK version bump in the same pull request.

## Requirements *(mandatory)*

### Functional Requirements

**Coverage and organisation**

- **FR-001**: The repository MUST contain one machine-readable description of the platform's public HTTP API (the "contract"), in an industry-standard API description format that documentation and type-generation tools can read, stored under `contracts/` beside the existing cross-language contracts.
- **FR-002**: The contract MUST describe every operation registered under `/api/integration/v1/` (18 operations) and `/api/v1/` (229 operations on 228 routes), grouped by audience: integration (application tokens), account and public, organization (tenant), and platform administration.
- **FR-003**: The contract MUST NOT describe the internal endpoints under `/api/internal/` (9 routes, covered by spec 002) or the operational routes outside `/api` (`/`, `/up`, `/health/ready`, `/internal/ops/metrics`, `/storage/*`), and the checks MUST NOT report them as drift. The anti-forgery bootstrap route used by session sign-in MUST be described as part of the session authentication scheme.
- **FR-004**: Each operation MUST state its method and path; path parameters with the format the platform enforces (UUID, integer, slug pattern or opaque token), noting that malformed identifiers return 404; query parameters with types, defaults and bounds; the request body (JSON or multipart) with required fields, types and validated bounds; and every success status (200, 201, 202, 204) and error status it can return. Each fully described operation (every integration operation and the 74 `api/v1` operations named in FR-019) MUST also give the body schema and relevant headers for each status; an operation on the pending-schema list (FR-019a) may leave its success body open.

**Authentication, authorisation and limits**

- **FR-005**: The contract MUST describe the two client authentication schemes: (a) the first-party browser session (session cookie plus anti-forgery token header; 401 without a session, 419 for an expired anti-forgery token), and (b) the application bearer token for the integration API, which the platform rejects on every other route and which is the only credential integration routes accept (session cookies and user tokens are ignored there). The 5 operations that need no authentication MUST be marked as such.
- **FR-006**: Each integration operation MUST state its required ability from the closed set of 8 (`devices:read`, `alerts:read`, `events:read`, `telemetry:read`, `locations:read`, `geofences:read`, `geofences:manage`, `geofences:activate`), that the ability must be granted on both the application and the token, the compound rules (`events:read` also needs `alerts:read` or `geofences:read`; `geofences:activate` also needs `geofences:manage`), and the meaning of 401 (missing, invalid, expired or revoked token), 403 (ability not granted) and 404 (another organization or a resource not granted to the application).
- **FR-007**: Each organization operation MUST state that the caller must belong to the organization in the path (404 unknown organization, 403 non-member); each fully described organization operation MUST also state the tenant permission or permissions it checks (for example `Device.view` and `Device.manage` for application management), with 403 when one is missing. Each platform-administration operation MUST state the platform permission it requires (`manage-organizations` or `manage-retention` where the route declares it; the check the operation itself makes otherwise, as for the two platform-team operations).
- **FR-008**: The contract MUST state the rate limits that apply to each operation — integration: 60 per minute per application and 240 per minute per source address; `api/v1`: the per-route limits on password recovery and reset, invitations, onboarding, telemetry captures, assistant conversations, messages and uploads, adapter tests, connection tests, deploys and credentials, and application management (30 per minute) — and the 429 response with `Retry-After`. It MUST state `Cache-Control: no-store` on integration responses to authenticated requests, and on application token issuance once application management leaves the pending-schema list.

**Shared conventions, described as they are**

- **FR-009**: Error responses MUST be described as the platform produces them today, without normalising them (shapes listed under Edge Cases).
- **FR-010**: Pagination MUST be described per operation using the envelope that operation returns (full metadata with links, compact metadata, cursor feed, or unpaginated list), including cursor parameters and limits.
- **FR-011**: Resource identifiers MUST be described as UUID strings and user references as integers (`id` in the profile, `user_id`, `acknowledged_by`, `assigned_to`, `created_by`, `recipient_ids`, member ids), per ADR-013. An automated check MUST fail if any user reference is described as anything other than an integer.
- **FR-012**: Fully described asynchronous operations MUST describe the 202 response, the operation or batch to poll and the operation that polls it; client-supplied idempotency keys and the 409 on reuse for a different request; and optimistic-concurrency fields (`revision`, `draft_revision`, `expected_revision`) with the 409 on a stale write. In this spec that is geofence activation in the integration API and draft revisions in device profiles; device lifecycle, workflow deployment and adapter deployment follow when their domains leave the pending-schema list (their 202 and 409 statuses are already in the inventory).
- **FR-013**: Non-JSON responses and uploads (connection-kit archive, assistant source download, assistant source upload) MUST be described by content type, headers and parts when their domains (Devices, Assistant) leave the pending-schema list; until then the inventory records their status codes.
- **FR-014**: Operations whose response body is the device runtime's own shape passed through by the control plane MUST be described exactly as returned today and marked as runtime-shaped, so a later spec can stabilise them. At the time of writing these are the location fix `data` and the location-map device entries in the integration API (described in this spec), and the four telemetry-capture operations that call the runtime (list, start, show, action) and the tenant location-map query (described when the Devices and Geospatial domains leave the pending list).
- **FR-015**: Where a payload already has a versioned schema in `contracts/` (`location-binding.v1` and `location-fix.v1` in this spec; `automation-workflow.v2` when Automation leaves the pending-schema list), the contract MUST reference that schema instead of restating it. The unit catalogue (`contracts/units/v1/units.json`) is data without a schema; `GET /api/v1/units` is described in the contract with an example taken from it.
- **FR-016**: The contract MUST describe the `integration-event.v1` envelope used by the event feed and webhook deliveries, every event type the platform emits (eight today: `alert.activated.v1`, `alert.cleared.v1`, `alert.acknowledged.v1`, `geofence.entered.v1`, `geofence.exited.v1`, `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1`, `automation.triggered.v1`) with each type's `data`, and the webhook delivery request (signature, timestamp and delivery-id headers and body).
- **FR-017**: Integration API response objects MUST be described as allowing additional fields, matching the contracts rule that additive fields stay within a major version; required fields and nullability MUST match the platform.

**Verification and enforcement**

- **FR-018**: An automated check MUST compare the platform's registered routes under the in-scope prefixes with the contract and fail when a route has no described operation, a described operation has no route, or the method, path, path constraints, authentication scheme or required ability differ.
- **FR-019**: An automated check MUST exercise described operations against the real application and fail when a response's status, headers or body does not conform. For every integration operation it MUST verify a success response and the 401, 403 and 404 responses, plus 422 where the operation accepts input. For `api/v1` it MUST verify at least one success response for each of the 74 fully described operations — 11 account and public, 19 platform administration, 13 Administration and 30 Device-profile organization operations, and the organization context — and, for every `api/v1` operation the test suite exercises, that the returned status is one the contract lists.
- **FR-019a**: Operations without a full response schema MUST be named in a pending-schema list kept with the contract. During this spec's own pull requests it starts with all 247 in-scope operations and only shrinks; when this spec is complete it holds the 155 remaining `api/v1` organization operations (Devices 47, Automation 42, Device adapters 17, Dashboards 13, Assistant 12, Geospatial 10, application management 10, Help 3, Overview 1). The checks MUST fail when an operation lacks a full schema and is not on the list, when the list names an operation that does not exist or already has a full schema, or when the list has more entries than on the main branch. No integration operation may be on the list. Each remaining domain leaves the list in its own small pull request after this spec, adding its schemas and response checks.
- **FR-020**: Request descriptions MUST be verified against what the platform accepts and rejects (required fields, types, bounds), so that a validation change without a contract change fails.
- **FR-021**: These checks MUST run on every pull request as part of the existing required CI and MUST report each failure with the operation, the status and the specific difference.
- **FR-022**: A contract change with no matching platform change MUST fail the same checks.
- **FR-023**: For the integration API, the checks MUST classify contract changes against the main branch as additive or breaking (removed operation; removed or renamed field; narrowed type; new required input; changed ability, authentication or status code) and MUST fail on a breaking change unless the same pull request records an exception that names each breaking change and gives a reason, the exception is reviewed in that pull request, and the SDK version is bumped. Without an exception, the contracts rule applies: a breaking change needs a new version.
- **FR-024**: Breaking changes to `api/v1` are allowed when the contract and the client library change in the same pull request (constitution principle IV); the checks MUST still report them as breaking.

**Client and SDK types**

- **FR-025**: Type definitions for every described payload (the request bodies of all operations and the response bodies of fully described operations) MUST be generated from the contract and used by `packages/api-client` and `packages/integration-sdk`; hand-written duplicates of those types MUST be removed or turned into aliases of the generated types.
- **FR-026**: The checks MUST fail when generated types are out of date with the contract.
- **FR-027**: The client library's public methods MUST keep their names, parameters and result shapes, so portal and admin compile and behave without call-site changes. Where a hand-written type is wrong against real responses, the type is corrected (never the platform) and the discrepancy is recorded in the drift log.
- **FR-028**: When the Automation domain leaves the pending-schema list, the responses of the portal's generic automation call path (22 call sites that declare their own response types) MUST be typed from the contract; until then they keep their local types.
- **FR-029**: The SDK's public surface (client class, method names, options, error classes and exported type names) MUST stay backward compatible and be released as a minor version (0.6.0), with one documented exception: the event union gains an unknown variant, so code that switches exhaustively on the event type must add a case; it MUST keep its runtime response validation, redirect rejection and no-retry behaviour; and its known event types MUST come from the contract, so it accepts `automation.triggered.v1`. An event whose `integration-event.v1` envelope is valid but whose `type` is not in that contract MUST be returned as an unknown event (envelope fields checked, `data` untyped) from both the feed and webhook verification, instead of raising a contract error; an unsupported `schema_version` MUST still be rejected.

**Reference and documentation**

- **FR-030**: Two human-readable references MUST be generated from the contract (never maintained separately): a published one covering only the integration API, and a developer one covering `api/v1` that MUST NOT be published. Both show each operation's authentication, ability or permission, parameters, examples, errors and rate limits, and both MUST build from the repository without a running platform.
- **FR-031**: Documentation that says no description exists MUST change, in the pull request that makes the statement untrue, to point to the contract and explain how to change it: `docs/reference/api.md`, `contracts/README.md`, `docs/architecture/overview.md`, `docs/features/integrations.md`, `docs/roadmap.md`, `packages/api-client/README.md` and `packages/integration-sdk/README.md`.
- **FR-032**: The contract MUST carry a version for the integration API, and the SDK MUST record which contract version its types were generated from.

**Behaviour must not change**

- **FR-033**: This feature MUST NOT change any endpoint's behaviour: routes, methods, status codes, headers, payloads, authentication, authorisation, rate limits and error formats stay as they are. A mismatch found while describing the API is resolved in the contract or the client types; a platform bug found on the way is recorded for a separate change.

### Key Entities *(include if feature involves data)*

- **Contract**: the single description of the public API. Has a version, audience groups, operations and shared components (authentication schemes, error and pagination envelopes, identifier formats, event envelope).
- **Operation**: one method on one path. Belongs to an audience group; has an authentication scheme, a required ability or permission, parameters, a request body, responses by status, rate limits, and flags (asynchronous, runtime-shaped, no first-party caller, schema pending).
- **Pending-schema list**: the operations that may lack a full response schema; 155 entries at the start, never more than on the main branch.
- **Breaking-change exception**: a record, added in the pull request that makes an intended breaking change to the integration API, naming each change, its reason and the SDK version it ships in.
- **Authentication scheme**: first-party session (cookie plus anti-forgery token) or application bearer token (one active token per application, valid 1–90 days, abilities a subset of the application's grants).
- **Ability**: one of 8 named grants on an application and its token, with two compound rules.
- **Shared envelope**: a reusable response shape — the error variants, the pagination variants and the `integration-event.v1` envelope.
- **External schema reference**: a pointer from the contract to an existing versioned schema in `contracts/`.
- **Generated types**: type definitions derived from the contract and consumed by the client library and the SDK.
- **Drift report**: the CI output listing each difference by operation, status and field, and whether it is additive or breaking.
- **Drift log**: a record, kept with this spec, of each discrepancy found while describing the API (between documentation, hand-written types and real behaviour) and how it was resolved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 18 integration operations are in the contract, and for 100% of them the success response and the 401, 403 and 404 responses (plus 422 where input is accepted) are verified against the platform's real responses.
- **SC-002**: All 229 `api/v1` operations (228 routes: 5 public, 6 account-level, 198 organization routes carrying 199 operations, 19 platform administration) are in the contract with method, path, authentication, parameters and status codes, and the route inventory check reports 0 undescribed and 0 orphaned operations. The 74 fully described operations have checked response schemas; the other 155 are on the pending-schema list, which never has more entries than on the main branch.
- **SC-003**: In a seeded drift exercise of at least 10 changes — a new route, a removed route, a changed path constraint, a renamed response field, a changed field type, a new required request field, a changed integration ability, a contract-only edit, a new `api/v1` operation without a full schema, and a pending-list entry added — the pull-request checks fail on all of them and name the affected operation. A matching platform-and-contract change passes, as does an intended breaking integration change that carries a recorded exception and an SDK version bump.
- **SC-004**: 0 hand-written type declarations remain in the client library or the SDK for payloads the contract fully describes (today the client library exports 194 hand-written types and the SDK declares its own set).
- **SC-005**: Behaviour is unchanged: the existing API feature tests (52 files), the client-library, portal and admin type checks and unit tests, the SDK tests and the mocked portal end-to-end tests all pass with no change to any expected response, and the registered route list for the in-scope prefixes is identical before and after.
- **SC-006**: The SDK accepts 8 of the 8 event types the platform emits (7 of 8 today), proven by a test that takes the list from the contract, and returns an event type missing from the contract as an unknown event in 100% of tested cases (feed and webhook), with no contract error.
- **SC-007**: 100% of user references in the contract are integers, and the automated check finds 0 exceptions.
- **SC-008**: The contract checks add no more than 3 minutes to the wall-clock time of the pull-request checks.
- **SC-009**: A developer who has not seen the source can find, for any integration operation, its required abilities, parameters, error responses and rate limits in the published reference alone; checked by a reviewer outside the API work on at least 3 operations, including the event feed.

## Assumptions

- **Format**: the contract uses OpenAPI 3.1, the format the roadmap names. Its schema
  dialect matches the JSON Schemas already in `contracts/`, so FR-015 references work.
- **Location**: the contract lives in `contracts/openapi/`, the directory that was
  removed when it was empty, consistent with constitution principle IV and
  `contracts/README.md`.
- **Audience of `api/v1`**: no third party can call `api/v1` (users never receive
  bearer tokens and application tokens are rejected there), so its contract serves
  first-party clients and platform developers. It is still described in full, including
  routes without a first-party caller, because they are reachable.
- **Reference hosting**: both references are static builds from the repository. The
  integration reference may be published (where is the owner's choice and outside this
  spec); the `api/v1` reference stays a developer artefact. Serving either from the
  production API would add a route and is not assumed.
- **Breaking changes**: the integration API follows the existing `contracts/README.md`
  rule (additive within v1; breaking needs a new version), except where a pull request
  records a reviewed exception and bumps the SDK version (FR-023).
- **Runtime-shaped responses** are described exactly as they are, not redesigned;
  stabilising them belongs with spec 002 (internal contracts) or a later spec.
- **Pending domains**: the 155 operations on the pending-schema list are described in
  small follow-up pull requests, one or two domains each, after this spec's own pull
  requests. They document existing behaviour only.
- **Code is the source of truth** (constitution, Governance): where documentation
  disagrees with the code — for example the single pagination envelope in
  `docs/reference/api.md` — the contract follows the code and the documentation is
  fixed.
- **Dependencies**: none blocking. Spec 002 may later supply schemas for runtime-shaped
  responses. The constitution's principle IV ("once the OpenAPI description exists …
  MUST update it and pass its drift check") takes effect when this lands.

### Out of scope

- Any change to endpoint behaviour, including normalising error or pagination envelopes,
  renaming fields, or removing the routes without a first-party caller.
- `/api/internal/*` (spec 002) and the operational routes outside `/api`.
- Generating the client library's methods or request mechanics (cookies, anti-forgery
  token, the session-expired event, base URL); only types are generated.
- Publishing the SDK to a package registry, or the integration reference to a public
  website, and publishing the `api/v1` reference anywhere.
- Full response schemas for the 155 pending operations (follow-up pull requests).
- Validating the portal's mocked end-to-end fixtures against the contract. Recommended as
  a follow-up: commit `430c9dd` fixed alert fixtures that still used non-UUID ids after
  the platform started rejecting them.

### Facts this spec relies on (main at `4f854bf`, 2026-10-11)

- Counted from the application's route registry: 262 registered routes; 255 under `/api`
  (18 integration, 228 `api/v1`, 9 internal) and 7 outside `/api`.
- `api/v1` operations by method: 100 GET, 80 POST, 26 PUT, 9 PATCH, 14 DELETE.
  Organization routes by domain: Devices 47, Automation 41 (32 workflow, 9 alert),
  Device profiles 30, Device adapters 17, Administration 13, Dashboards 13, Assistant
  12, Geospatial 10, Integrations (application management) 10, Help 3, Overview 1,
  organization context 1. Platform administration: 15 administration and 4 retention.
- `packages/api-client`: `src/index.ts` is 1,973 lines plus 1,279 lines across 12 other
  modules; 194 exported types; one private request helper returns `payload as T` for
  every call, and the device-profile helper returns `response?.data as T`.
- `packages/integration-sdk` 0.5.0 (372 lines, unpublished) covers all 18 integration
  operations with hand-written types and runtime validators; its event-type list lacks
  `automation.triggered.v1` (roadmap "SDK event types").
- The control plane has 57 controllers, 16 API resource classes and 21 form-request
  classes; 35 controllers validate inline, and most domains other than Administration,
  Authentication and Device profiles return hand-built arrays.
- Integration routes are tested in `tests/Feature/Domain/Integrations` and
  `tests/Feature/Domain/Geospatial`; the API suite makes about 880 JSON requests.

### Notes for planning (candidate approaches, not decisions)

1. **Generate from the application.** A static-analysis generator for Laravel (for
   example Scramble) derives routes, path constraints, validation rules and API
   resources. Hand-built array responses and runtime pass-throughs would need
   annotations or resource classes (which must not change output), and the ability
   middleware parameter and compound rules need an extension. On its own it verifies
   declarations, not real responses, so FR-019 still needs response checks.
2. **Hand-author the contract, verify in tests.** A route-inventory test compares the
   route registry with the contract (FR-018); the existing feature tests validate real
   requests and responses against it through an OpenAPI validator (FR-019, FR-020).
3. **Hybrid.** Generate the skeleton (routes, parameters, authentication, validation)
   from code and hand-author response schemas, with test-time validation. Probably the
   best fit for this codebase, given how few responses come from resource classes.
4. **Types.** A types-only generator (for example openapi-typescript) keeps the
   hand-written client methods and SDK runtime validators. Generating the validators
   from the schemas could follow later.
5. **Breaking-change detection.** An OpenAPI diff tool (for example oasdiff) run against
   the contract on main (FR-023, FR-024).
6. **Reference.** An open-source static renderer (for example Redoc, Scalar or Stoplight
   Elements) built in CI.
7. **CI placement.** Route and response verification in the existing API (PostgreSQL)
   job; type freshness and type checks in the Web job; no new services.
8. **Sequencing.** Integration API and SDK first (Stories 1, 2, 4-SDK); then `api/v1` by
   domain, starting with the resource-backed domains (Administration, Authentication,
   Device profiles).
