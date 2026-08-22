# P1-M5: Single-Node Production Readiness

**Status:** Planned
**Outcome:** A fresh supported VM or on-premise computer can run a versioned, secure, observable, recoverable platform release and complete the full Phase 1 journey.
**Dependencies:** All Phase 1 capability gates; operational tasks begin during earlier milestones

## P1-M5-E1: Reproducible Single-Node Release

### P1-M5-E1-S1 — Package a versioned production profile

**User story:** As a platform operator, I want one versioned release manifest so that every service and migration belongs to a known compatible platform version.

**Acceptance criteria:** Signed or checksummed artifacts identify compatible React, Laravel, Go, EMQX, NATS, Node-RED, database, and configuration versions; the production Compose profile uses persistent paths, health checks, resource guidance, and no development defaults.

**Engineering tasks:**

- [ ] T1 — Build immutable application and adapter images with version and source metadata.
- [ ] T2 — Define the release manifest, compatibility policy, configuration schema, and checksums.
- [ ] T3 — Create the production Compose profile, dependency ordering, health checks, and persistent-volume map.
- [ ] T4 — Add migration ordering and compatibility preflight checks.
- [ ] T5 — Generate an SBOM and vulnerability report for release artifacts.
- [ ] T6 — Verify the profile on the minimum supported host specification.

### P1-M5-E1-S2 — Guide installation and initial setup

**User story:** As a self-hosting customer, I want clear preflight and setup guidance so that I can reach the first live datapoint without becoming an expert in every internal service.

**Acceptance criteria:** The installation flow checks host, ports, clock, disk, container runtime, DNS/TLS, persistent paths, and release integrity; it generates secrets, starts the platform, and hands off to a React setup wizard.

**Engineering tasks:**

- [ ] T1 — Provide versioned install, status, doctor, and log-collection commands through the initial release tooling.
- [ ] T2 — Generate strong service credentials and certificates without printing secrets to normal logs.
- [ ] T3 — Implement Laravel setup state and a React wizard for administrator, organization, first site, gateway, device, and optional AI provider.
- [ ] T4 — Add end-to-end health verification and actionable failure remediation.
- [ ] T5 — Document internet-required, optional AI, proxy, private certificate, and offline-operation behavior.
- [ ] T6 — Keep the fuller `platformctl` interface planned without making unimplemented commands a Phase 1 promise.

## P1-M5-E2: Backup, Restore, and Upgrade

### P1-M5-E2-S1 — Back up and restore operational state

**User story:** As a platform operator, I want encrypted, verifiable backups so that a host failure does not destroy configuration, telemetry, adapter artifacts, or audit history.

**Acceptance criteria:** The runbook and automation cover PostgreSQL/TimescaleDB, object/artifact storage, Node-RED flow artifacts, required JetStream state, configuration, and secrets; restore is tested onto a clean host and reconciles runtime definitions.

**Engineering tasks:**

- [ ] T1 — Define recovery point and recovery time targets for the single-node profile.
- [ ] T2 — Implement scheduled database backup and WAL/archive strategy appropriate to the release.
- [ ] T3 — Back up versioned artifacts, adapter flows, configuration, and required secrets securely.
- [ ] T4 — Document JetStream snapshot, replay, and disposable/rebuildable stream boundaries.
- [ ] T5 — Automate restore validation and post-restore definition/runtime reconciliation.
- [ ] T6 — Record restore evidence with counts, versions, health, and representative telemetry queries.

### P1-M5-E2-S2 — Upgrade and roll back safely

**User story:** As a platform operator, I want an upgrade preflight and recovery path so that a failed release does not leave the installation in an unknown partial state.

**Acceptance criteria:** The release tool verifies compatibility and backup state, applies services and migrations in a documented order, runs health checks, and supports documented rollback or forward-recovery according to migration safety.

**Engineering tasks:**

- [ ] T1 — Define semantic platform versioning and supported upgrade paths.
- [ ] T2 — Add pre-upgrade backup, disk, configuration, and compatibility checks.
- [ ] T3 — Define expand/contract database migration rules across Laravel and Go-owned schemas.
- [ ] T4 — Implement staged service update and post-upgrade contract/health verification.
- [ ] T5 — Test interrupted upgrade, incompatible definition, migration failure, and application rollback/forward-recovery.

## P1-M5-E3: Operability and Security

### P1-M5-E3-S1 — Observe and diagnose the platform

**User story:** As a platform operator, I want one health and diagnostic view so that I can identify which plane is degraded without reading raw databases or broker internals.

**Acceptance criteria:** The platform exposes service health, dependency status, ingestion rates/errors, stream backlog, database/storage pressure, adapter health, rule failures, command outcomes, and version drift through safe metrics, logs, and admin diagnostics.

**Engineering tasks:**

- [ ] T1 — Standardize structured logs, correlation IDs, metrics, health, readiness, and build metadata.
- [ ] T2 — Add lightweight dashboards and alert thresholds for the single-node profile.
- [ ] T3 — Build an admin system-health experience with redacted detail and troubleshooting guidance.
- [ ] T4 — Create a redacted support bundle containing versions, configuration shape, health, logs, and recent diagnostic summaries.
- [ ] T5 — Test disk pressure, broker backlog, database outage, expired certificate, failed adapter, and version drift.

### P1-M5-E3-S2 — Harden the production boundary

**User story:** As a customer security owner, I want a documented and tested security baseline so that the installation does not expose internal services or unsafe defaults.

**Acceptance criteria:** Only intended device and application endpoints are exposed; TLS, secret storage, tenant policies, rate limits, container restrictions, dependency scanning, audit retention, and update guidance are documented and tested.

**Engineering tasks:**

- [ ] T1 — Produce a threat model covering public API, MQTT, HTTP ingress, NATS, Node-RED, AI providers, commands, backup, and support bundles.
- [ ] T2 — Restrict network exposure, service accounts, container privileges, volumes, and egress.
- [ ] T3 — Configure TLS renewal, password/credential rotation, session policy, and secure headers.
- [ ] T4 — Add dependency, container, secret, and license scanning release gates.
- [ ] T5 — Define audit retention, sensitive-data redaction, AI-provider data controls, and incident evidence preservation.
- [ ] T6 — Run the documented security test checklist and record residual risks.

## P1-M5-E4: Phase 1 Release Acceptance

### P1-M5-E4-S1 — Prove the complete journey on a clean host

**User story:** As the product team, we want one repeatable acceptance run so that Phase 1 completion is evidence-based rather than inferred from merged code.

**Acceptance criteria:** A clean supported host completes installation, organization and device setup, MQTT and HTTP ingestion, Sparkplug discovery, one Node-RED adapter, profile activation, rule execution, command acknowledgement, AI-assisted draft, backup, restore, upgrade verification, and safe degraded operation without AI.

**Engineering tasks:**

- [ ] T1 — Create a versioned end-to-end acceptance runbook and automated checks where deterministic.
- [ ] T2 — Prepare stable native JSON, Sparkplug, adapter, rule, command, and AI evaluation fixtures.
- [ ] T3 — Capture runtime versions, health, traces, audit events, telemetry queries, UI evidence, backup, and restore results.
- [ ] T4 — Verify the platform remains operational with the AI provider disabled and tolerates temporary Laravel unavailability in the loaded telemetry path.
- [ ] T5 — Record performance on the minimum host and document measured limits rather than unsupported scale claims.
- [ ] T6 — Reconcile the plan so completed, deferred, residual-risk, and follow-on items are accurately labelled.

## Milestone Demonstration

On a clean supported VM or on-premise machine, the team installs the versioned release, completes the first-datapoint journey and all Phase 1 capabilities, creates a backup, restores it, verifies definitions and telemetry, performs the supported upgrade check, generates a redacted support bundle, and demonstrates deterministic operation without an AI provider.

## Exit Criteria

- Installation and recovery succeed from documented artifacts on a clean host.
- No internal database, NATS, Node-RED editor, or administration endpoint is unintentionally public.
- Backups have current restore evidence.
- Release artifacts have version, integrity, dependency, and vulnerability evidence.
- All ten Phase 1 acceptance outcomes are demonstrated and recorded.

