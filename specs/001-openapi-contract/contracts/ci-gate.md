# Contract: the CI gate

The checks that make "an API change without a matching contract change fails the
build" true. Each gate states where it runs, what it reads, when it fails and what it
prints. All gates run on every pull request and on pushes to main; all are required.

**Failure line format** (every gate):

```text
contract <gate-id>: <METHOD /path>[ <status>]: <difference>
  fix: <the command or file to change>
```

Gates also emit GitHub annotations (`::error::`) and, where noted, a job summary.
Exit code 0 means pass and 1 means fail.

| Gate | Job | Command | Requirements |
| --- | --- | --- | --- |
| G1 Export is fresh | API (PostgreSQL) | `php artisan contract:export --check` | FR-018, FR-020, FR-022 |
| G2 Route inventory | API (PostgreSQL), in the suite | `tests/Feature/Contract/RouteInventoryTest.php` | FR-002, FR-003, FR-005, FR-006, FR-018 |
| G3 Ratchet and completeness | API (PostgreSQL) | `php artisan contract:check --base=origin/main` | FR-004, FR-019a |
| G4 Responses conform | API (PostgreSQL), in the suite, then `php artisan contract:coverage` | FR-019, SC-001, SC-002 |
| G5 Lint | Contract | `pnpm contract:lint` | FR-011, FR-001, SC-007 |
| G6 Types are fresh | Contract | `pnpm contract:types --check` | FR-025, FR-026 |
| G7 Integration breaking changes and version | Contract | `node tooling/contract/breaking.mjs integration --base origin/main` | FR-023, FR-032 |
| G8 `api/v1` breaking report | Contract | `node tooling/contract/breaking.mjs platform --base origin/main --report-only` | FR-024 |
| G9 References build | Contract | `pnpm contract:docs` | FR-030 |

## G1 Export is fresh

- **Reads**: the application's routes and code, `contracts/openapi/supplements/*.yaml`,
  `contracts/openapi/pending-schemas.json`, the committed `openapi.json`.
- **Fails when**: a fresh export differs from the committed file in any byte.
- **Prints**: each added, removed or changed operation and component by name, then
  `fix: php artisan contract:export` (or "revert the hand edit to openapi.json").
- **Catches**: new, removed or changed routes, path constraints, validation rules,
  inferred responses, supplement edits not exported, hand edits to the contract.

## G2 Route inventory

- **Reads**: `Route::getRoutes()` filtered to `api/v1/*` and `api/integration/v1/*`
  (HEAD dropped), and the committed `openapi.json`.
- **Fails when**: a route has no operation; an operation has no route; an operation's
  `security` does not match the route's authentication middleware (`auth:sanctum` gives
  `session`; `AuthenticateApplication:<ability>` gives `applicationToken`; neither gives
  `[]`); an integration operation's `x-abilities.all` does not contain the middleware's
  ability; an organization route lacks `x-organization-scoped: true`; a route outside
  the in-scope prefixes appears in the contract.
- **Why separate from G1**: Scramble can skip a route it fails to analyse; this test
  reads the router directly.

## G3 Ratchet and completeness

- **Reads**: `openapi.json`, `pending-schemas.json`, and the base branch's
  `pending-schemas.json` (`git show <base>:contracts/openapi/pending-schemas.json`; the
  job runs `git fetch --depth=1 origin main` first).
- **Fails when**:
  - an operation not on the list has an **open** JSON response schema;
  - a listed operation does not exist in the contract, or has a closed schema;
  - the list has more entries than the base branch's list, or is not sorted and unique;
  - an `x-audience: integration` operation is listed (switched on in phase 3).
- **Open schema** means: `{}`; or no `$ref`, `type`, `properties`, `items`, `oneOf`,
  `anyOf`, `allOf`, `enum` or `const`; or `type: object` without `properties`,
  `patternProperties` or an `additionalProperties` schema; or `type: array` without
  `items`. Checked recursively on the success bodies of non-pending operations.

## G4 Responses conform

- **Per request** (inside the test that made it): for each response from an in-scope
  route, the status must be documented; for a non-pending operation, the JSON body must
  validate against the documented schema and documented required headers must be
  present. A failure fails that test with
  `contract G4: GET /v1/... 200: /data/0/uuid: expected string, got null`.
- **Opt-out**: `#[WithoutContractCheck('reason')]` on a test method; counted and listed.
- **Coverage** (`contract:coverage`, after the suite) fails when a required pair was
  never checked:
  - integration operations: a 2xx, 401, 403 and 404, plus 422 if the operation has a
    request body or a required query parameter;
  - fully described `api/v1` operations: a 2xx.
- **Coverage file** (`apps/api/storage/framework/testing/contract-coverage.json`, git
  ignored):

  ```json
  {
    "contract_sha256": "…",
    "checked": [{ "operation": "GET /integration/v1/organizations/{organization}/devices", "status": 200, "test": "Tests\\Feature\\Domain\\Integrations\\ApplicationTest::test_…" }],
    "skipped": [{ "test": "…", "reason": "…" }]
  }
  ```

## G5 Lint

- **Reads**: `contracts/openapi/redocly.yaml`, `openapi.json`.
- **Fails when**: the document is invalid OpenAPI 3.1; an example does not validate
  against its schema; the rule `iot/user-reference-integer` finds a user reference that
  is not an integer (or integer array, nullable allowed); a configured `recommended` rule
  fails.

## G6 Types are fresh

- **Reads**: the `integration` and `platform` bundles, the committed
  `packages/integration-sdk/src/generated/contract.ts` and
  `packages/api-client/src/generated/contract.ts`.
- **Fails when**: regenerating either file produces a difference.
- **Followed by**: the existing Web job's type checks, which fail where a caller depends
  on a changed field.

## G7 Integration breaking changes and version

- **Reads**: the `integration` bundle built from the base branch's `openapi.json` and from
  the pull request's, `breaking-exceptions.json` on both branches,
  `packages/integration-sdk/package.json` on both branches.
- **Fails when**:
  - `oasdiff breaking --fail-on ERR` reports a change that is not matched by an exception
    entry added in this pull request (format:
    [breaking-exceptions.schema.json](breaking-exceptions.schema.json));
  - an exception is used and the SDK version is not higher than on the base branch, or
    the entry's `sdk_version` differs from the pull request's SDK version;
  - an exception entry added in this pull request matches no reported change;
  - the integration bundle changed (oasdiff changelog not empty) and `info.version` did
    not change.
- **Prints**: a job summary table of breaking changes, matched exceptions and versions,
  for the reviewer.

## G8 `api/v1` breaking report

- Same comparison on the `platform` bundle minus integration operations; never fails;
  posts each breaking change as a warning annotation (FR-024).

## G9 References build

- Builds `integration-reference.html` (published artefact) and
  `platform-reference.html` (developer artefact, retained 14 days, never published) with
  `redocly build-docs`; fails if either build fails or if the integration reference
  contains a path starting with `/v1/`.

## Local equivalent

`./taskw contract:check` runs G1, G3, G5, G6 and G7 locally; `php artisan test` runs G2
and G4; `php artisan contract:coverage` reads the coverage file the suite just wrote.
