# Definition Activation Contract

**Status:** Draft  
**Version:** 0.1  
**Last updated:** 2026-08-22

## Purpose

This contract implements the central boundary: Laravel owns versioned definitions and Go or Node-RED executes activated versions without per-message control-plane calls.

## Definition Types

- Device profile
- Signal mapping
- Runtime transformation
- Rule
- Adapter configuration
- Command policy
- Dashboard and report configuration where runtime compilation is required

## Lifecycle

```text
Draft → Validated → Tested → Active → Retired
```

An Active definition is immutable. A change creates a new version.

## Activation Flow

1. Laravel validates the draft and its dependencies.
2. Laravel writes the activation and an outbox event in one transaction.
3. The outbox publishes a versioned activation event to JetStream.
4. Runtime consumers fetch or receive the immutable definition payload.
5. Consumers compile and cache the version.
6. Consumers acknowledge readiness or publish a structured failure.
7. Laravel exposes desired and observed runtime state.

## Event Shape

```json
{
  "event_version": "definition.activated.v1",
  "definition_type": "device_profile",
  "definition_id": "profile_01",
  "version_id": "profile-version-12",
  "organization_id": "org_01",
  "activated_at": "2026-08-22T15:30:00Z",
  "artifact_uri": "object://definitions/profile-version-12.json",
  "artifact_hash": "sha256:...",
  "trace_id": "trace_02"
}
```

## Runtime Guarantees

- Consumers process activation idempotently.
- A definition is selected by explicit version ID, not mutable latest state.
- Previous versions remain available while assigned devices or in-flight events use them.
- Runtime compilation failure does not silently activate partial behavior.
- Desired version and observed loaded version are visible to administrators.
- Go can restart and rebuild its cache from authoritative activated definitions.

## Rollback

Rollback activates a known previous immutable version and publishes a new activation event. It does not edit history.

## Node-RED Application

Adapter activation includes an immutable flow artifact, dependency lock, fixture set, expected results, secret references, and configuration schema. The platform records whether the Node-RED runtime successfully applied the desired revision.

