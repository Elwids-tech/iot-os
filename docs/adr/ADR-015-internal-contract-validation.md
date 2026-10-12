# ADR-015: Internal Contract Validation and Evolution

**Status:** Accepted
**Date:** 2026-10-11
**Relates to:** [ADR-005](ADR-005-sparkplug-b-boundary.md), [ADR-014](ADR-014-control-plane-data-plane-http-integration.md)

## Context

Laravel and the Go runtime exchange 7 control message types, 16 runtime event
types, the outbox claim and acknowledgement wrappers, the automation command
check and the `/state` reconciliation snapshot over internal HTTP
([ADR-014](ADR-014-control-plane-data-plane-http-integration.md)). Only some of
these have a schema in [`contracts/`](../../contracts/README.md), and five of the
existing schemas no longer describe what is sent (committed telemetry, the
internal telemetry message, activation, command, and device configurations with
an adapter binding). Nothing caught the drift: the PHP and Go tests compare
output with fixtures instead of validating it, and
[`tooling/verify-devices-contracts.py`](../../tooling/verify-devices-contracts.py)
validated fixtures only, in hard-coded directories.

The unknown-field policy was also inconsistent. Every schema is closed
(`additionalProperties: false`), yet the runtime's control decoder and Laravel
already ignore unknown fields, and the contract rules promised additive changes
within a major version, which a closed schema read strictly cannot honour.

[ADR-005](ADR-005-sparkplug-b-boundary.md) keeps the platform's canonical model
independent of Sparkplug. Spec 002 defines that model as a canonical telemetry
envelope with presence, announcement and rejection messages, before any
component produces or consumes it.

## Decision

**Language.** Every contract is a JSON Schema Draft 2020-12 document with a
golden fixture (`<id>.fixture.json`) and, for new or corrected contracts, a cases
file (`<id>.cases.json`) of valid and invalid examples. Each invalid case names the
keyword and instance location it must fail on. The canonical envelope is JSON; a
binary encoding, if the ingestion spec adds one, keeps the field names and
meanings.

**Layout and identity.** Internal messages live in `contracts/internal/`
(`control/`, `events/`, `wrappers/`, `state/`) and the envelope family in
`contracts/ingestion/v1/`. Two catalogues (`contracts/internal/catalogue.json`,
`contracts/ingestion/v1/catalogue.json`) list every contract with its schema,
producer, consumer, deduplication key, fences, reading mode, live-check location
and the test files on each side. The contract id is the wire `type` for control
messages and runtime events, `internal.<name>.v<major>` for wrappers and the
snapshot (the endpoint implies the version; nothing is added to the wire), and
the `schema_version` value for the envelope family. Existing schemas stay where
they are and are referenced with `$ref`.

**Reading modes.** Schemas stay closed, and producers are tested against them as
written, so a producer never sends an undeclared field.
- Internal messages are read *tolerantly*: consumers ignore unknown fields, and
  validators drop `additionalProperties` and `unevaluatedProperties` errors. To
  keep that filtering from changing which `oneOf` branch matches, branches are
  told apart by a required `const` property (or by disjoint JSON types, such as
  an object or `null`), never by `additionalProperties`.
- The envelope family is read *strictly*: readers reject any field their
  supported version does not define.

**Compatibility.** Within a major version only additive changes are allowed: new
optional properties, new enum values for internal messages, relaxed limits.
Removing or renaming a property, adding a required property, removing an enum
value, changing a type or `const`, or tightening a limit needs a new id. A new
major of an internal type is consumed alongside the old one for at least one
release and never less than the seven-day JetStream retention. For the envelope
family, readers ship support for a version before any producer emits it. A
contract change updates its examples and both sides' tests in the same pull
request.

**Live checks log and count; they never refuse.** Each side checks the internal
messages it receives (the runtime: control messages, control-plane responses and
the snapshot in the background; the control plane: runtime events and runtime
requests) in tolerant mode. A violation writes one structured warning with the
side, contract id, message identity and up to ten `{keyword, instance_location}`
pairs, never values or secrets, and increments a count per contract that
operators read from the runtime's `/internal/status`, the ops metrics endpoint
and an artisan command. The message is then processed exactly as before. A
failure inside a check is logged and counted, never propagated. `IOT_CONTRACT_CHECKS=off`
turns the checks off, and missing or invalid contract files disable them without
blocking startup. Refusing non-conforming content is left to later specs.

**Validators.** Python `jsonschema` 4.26.0 stays the cross-language reference in
CI. The runtime uses `github.com/santhosh-tekuri/jsonschema/v6` (v6.0.x, at least
v6.0.1) and the control plane `opis/json-schema` (^2.4), both pinned exactly and
both runtime dependencies because the live checks use them. Schemas are compiled
once per process.

**Enforcement.** The checker walks every schema under a `v<N>/` directory or
`contracts/internal/`, validates fixtures and cases, and enforces the catalogue,
`oneOf` and secret-placeholder rules. Each side's tests validate what it produces
against the closed schema and feed every valid example through its real
consumer. Coverage tests compare the catalogue with the message types in code,
and a compatibility check compares changed schemas with `main`. CI runs all of
them on every pull request.

## Consequences

- Additive changes to internal messages no longer need lockstep releases, and
  messages queued across an upgrade stay readable.
- A typo in a field name is invisible to a tolerant consumer; the closed producer
  tests are what catch it.
- Strict envelope readers force readers-first rollouts for every new optional
  field, which is acceptable because no component uses the envelope yet.
- The snapshot contract describes decrypted broker passwords. Its fields are
  marked `"$comment": "secret"`, and the checker requires `placeholder-` values in
  every example.
- Two library dependencies are added, one per side. The runtime image gains a
  copy of `contracts/`; the API image already has one.
- Runtime violation counts are in memory and reset on restart; Prometheus
  counters tolerate resets. Control-plane counts live in a `contract_violations`
  table bounded by the catalogue size.
- Spec 002 lands this incrementally ([plan](../../specs/002-canonical-ingestion/plan.md#implementation-phases-pull-request-sized)):
  the rules, catalogues and checker first, then the validators, the corrected and
  new contracts, coverage and compatibility checks, and finally the live checks.
