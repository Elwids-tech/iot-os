# P1-M1: Control Plane Foundation

**Status:** Planned
**Outcome:** An authorized administrator can create an organization, model its first site and device, version a device profile, and activate an immutable definition for the Go runtime.
**Dependencies:** P1-M0

## P1-M1-E1: Identity, Tenancy, and Authorization

### P1-M1-E1-S1 — Bootstrap the first organization

**User story:** As a platform operator, I want to create the first administrator and organization so that a new installation can be owned safely.

**Acceptance criteria:** The bootstrap is single-use, secrets are not logged, the first administrator belongs to the organization, and every later request has an explicit tenant context.

**Engineering tasks:**

- [ ] T1 — Implement the Laravel installation/bootstrap workflow and state guard.
- [ ] T2 — Model users, organizations, memberships, and active tenant context.
- [ ] T3 — Expose versioned authentication and session endpoints for React clients.
- [ ] T4 — Build the admin bootstrap and sign-in experience with shared shadcn forms.
- [ ] T5 — Add audit events and feature/browser tests for success and replay attempts.

### P1-M1-E1-S2 — Enforce tenant roles and permissions

**User story:** As an organization administrator, I want role-based permissions so that users can only view or change the resources they are responsible for.

**Acceptance criteria:** Laravel policies enforce tenant and resource scope; React presents permitted actions but never acts as the authority; cross-tenant negative tests pass.

**Engineering tasks:**

- [ ] T1 — Define initial administrator, integrator, operator, and viewer capabilities.
- [ ] T2 — Implement policy and query scoping at Laravel domain boundaries.
- [ ] T3 — Return stable permission/error responses through the public API.
- [ ] T4 — Add shared React permission gates and clear denied states.
- [ ] T5 — Add cross-tenant, identifier-guessing, and revoked-membership tests.

## P1-M1-E2: Operational Domain Model

### P1-M1-E2-S1 — Model sites, assets, and relationships

**User story:** As an administrator, I want to represent where equipment belongs and how it relates so that users work with operational context rather than database resources.

**Acceptance criteria:** The API supports tenant-scoped sites, areas, assets, and typed relationships with validation that prevents invalid or cross-tenant links.

**Engineering tasks:**

- [ ] T1 — Define identifiers, lifecycle states, naming rules, and relationship types.
- [ ] T2 — Implement migrations, models, services, policies, resources, and API tests.
- [ ] T3 — Build task-oriented admin list, create, detail, and relationship surfaces.
- [ ] T4 — Add audit history and safe deletion/retirement behavior.

### P1-M1-E2-S2 — Register devices and governed signals

**User story:** As an integrator, I want to register a device and its expected signals so that incoming measurements can be validated and understood.

**Acceptance criteria:** Devices belong to an authorized operational context, use stable external identities, and reference typed signals with units, quality expectations, and lifecycle state.

**Engineering tasks:**

- [ ] T1 — Implement device, signal, channel, and external-identity domain objects.
- [ ] T2 — Enforce uniqueness and tenant-safe identity lookup rules.
- [ ] T3 — Expose versioned API resources and generated TypeScript client methods.
- [ ] T4 — Build device and signal management workflows using shared forms and tables.
- [ ] T5 — Add import-safe fixtures and authorization tests.

### P1-M1-E2-S3 — Version device profiles and mappings

**User story:** As an integrator, I want draft and immutable profile versions so that a mapping change cannot silently reinterpret live telemetry.

**Acceptance criteria:** Draft profiles can be validated and tested; active versions are immutable; changes create a new draft; assignments reference explicit version identifiers.

**Engineering tasks:**

- [ ] T1 — Model profiles, versions, signal definitions, mappings, validation results, and assignments.
- [ ] T2 — Implement draft, validate, test, activate, retire, and clone transitions.
- [ ] T3 — Provide fixture-based mapping validation without invoking the live data path.
- [ ] T4 — Build version comparison, validation-result, and activation confirmation UI.
- [ ] T5 — Record actor, reason, dependency versions, and result in the audit trail.

### P1-M1-E2-S4 — Register gateways and adapters

**User story:** As an integrator, I want to register gateways and desired adapter configurations so that connectivity can be governed independently of mutable runtime tools.

**Acceptance criteria:** Laravel owns gateway identity, adapter type, desired revision, secret references, assignments, and status projections without storing plaintext secrets or Node-RED flow state as domain truth.

**Engineering tasks:**

- [ ] T1 — Model gateways, adapter definitions, versions, assignments, and desired/observed state.
- [ ] T2 — Integrate secret references and redacted API resources.
- [ ] T3 — Build admin registration and status surfaces.
- [ ] T4 — Define runtime status and diagnostic event contracts.
- [ ] T5 — Add tenant, lifecycle, and secret-redaction tests.

## P1-M1-E3: Public API and Definition Activation

### P1-M1-E3-S1 — Publish the first stable public API contract

**User story:** As a React or future mobile developer, I want a versioned documented API so that clients do not depend on Laravel internals.

**Acceptance criteria:** Authentication, organizations, operational resources, profiles, gateways, and activation actions appear in committed OpenAPI; the generated client is current and errors use a stable envelope.

**Engineering tasks:**

- [ ] T1 — Define resource, pagination, filtering, validation-error, authorization-error, and correlation conventions.
- [ ] T2 — Generate and commit OpenAPI with examples and permission requirements.
- [ ] T3 — Generate the TypeScript client and expose it through `packages/api-client`.
- [ ] T4 — Add compatibility and stale-generation CI checks.
- [ ] T5 — Add API-level tenant-isolation tests.

### P1-M1-E3-S2 — Activate immutable definitions through the outbox

**User story:** As an administrator, I want to see desired and observed definition versions so that I know exactly what the runtime is executing.

**Acceptance criteria:** Laravel commits activation and outbox state atomically; JetStream delivers an idempotent activation event; the Go runtime validates, caches, and acknowledges the explicit version; failures remain visible and do not partially activate.

**Engineering tasks:**

- [ ] T1 — Finalize the draft definition-activation schema and compatibility policy.
- [ ] T2 — Implement Laravel activation service, transactional outbox, publisher, retries, and audit.
- [ ] T3 — Implement Go definition consumer, artifact verification, compile/cache step, and readiness acknowledgement.
- [ ] T4 — Expose desired, observed, failed, and superseded states through the API and admin UI.
- [ ] T5 — Test duplicate delivery, invalid artifact hash, runtime restart, unavailable broker, and rollback to a prior immutable version.

## Milestone Demonstration

An administrator signs in, creates an organization hierarchy, registers a gateway and device, authors and validates a profile, activates it, and sees the exact version acknowledged by the Go runtime. A user from another tenant cannot access any of those resources.

## Exit Criteria

- The public API is the only web/mobile management boundary.
- Tenant and permission negative tests cover every new resource family.
- Active definitions are immutable and traceable to actor and version.
- Laravel does not require Go to share its domain database tables.
- Go can rebuild its active-definition cache after restart.

