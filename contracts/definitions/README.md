# Device Definition Contracts

## Version 2 rectification

The v2 contracts coexist with v1 and do not reinterpret existing documents. They establish:

- dynamically authored measured and derived parameters with required stable UUIDs;
- optional type-aware presentation metadata without adding metadata to MQTT payloads;
- parameter-UUID mappings with explicit `on_missing` and `on_invalid` behavior;
- ordered structured calibration operations plus restricted CEL;
- separate semantic Commands and MQTT request/response mappings;
- Gateway communication identity, Gateway-to-logical-Device routes, and payload scopes;
- route-aware Runtime Bundles and canonical telemetry identified by Device and parameter UUID; and
- semantic fixture checks for UUID uniqueness, derivation cycles, target resolution, type compatibility, route/channel compatibility, and bounded topic variables.

The JavaScript semantic checks lock contract invariants before the authoritative Go v2 compiler exists. D4R3 must implement the same diagnostics and stronger CEL/type analysis; passing the contract checks is not runtime-ingestion evidence.

These JSON Schema 2020-12 contracts separate authoring input from immutable
published artifacts.

- An authoring document is editable, may include optional child UUIDs, and is
  used by Laravel forms, APIs, AI proposals, and compiler requests.
- An artifact is normalized compiler output. It carries exact resource IDs,
  source hashes, compiler metadata, and immutable capability or mapping data.
- A Device Profile is semantic and transport-independent.
- A Native MQTT Binding targets one exact Profile Version and owns all
  manufacturer wire-format concerns.

The authoritative compiler planned in ADR-011 must apply cross-document rules
that JSON Schema cannot prove, including key uniqueness, mapping target
existence, channel-purpose compatibility, CEL type checking, event dispatch,
and Command request/response correlation.

The broader activation boundary remains documented in
[`plan/contracts/definition-activation.md`](../../plan/contracts/definition-activation.md).
