# Device Definition Contracts

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
