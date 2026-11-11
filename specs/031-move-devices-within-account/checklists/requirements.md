# Specification Quality Checklist: Move Devices Within a Billing Account

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-10
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

- Permission names (`Device.move`, `Device.activate`, `Dashboard.create`,
  `Device.manage-connections`) and "waiting for the runtime" follow the wording of
  earlier specs (016, 029); they name product permissions and states, not technology.
- FR-012 (device limit) and FR-061 (leaving the account) are covered by the Edge Cases
  rather than a user story; both are testable as written.
- Clarified 2026-11-10 (five questions, see the spec's Clarifications). Still defaults
  nobody confirmed: successors arrive active only when the mover may activate in the
  target (FR-008); pipe changes that would cut off hosted devices are refused rather
  than warned (FR-023).
- Links checked with `tooling/docs/check_links.py` (0 broken).
