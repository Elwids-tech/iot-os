# Quickstart: Public API Contract

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Two parts: how a developer changes the API once the contract exists, and the scenarios
that prove the feature works. Commands are run from the repository root unless a
`cd` is shown. Gate ids (G1 to G9) refer to [contracts/ci-gate.md](contracts/ci-gate.md).

## Prerequisites

- `apps/api/vendor` installed (in a fresh worktree, clone it as described in
  `docs/dev/gotchas.md`) and `pnpm install` done.
- Go available (the repository's toolchain) for `oasdiff` through `go run`.
- Without `.env`, run PHP commands with a throwaway key:
  `APP_KEY="base64:$(openssl rand -base64 32)"`.

## Part A: adding or changing an endpoint

1. **Write the route and controller as usual.** Validation in a form request or an
   inline `$request->validate()` is picked up automatically, as are path constraints,
   API resources and `abort()` statuses.
2. **Export the contract.**

   ```bash
   cd apps/api && php artisan contract:export
   ```

   This rewrites `contracts/openapi/openapi.json`. Never edit that file by hand.
3. **Describe the response if the export could not.** Run `php artisan contract:check`.
   If it reports an open schema for your operation, add an entry for
   `"METHOD /v1/..."` to the domain's `contracts/openapi/supplements/<domain>.yaml`
   (format: [contracts/supplement.schema.json](contracts/supplement.schema.json)), or add
   a `@response` annotation in the controller, then export again. Reuse shared
   components (`ErrorMessage`, `ValidationError`, `CompactPage`, …) and `$ref` existing
   schemas in `contracts/` instead of copying them. User ids are integers (ADR-013).
   A new operation cannot be added to `pending-schemas.json`: that list only shrinks.
   Validation in a helper method is invisible to the export: describe query parameters
   with Scramble's `#[QueryParameter]` attribute on the action, and a request body the
   export cannot infer with `requestBody` in the supplement.
4. **Test it.** Your feature test's responses are checked against the contract
   automatically.

   ```bash
   cd apps/api && php artisan test --compact && php artisan contract:coverage
   ```

   A mismatch fails the test that made the request and names the JSON pointer.
   Integration operations need a 2xx, 401, 403 and 404 (and 422 when they take
   input); add your operation to `OPERATIONS` (and, with input, `INVALID_INPUT`) in
   `tests/Feature/Contract/IntegrationContractTest.php`, and give its success response
   an example.
5. **Regenerate types and check everything.**

   ```bash
   pnpm contract:types        # writes packages/*/src/generated/contract.ts
   ./taskw contract:check     # G1, G3, G5, G6, G7 locally
   pnpm --filter @iot-os/api-client typecheck
   ```

   If you changed a client-library or SDK type, use the generated alias rather than a
   hand-written shape.
6. **Integration API only: breaking changes.** If G7 reports a breaking change you
   intend, add an entry to `contracts/openapi/breaking-exceptions.json`
   ([format](contracts/breaking-exceptions.schema.json)) with the reason, bump
   `packages/integration-sdk/package.json`, bump `info.version` in
   `contracts/openapi/supplements/info.yaml`, and say so in the pull request. Any
   integration change, breaking or not, needs an `info.version` bump.
7. **Commit together**: code, `openapi.json`, supplements, generated types and docs.

## Part B: validation scenarios

### B1. The integration contract is complete and checked (Story 1, SC-001)

```bash
cd apps/api && php artisan test --compact tests/Feature/Contract tests/Feature/Domain/Integrations tests/Feature/Domain/Geospatial && php artisan contract:coverage
```

Expected: pass; the coverage report has 78 required pairs, all checked: a 2xx, 401,
403 and 404 for each of the 18 integration operations, and a 422 for the 6 with a
request body or a required query parameter. The success responses come from the
domain tests, so `--filter=Contract` alone is not enough; once `api/v1` operations
are fully described (PR 6 on), run the whole suite before `contract:coverage`.

### B2. Seeded drift fails (Story 2, SC-003)

In a scratch branch, apply each change on its own and run the gate shown. Each must
fail with a line naming the operation; revert before the next.

| # | Change | Gate that fails |
| --- | --- | --- |
| 1 | Add `Route::get('v1/organizations/{organization}/ping', …)` | G1 (and G3: open schema) |
| 2 | Delete the `alerts/{alert}/comments` GET route | G1 |
| 3 | Change `whereUuid('device')` to no constraint on a devices route | G1 |
| 4 | Rename `presence` to `state` in the integration device response | G4; if the contract is updated to match, G7 |
| 5 | Return `episode` as a string in the integration alert | G4 |
| 6 | Add `'note' => 'required|string'` to a validated request | G1 |
| 7 | Change `AuthenticateApplication::class.':devices:read'` to `':alerts:read'` | G1, G2, G7 |
| 8 | Edit `contracts/openapi/openapi.json` by hand | G1 |
| 9 | Add a new `api/v1` operation with a description but no response schema | G3 |
| 10 | Add an entry to `pending-schemas.json` | G3 |

Then: make change 4 together with an exception entry, an SDK version bump and an
`info.version` bump; G7 passes and prints the exception in the job summary.

### B3. The tenant API inventory and the first 74 (Story 3, SC-002)

```bash
cd apps/api && php artisan contract:check && php artisan test --compact --filter=RouteInventory
jq '.operations | length' ../../contracts/openapi/pending-schemas.json   # 155
```

### B4. Client types come from the contract (Story 4, SC-004, SC-006)

```bash
pnpm contract:types --check
pnpm --filter @iot-os/api-client typecheck
pnpm --filter @iot-os/portal --filter @iot-os/admin lint
pnpm --filter @iot-os/integration-sdk --filter @iot-os/vertical-demo test
```

Expected: no differences; type checks pass; the SDK tests include an
`automation.triggered.v1` event (typed) and an invented `example.future.v1` event
returned as `type: "unknown"` from both `events()` and `verifyWebhook()`.

### B5. References (Story 5)

```bash
pnpm contract:docs
grep -c '"/v1/' contracts/openapi/dist/integration-reference.html   # 0
```

Open `contracts/openapi/dist/integration-reference.html` in a browser: 18 operations,
the event feed with an example, abilities and rate limits on each operation.

### B6. Behaviour unchanged (SC-005)

```bash
cd apps/api && php artisan route:list --json --path=api > /tmp/routes-after.json
# compare with the same command on main: identical for api/v1 and api/integration/v1
php artisan test --compact
```

Then rebuild the affected containers (api, portal, admin) as in
`.agents/skills/local-container-verification/SKILL.md`, confirm `/docs/api` returns
404 on the API, and load the portal's devices, alerts and dashboards pages and the
admin's organizations page without errors.
