# IoT OS Constitution

These principles are already true of the platform or were agreed when it was audited
in October 2026. Each cites where it comes from. Plans produced with Spec Kit are
checked against them (`/speckit-plan` "Constitution Check"); a plan that breaks one
records the justification in its Complexity Tracking table or proposes an ADR.

## Core Principles

### I. Laravel owns intent; Go executes

Laravel owns definitions, authorization, AI orchestration and every public API. The Go
runtime executes activated definitions and MUST NOT serve end users or external
applications. Clients (portal, admin, SDK, assistant) talk only to Laravel, never to
the database, NATS, the broker or the runtime. Laravel MUST NOT ingest telemetry or
evaluate rules; Go MUST NOT ask Laravel how to process an individual telemetry message.

*Rationale:* clear ownership, and telemetry keeps flowing while the control plane is
down. *Source:* ADR-002, ADR-003, ADR-014.

### II. Immutable versions, explicit activation

Device profiles, device configurations, workflow deployments and adapter revisions are
immutable once published. Editing creates a new draft. Nothing runs until it is
activated and the runtime acknowledges it. Desired and applied state are stored
separately and every change is fenced by a generation number.

*Rationale:* reproducible behaviour, safe rollback, no silent upgrades.
*Source:* docs/features/devices.md, docs/features/automation.md, ADR-014.

### III. Tenant isolation everywhere

Every tenant route resolves the organization and checks membership before permission.
Tenant identity comes from the authenticated session, token or broker credential,
never from a payload. Untrusted tenant code (adapter decoders) runs only in a
per-tenant sandbox. A change that touches tenant data MUST include a test proving
another organization cannot read or change it.

*Rationale:* one organization must never see or affect another.
*Source:* ResolveOrganizationContext, broker ACLs, ADR-010.

### IV. Contracts first

Data that crosses a language or process boundary has a versioned contract with golden
fixtures in `contracts/`; a contract change updates its fixtures and every consumer's
tests in the same pull request, and consumers reject versions they do not support.
Public HTTP API changes MUST update `packages/api-client` in the same pull request;
once the OpenAPI description exists (roadmap), they MUST update it and pass its drift
check. New user references in API contracts use the integer `user_id`.

*Rationale:* PHP, Go and TypeScript agree without sharing code.
*Source:* contracts/README.md, tooling/verify-devices-contracts.py, ADR-013.

### V. AI proposes, people approve

AI tools run with the requesting user's permissions and re-check them when they
execute. Writes are proposals a person reviews; AI MUST NOT publish, activate, deploy
or send device commands. Ingestion, rules, commands, dashboards and administration
MUST work with the assistant disabled, which is the default.

*Rationale:* AI is a convenience, not a privilege escalation or a dependency.
*Source:* docs/features/assistant.md, `IOT_ASSISTANT_ENABLED=false`.

### VI. Show uncertainty; never invent state

Missing data is unknown, not zero or healthy. Stale values are labelled with their
age. A command that may have been sent is "uncertain" and is never resent
automatically.

*Rationale:* operators act on what the platform shows.
*Source:* DeviceCommandService, docs/features/devices.md.

### VII. Durable, idempotent messaging

Delivery between components is at least once, and every consumer is idempotent
(inbox ledgers, unique event ids, generation fences). Ordered consumers retry
transient failures with backoff and dead-letter messages that can never succeed;
they MUST NOT retry a permanent failure forever. Outbox and deduplication ledgers are
pruned, but only beyond the broker's redelivery window, and data copies follow the
tenant's retention.

*Rationale:* one bad message must not stall a stream, and no table grows forever.
*Source:* services/runtime/internal/app/deadletter.go, docs/reference/events.md.

### VIII. One design system

UI composes `@iot-os/ui` templates and components: `CollectionPage` with `DataTable`
for lists, `Panel` for content, `statusOf`/`Status` for status, `RelativeTime` or
`Freshness` for times, and the named type scale. The `check-ui` guardrails MUST pass,
and every new kit component has a story.

*Rationale:* one product, not several.
*Source:* ADR-012, docs/dev/design-system.md, packages/ui/scripts/check-ui.mjs.

### IX. Done means verified where it runs

A change is done when CI passes (tests run on PostgreSQL/TimescaleDB, not SQLite), the
affected containers have been rebuilt, and the change has been exercised in the
running application without discarding anyone's unsaved edits. Simulator and fixture
success never stands in for hardware, load or production acceptance.

*Rationale:* containers build from source, and real devices differ from simulators.
*Source:* AGENTS.md, .agents/skills/local-container-verification,
docs/dev/simulators-and-fixtures.md.

## Engineering Constraints

- **Stack:** Laravel 13 on PHP 8.4 (Sanctum, Laravel AI), Go 1.27, React 19 with
  TanStack Query and shadcn/ui on Radix through `@iot-os/ui`, ECharts through
  `packages/charts`, PostgreSQL 17 with TimescaleDB, NATS JetStream inside the
  runtime, Sparkplug B over MQTT/TLS. Mosquitto is the default broker; EMQX remains
  for existing environments (ADR-009).
- **One product, several deployment profiles:** a single VM or on-premise host with
  Docker Compose first; Kubernetes profiles are future work (ADR-006).
- **Decisions are ADRs:** a change that contradicts an accepted ADR needs a new ADR
  that supersedes or amends it, in the same pull request.
- **Secrets never enter git:** private environment files, credentials, database dumps
  and release evidence live under the ignored `.local/` directory.

## Development Workflow and Quality Gates

- **Features use Spec Kit:** `/speckit-specify` → `/speckit-clarify` →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` →
  `/speckit-converge` (`$speckit-…` in Codex). Bug fixes and chores that change no
  behaviour or contract do not need a spec.
- **Specs are history:** each feature lives in `specs/NNN-name/`. The spec and plan merge
  first; implementation then lands in the pull requests the plan lists, each ticking its
  tasks. When the last of them merges, the folder is frozen. Lasting behaviour moves to
  `docs/features` or `docs/reference`, and decisions become ADRs. A later change gets a
  new spec.
- **Pull request gates:** CI (`.github/workflows/ci.yml`) is green; docs change in the
  same pull request as the behaviour they describe; contract, ADR and test updates
  follow principles IV and IX; the change has been verified in the rebuilt stack.
- **Small, reviewable changes:** split work so each pull request can be reviewed on
  its own; avoid mixing mechanical changes (formatting, moves) with behaviour changes.

## Governance

This constitution takes precedence over other process documents. The code is the
source of truth for behaviour; when a document disagrees with it, the document is
fixed.

Amendments are made by pull request. The pull request states the reason, cites the
ADR, document or code the principle rests on, and bumps the version: MAJOR for
removing or redefining a principle, MINOR for adding a principle or materially
expanding one, PATCH for wording. Reviewers and `/speckit-plan` check new work
against these principles; violations are either fixed or justified in the plan's
Complexity Tracking table.

**Version**: 1.0.1 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11
