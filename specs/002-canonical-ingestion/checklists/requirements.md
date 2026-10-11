# Specification Quality Checklist: Canonical Telemetry and Internal Event Contracts

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-11
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- **Open markers (3)**, left for `/speckit-clarify`:
  - FR-017: whether source lifecycle signals (online/offline, parameter announcement for
    discovery) are companion contracts in this spec or stay protocol-specific.
  - FR-030: tolerant or strict handling of unknown fields within a supported major
    version.
  - FR-031: whether consumers validate message content against the contracts in the
    running system now, or only in automated tests.
- "Testable and unambiguous" passes for every requirement except the three marked
  above, which are tracked by the unchecked item.
- "Written for non-technical stakeholders": the subject is contracts between platform
  components, so the reader is the platform owner. The spec defines its terms in the
  Context section and names no language, framework, schema technology or transport;
  technology options are in [research.md](../research.md).
- Protocol names (Sparkplug, HTTP JSON, OPC UA) appear because they are product
  capabilities the envelope must cover, not implementation choices.

### Validation log

- **Iteration 1** (after the first draft) found and fixed:
  - FR-032 named endpoints, methods, status codes and message subjects; reworded as
    "interfaces between the control plane and the runtime" and "internal message
    streams".
  - FR-025 and FR-026 required consumers to refuse invalid examples, which presumed the
    open FR-031 decision; they now defer refusal semantics to FR-031.
  - FR-007 assumed values are named by the source; vendor decoders already emit profile
    parameter keys, so the requirement now covers both.
  - FR-022 listed two drift cases; research found five, now all listed, and SC-007
    refers to the full list.
  - FR-031 asked whether to refuse unsupported versions live; research showed both sides
    already refuse unknown message types live, so the open question was narrowed to live
    content validation.
  - FR-020 omitted the automation command check, which is part of the same internal
    interface; added, and SC-001 updated.
- **Iteration 2**: all items pass except the open clarification markers.
