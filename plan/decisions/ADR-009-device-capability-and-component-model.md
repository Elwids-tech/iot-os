# ADR-009: Device Capability and Component Model

**Status:** Accepted
**Date:** 2026-08-28

## Context

Manufacturers publish telemetry, state, events, and command payloads in different JSON shapes. A physical product may expose several logical modules, such as an environmental sensor and thermostat, without those modules having independent credentials or lifecycles. Conversely, a Gateway may authenticate once and represent several independently registered downstream Devices.

The Device Profile must describe stable product meaning without forcing manufacturer payloads into one platform envelope or confusing components with Gateways and child Devices.

## Decision

Use a standards-aligned capability model inspired by Azure DTDL/IoT Plug and Play and W3C Web of Things while keeping `iot.device-profile.v1` as the platform contract.

A Device Profile Version contains:

- one implicit root component and optional named, one-level components;
- typed telemetry, including dependency-checked derived telemetry;
- `platform`, `desired`, and `reported` properties;
- named stateless or stateful events with typed fields; and
- one-way or two-way Commands with typed input/output fields and risk metadata.

Capabilities use stable component-qualified keys. Types are `float64`, `int64`, `uint64`, `boolean`, `string`, `bytes`, or `state`. Units use UCUM codes. Source timestamps, Device IDs, and message IDs are transport-envelope metadata rather than telemetry capabilities.

One MQTT message may contain several values. A Binding may also select a bounded array of records and dispatch event records through a discriminator. A Gateway is required only when one authenticated edge identity publishes for independently registered downstream Devices.

## Consequences

- A temperature/humidity/thermostat product remains one Device with optional semantic components.
- Manufacturer JSON and topic choices do not leak into Device Profiles.
- Separate event topics and discriminator-based event envelopes are both representable.
- Nested components, downstream Gateway mediation, formal DTDL/WoT export, and bulk Device creation remain later extensions.
- Display metadata may improve generated forms but cannot weaken semantic validation or authorization.
