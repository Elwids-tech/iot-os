# P1-M4: Automation, Commands, and AI

**Status:** Planned
**Outcome:** An authorized user can create and simulate a stateful rule, safely execute and audit a device command, and use contextual AI to produce a reviewed draft without bypassing deterministic policies.
**Dependencies:** P1-M1 and P1-M2; P1-M3 for adapter-mediated commands

## P1-M4-E1: Deterministic Rules

### P1-M4-E1-S1 — Author, validate, and simulate a rule

**User story:** As an operations engineer, I want to test a rule against recorded data before activation so that I can understand its behavior and avoid noisy or unsafe automation.

**Acceptance criteria:** Laravel owns draft and immutable rule versions, validates signal and action references, simulates against a bounded historical sample, explains transitions, and requires explicit activation.

**Engineering tasks:**

- [ ] T1 — Define the initial rule model for comparisons, duration, debounce, sliding window, schedule, severity, and actions.
- [ ] T2 — Define a versioned compiled-rule contract consumed by Go.
- [ ] T3 — Implement Laravel draft, validate, simulate, activate, retire, clone, and audit workflows.
- [ ] T4 — Implement a deterministic Go simulation path using the same evaluator as live execution.
- [ ] T5 — Build the React rule builder and simulation results with shared shadcn form, table, Alert, Badge, and chart components.
- [ ] T6 — Add fixtures for gaps, poor quality, late data, threshold crossings, and insufficient history.

### P1-M4-E1-S2 — Evaluate active stateful rules

**User story:** As an operator, I want active rules to evaluate reliably across restarts and duplicate messages so that alerts reflect equipment state rather than processing accidents.

**Acceptance criteria:** Go executes only active versions, maintains bounded state, tolerates redelivery and restart, emits one traceable transition event, and exposes runtime state and failures without synchronously consulting Laravel per message.

**Engineering tasks:**

- [ ] T1 — Implement compiled rule cache, state store, timers/windows, and versioned state ownership.
- [ ] T2 — Implement idempotent transition and recovery behavior.
- [ ] T3 — Publish deterministic triggered, cleared, suppressed, and failed events.
- [ ] T4 — Project operational alerts/events into Laravel workflows and the portal.
- [ ] T5 — Test duplicates, replay, restart, rule-version switch, out-of-order data, and unavailable side-effect consumers.

## P1-M4-E2: Safe Device Commands

### P1-M4-E2-S1 — Authorize and approve a command request

**User story:** As an authorized operator, I want to understand and confirm a device command before it is sent so that control actions are deliberate and attributable.

**Acceptance criteria:** Laravel validates tenant, resource, command schema, current permission, policy, risk, expiry, and required confirmation; it records an immutable business request and transactional outbox event.

**Engineering tasks:**

- [ ] T1 — Model command definitions, parameters, policies, risk levels, requests, approvals, and business states.
- [ ] T2 — Implement authorization, step-up confirmation, expiry, cancellation, and idempotency.
- [ ] T3 — Build command preparation and explicit confirmation UI with shared shadcn Field, AlertDialog, Alert, and status patterns.
- [ ] T4 — Prevent stale, repeated, cross-tenant, unauthorized, and unsupported requests.
- [ ] T5 — Audit actor, resource, parameters, policy decision, approval, correlation, and outcome.

### P1-M4-E2-S2 — Deliver and acknowledge commands

**User story:** As an operator, I want to see whether an authorized command was queued, sent, acknowledged, failed, or timed out so that I never confuse request acceptance with device execution.

**Acceptance criteria:** Go consumes an authorized command event, executes the selected native or adapter path with bounded retries and timeout, normalizes acknowledgement, and publishes status transitions that Laravel projects into the business request.

**Engineering tasks:**

- [ ] T1 — Finalize command, status, acknowledgement, error, and correlation contracts.
- [ ] T2 — Implement Go dispatcher, transport selection, retry, timeout, deduplication, and cancellation boundaries.
- [ ] T3 — Implement MQTT/Sparkplug command encoding for the first supported command path.
- [ ] T4 — Implement Node-RED downlink encoding and acknowledgement for one adapter-managed path where applicable.
- [ ] T5 — Project runtime status to Laravel and render a live command timeline in the portal.
- [ ] T6 — Test offline device, duplicate request, late acknowledgement, timeout, retry exhaustion, restart, and unauthorized cancellation.

## P1-M4-E3: Laravel AI Agent Foundation

### P1-M4-E3-S1 — Establish authorized agent tools

**User story:** As a platform user, I want the AI assistant to work within my current tenant and permissions so that it can help without becoming an alternate security boundary.

**Acceptance criteria:** Laravel AI invokes typed domain tools classified as Read, Configure, or Control; every call applies policy and tenant scope, minimizes output, records audit, and supports approval where required.

**Engineering tasks:**

- [ ] T1 — Define the agent, conversation, tool, context, approval, retention, and provider abstractions.
- [ ] T2 — Create the tool registry with input/output schemas, permissions, risk, timeout, and audit policy.
- [ ] T3 — Implement initial read tools for assets, devices, recent measurements, events, alarms, and gateway diagnostics.
- [ ] T4 — Implement streaming and approval events for `packages/agent-ui` without exposing model credentials.
- [ ] T5 — Add provider-disabled and provider-unavailable behavior so deterministic product workflows remain usable.
- [ ] T6 — Test prompt/tool attempts to escape tenant scope, call undeclared tools, or bypass approval.

### P1-M4-E3-S2 — Draft an integration with AI assistance

**User story:** As an integration developer, I want AI to turn protocol documentation and samples into draft mappings and fixtures so that proprietary onboarding starts faster without silently deploying generated code.

**Acceptance criteria:** The integration assistant can inspect authorized samples, propose a mapping/decoder/profile and fixtures, run deterministic tests, explain uncertainty, and save only a reviewable draft through normal Laravel services.

**Engineering tasks:**

- [ ] T1 — Add tools for safe sample inspection, draft mapping/profile creation, fixture generation, and isolated test execution.
- [ ] T2 — Provide active gateway, adapter, device, and profile context from the onboarding workspace.
- [ ] T3 — Render proposed changes, assumptions, fixture results, and validation failures in `packages/agent-ui`.
- [ ] T4 — Require ordinary review and activation; prohibit direct Node-RED deployment or profile activation by the model.
- [ ] T5 — Add deterministic evaluation cases for valid, ambiguous, malicious, and unsupported payload samples.

### P1-M4-E3-S3 — Investigate an operational change with AI assistance

**User story:** As an operator, I want a contextual explanation of a device or asset change so that I can investigate faster without manually correlating every event and measurement.

**Acceptance criteria:** The operations assistant uses bounded query tools to summarize recent measurements, quality, presence, alarms, commands, and configuration changes; it cites platform evidence and clearly represents missing or unavailable data.

**Engineering tasks:**

- [ ] T1 — Add scoped comparison, event-correlation, active-definition, and command-history tools.
- [ ] T2 — Add contextual assistant entry points to device, gateway, asset, and alarm surfaces.
- [ ] T3 — Display tool evidence, time range, resource scope, and uncertainty alongside the answer.
- [ ] T4 — Bound query volume and summarize telemetry deterministically before model context assembly.
- [ ] T5 — Test cross-tenant resistance, missing history, conflicting evidence, provider failure, and audit completeness.

## Milestone Demonstration

An operations engineer drafts and simulates a duration rule, activates it, and observes one deterministic trigger. An authorized operator prepares and confirms a command and watches it progress through acknowledgement and audit. The integration assistant creates a fixture-tested draft profile or mapping, but cannot activate it or issue a command without the normal policy path.

## Exit Criteria

- Laravel owns definitions, authorization, approvals, business status, and AI tools.
- Go owns stateful rule and command runtime execution.
- Every runtime result identifies the executed definition or command version.
- AI tools cannot bypass tenant scope, activation, or command policy.
- Rules and commands remain fully usable when no AI provider is configured.

