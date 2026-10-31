# Architecture Decision Records

An ADR records one decision: the context, what was decided, and the consequences.

**Process.** ADRs are immutable once accepted. A decision changes only through a
new ADR that supersedes or amends it; the old ADR's status line is then updated to
point at the new one, and nothing else in it is edited. This keeps the reason for
each decision visible. Propose an ADR in a pull request alongside, or before, the
change it governs. Feature specs (Spec Kit, `specs/`) reference ADRs; they do not
replace them.

ADR-001 to ADR-008 were accepted before implementation started (August 2026).
ADR-009 to ADR-014 record decisions made during pilot and demo delivery
(September–October 2026) and were written down retroactively on 2026-10-11, with
the code as evidence.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-react-experience-layer.md) | React for customer and administration experiences | Accepted |
| [ADR-002](ADR-002-laravel-control-plane.md) | Laravel for public APIs, domain control and AI | Accepted |
| [ADR-003](ADR-003-go-data-plane.md) | Go for deterministic high-throughput execution | Accepted |
| [ADR-004](ADR-004-node-red-adapter-runtime.md) | Node-RED as the initial isolated adapter runtime | Superseded by ADR-010 |
| [ADR-005](ADR-005-sparkplug-b-boundary.md) | Sparkplug B as the external MQTT interoperability contract | Accepted; amended by ADR-009 and ADR-019 |
| [ADR-006](ADR-006-deployment-profiles.md) | Single-node Compose first, Kubernetes later | Accepted |
| [ADR-007](ADR-007-monorepo-and-shadcn-ui.md) | Cross-language monorepo with a shared shadcn UI foundation | Accepted |
| [ADR-008](ADR-008-laravel-sanctum-authentication.md) | Sanctum session cookies for the React apps, tokens for machine clients | Accepted; amended by ADR-018 |
| [ADR-009](ADR-009-mosquitto-default-broker.md) | Mosquitto is the default MQTT broker | Superseded by ADR-019 |
| [ADR-010](ADR-010-per-tenant-adapter-runtimes.md) | One Mosquitto ingress and Node-RED runtime per tenant, decoders in QuickJS | Accepted; amended by ADR-022 |
| [ADR-011](ADR-011-dag-automation-in-go.md) | Automation runs as a typed DAG (v2) in the Go runtime; workflow v1 is legacy | Accepted |
| [ADR-012](ADR-012-design-system-and-charts.md) | One design-system kit on shadcn/Radix with templates and guardrails; ECharts for charts | Accepted |
| [ADR-013](ADR-013-integer-user-ids.md) | Users are identified by integer id in API contracts | Accepted |
| [ADR-014](ADR-014-control-plane-data-plane-http-integration.md) | Laravel and Go integrate over internal HTTP with outboxes; JetStream stays inside Go | Accepted |
| [ADR-015](ADR-015-internal-contract-validation.md) | Internal messages are read tolerantly and the canonical envelope strictly; live contract checks only log and count | Accepted |
| [ADR-016](ADR-016-public-api-contract.md) | The public API contract is generated from Laravel, supplemented by hand and enforced in CI | Accepted |
| [ADR-018](ADR-018-agent-access-oauth.md) | AI agents sign in through Passport and act through connections; amends ADR-008 | Accepted |
| [ADR-019](ADR-019-mosquitto-only-broker.md) | Mosquitto is the only MQTT broker, in releases and development; supersedes ADR-009 | Accepted |
| [ADR-020](ADR-020-public-website.md) | Public website and developer docs: a static Astro site on Cloudflare, outside the product's deployment profiles | Accepted; amended by ADR-021 |
| [ADR-021](ADR-021-developer-docs-only.md) | The marketing website moves to its own repository; the platform's front door and developer docs stay here, published to GitHub Pages on the platform domain; amends ADR-020 | Accepted |
| [ADR-022](ADR-022-webhook-receiver.md) | A platform webhook receiver checks secrets and limits, then hands deliveries to each tenant's ingress broker; amends ADR-010 | Accepted |
| [ADR-023](ADR-023-protocol-connectors.md) | Every protocol is a connector feeding one telemetry envelope; Sparkplug B is the edge-gateway uplink; typed protocols use point maps | Accepted (direction) |
| [ADR-025](ADR-025-review-follows-current-birth.md) | A device's review follows its source's current birth: a later compatible birth clears it, and automations report `device_review_required` | Proposed |
| [ADR-026](ADR-026-billing-accounts.md) | Every organization belongs to one billing account; organizations stay independent tenants, and billing account owners create organizations under it within a limit | Accepted |
| [ADR-027](ADR-027-adapter-fed-activation-and-applied-generation.md) | An adapter-fed source activates against its stored birth when it has no live one; bindings use the applied generation, so a refused activation keeps them | Proposed |
| [ADR-028](ADR-028-activity-log.md) | The activity log on `spatie/laravel-activitylog` is the one audit trail; explicit actions by people and the system, read by platform administrators as a timeline | Proposed |

## Template

```markdown
# ADR-NNN: Title in Title Case

**Status:** Proposed | Accepted | Superseded by ADR-XXX | Amended by ADR-XXX
**Date:** YYYY-MM-DD
**Supersedes / Amends / Relates to:** ADR-XXX (optional)

## Context
What forces the decision; cite code, contracts or incidents.

## Decision
What we do, stated plainly.

## Consequences
What gets easier, what gets harder, known risks and follow-up work.
```
