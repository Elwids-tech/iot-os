# Devices v1 — accepted delivery plan

Status: implemented; local simulator acceptance passed on 2026-09-06. Accepted in the Devices planning conversation on 2026-09-05. Runtime container packaging remains unverified after registry timeouts; hardware and production verification remain separate.

## Outcome

An organization can register or discover devices, select an immutable published profile, map Sparkplug metrics, validate and activate a configuration, view current and historical measurements, and issue explicitly confirmed state-setting commands. Local acceptance uses an energy-meter simulator and an RGB-light simulator on EMQX.

## Decisions

- Sparkplug B 3.0 on the existing managed EMQX deployment; one active Go runtime.
- Laravel owns identity, authorization, configuration, approval, audit and public APIs. Go owns sessions, telemetry, history, calculations and transport execution. JetStream carries durable internal events.
- Edge Nodes are gateway/source records. Sites, assets, UNS hierarchy, AI chat and active alarms are deferred.
- Device registration, desired/applied configuration, connection presence and measurement quality are independent.
- Device configurations pin profile artifact UUID/hash and parameter UUIDs. Profile publication never activates or upgrades a device. Historical artifacts remain valid for pinned devices.
- Device mappings are independent drafts. Activation freezes a snapshot. Upgrades and rollback are explicit and within the same profile.
- Commands set reported states only. Confirmation, fresh-session validation, per-parameter exclusion, idempotency, a 30-second deadline and subsequent live observation are required. Uncertain sends must not be replayed.
- Retention resolves organization override, saved platform default, then 90 days. Platform administrators edit persisted settings. Daily cleanup is organization-scoped and uses trusted receipt time; configuration and command audit are excluded.
- Existing profile/admin work must be preserved. Simulator verification is not hardware or production verification.

## Delivery and evidence

1. Contracts: executable configuration/telemetry/event fixtures; pinned official Sparkplug protobuf.
2. Foundation: tenant-scoped records, permissions, immutable artifact assignment, registration screens.
3. Monitoring: TLS/ACL provisioning, simulators, discovery, sample validation, activation, measurements and diagnostics.
4. History: bounded queries, charts, persisted retention settings and cleanup.
5. Control: preparation, confirmation, dispatch, observed-state verification and audit.
6. Verification: isolated API, Go, cross-language, integration and browser checks; recovery documentation.

All six stages passed local simulator acceptance. Setup, recovery, test evidence, and the outstanding container-build limitation are recorded in the [Devices v1 guide](../../docs/devices-v1.md). Hardware and production verification are not implied.
