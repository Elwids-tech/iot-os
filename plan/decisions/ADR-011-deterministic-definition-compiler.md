# ADR-011: Deterministic Definition Compiler

**Status:** Accepted
**Date:** 2026-08-28

## Context

The tenant wizard, AI onboarding flow, and future ingestion runtime must agree on JSON extraction, transformations, validation, derived telemetry, event dispatch, and command correlation. PHP CEL implementations are not mature enough to establish a long-lived compatibility boundary with the planned Go runtime.

## Decision

Create one narrow internal definition compiler in the existing Go runtime module. Laravel submits Profile/Binding authoring DTOs and fixtures over an authenticated internal HTTP interface. The future data plane imports the same compiler packages directly.

The compiler uses:

- `github.com/google/cel-go` for restricted CEL;
- `github.com/ohler55/ojg/jp` behind an explicit JSONPath AST allowlist; and
- RFC 8785 JSON canonicalization before SHA-256 hashing.

JSONPath v1 permits root, object access, numeric array indexes, and an optional final `[*]` only on a channel record selector. Capability mappings use definite paths. Filters, recursive descent, scripts, arbitrary wildcards, I/O, reflection, randomness, and dynamic code are rejected.

Incoming preview order is:

```text
record selection
-> envelope extraction
-> definite field extraction
-> wire-type coercion
-> optional Binding CEL
-> semantic validation
-> derived CEL in dependency order
-> canonical preview
```

Command previews validate semantic input, optionally encode values through restricted CEL, place values at definite paths, and verify response identity, correlation, status, and output fields.

## Consequences

- The language model cannot declare an invalid contract valid.
- Compiler, schema, CEL environment, JSONPath subset, and unit-registry versions participate in artifact identity.
- Compilation requests and CEL evaluation have explicit size, cost, depth, record-count, and output limits.
- Laravel treats compiler validation failures as domain feedback and transport failures as bounded infrastructure errors.
