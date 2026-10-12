# ADR-016: The Public API Contract Is Generated from Laravel and Enforced in CI

**Status:** Accepted
**Date:** 2026-10-11
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-008](ADR-008-laravel-sanctum-authentication.md), [ADR-013](ADR-013-integer-user-ids.md)

## Context

The platform is sold as API-first, but its public HTTP API had no machine-readable
description. The portal and admin client ([`packages/api-client`](../../packages/api-client))
and the integration SDK ([`packages/integration-sdk`](../../packages/integration-sdk))
declare their types by hand, and drift between them and the API has caused bugs
(user references typed as UUIDs, ADR-013). Constitution principle IV requires a
versioned contract with a drift check once the description exists. The full reasoning
and alternatives are in [spec 001](../../specs/001-openapi-contract/research.md).

## Decision

- **One OpenAPI 3.1 document**, [`contracts/openapi/openapi.json`](../../contracts/openapi),
  describes every operation under `/api/v1` and `/api/integration/v1`. `/api/internal`
  and the operational routes outside `/api` are not part of it.
- **Generated, never hand-edited.** `php artisan contract:export` builds it with
  Scramble (`dedoc/scramble`, a dev dependency pinned exactly) from the routes, path
  constraints, validation rules and resources, and project code in
  `apps/api/app/Support/Contract` adds what inference cannot know: authentication and
  abilities from each route's middleware, rate limits, organization scoping and the
  shared error responses. Hand-written YAML supplements in
  `contracts/openapi/supplements/` describe what code cannot say (hand-built and
  runtime-shaped bodies, examples, the event envelope and webhook); a supplement cannot
  add an operation. Scramble's own `/docs/api` routes are off in every environment, and
  release images, built without dev dependencies, do not contain it.
- **Response bodies are described honestly or marked pending.** Operations listed in
  `contracts/openapi/pending-schemas.json` have open success bodies and
  `x-schema-status: pending`; the list only shrinks.
- **CI enforces it.** The API job fails when the committed document differs from a fresh
  export (G1), when the router and the document disagree (G2, a test), and when an
  operation outside the pending list has an open body or the list grows (G3). Later
  pull requests in spec 001 add response checks in the test suite, linting, generated
  client types and a breaking-change gate for the integration API.

## Consequences

- An API change without a matching contract change fails the build, and so does a
  contract edit without a platform change.
- Scramble pins change the output: upgrading it is a pull request of its own that
  re-exports the contract.
- Export reads the database schema, so it migrates a private SQLite database first;
  the result is the same on every machine.
- Developers run `php artisan contract:export` after changing a route, a validation rule
  or a resource, and commit the result with the code.
- Until the pending list is empty, clients cannot rely on the contract for the bodies
  of pending operations; their status codes, parameters and authentication are checked.
