# Definition of Ready and Done

**Status:** Accepted delivery approach
**Last updated:** 2026-08-22

## Definition of Ready

A user story may move to `Ready` when:

- The actor, outcome, and acceptance criteria are clear.
- The owning plane and affected contracts are identified.
- Required design or API decisions are accepted or represented by a time-boxed spike.
- Dependencies and test fixtures are available or explicitly scheduled.
- Tenant, authorization, data sensitivity, and device-control risk are classified.
- The story is small enough to review and integrate safely; work larger than size 5 is split.
- The evidence required to mark it complete is stated.

## Definition of Done for a Story

A story is Done only when all applicable items are satisfied:

### Behavior and Contracts

- Acceptance criteria pass at the observable boundary.
- Public APIs, events, definitions, and ingestion schemas are versioned where applicable.
- Failure, timeout, retry, duplicate, and unavailable-dependency behavior is deliberate.
- Tenant isolation and authorization are tested, including a negative case.

### Code Quality

- Automated tests exist at the appropriate unit, contract, integration, or browser level.
- Formatting, linting, static analysis, and builds pass for affected workspaces.
- No secret, tenant identifier, or unsafe raw payload leaks into logs or fixtures.
- Migrations and rollback/forward-recovery behavior are documented when state changes.

### Experience

- React work uses the shared shadcn foundation and covers loading, empty, error, and permission states.
- Keyboard navigation, accessible names, focus behavior, and responsive behavior are checked.
- AI-generated configuration remains reviewable and follows the normal activation path.
- Device-control actions include the required confirmation and visible status lifecycle.

### Operability

- Structured logs, metrics, traces, audit events, and health signals exist where applicable.
- A supportable diagnostic is available without direct database or broker access.
- Documentation, fixtures, examples, and root developer commands are current.
- The pull request links the story and records verification evidence.
