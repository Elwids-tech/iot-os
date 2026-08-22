# Phase 1 Delivery Management

**Status:** Accepted delivery approach
**Last updated:** 2026-08-22

## Recommended Approach

Use **milestone-gated Kanban** managed in GitHub Projects and GitHub Issues. Fixed-length sprints are optional for team cadence, but the release truth is the milestone exit evidence.

This approach fits the project because:

- The first vertical slices cross React, Laravel, Go, brokers, and databases.
- Protocol and runtime work contains discovery that makes early date estimates unreliable.
- A small team benefits from low ceremony and explicit work-in-progress limits.
- AI-assisted development can accelerate tasks, but review, integration, security, and runtime evidence still determine completion.

## Work Hierarchy

| Level | Purpose | Tracking representation |
| --- | --- | --- |
| Phase | Defines the product release boundary | Roadmap document and project view |
| Milestone | Produces a demonstrable, releasable capability gate | GitHub Milestone |
| Epic | Groups a cohesive capability within a milestone | Parent issue labelled `type:epic` |
| User story | Delivers a testable outcome for a named actor | Issue linked to its epic |
| Engineering task | Describes concrete implementation work | Story checklist or child issue |
| Spike | Retires a specific technical uncertainty | Time-boxed issue with a decision artifact |
| Bug | Corrects behavior that fails an accepted contract | Issue linked to affected milestone/story |

Use a child issue instead of a checklist item only when the task can be owned, reviewed, or delivered independently. This avoids turning the backlog into hundreds of disconnected technical tickets.

## Identifiers

Plan identifiers stay stable even if GitHub issue numbers change:

```text
P1-M2             Milestone 2
P1-M2-E1          Epic 1 in Milestone 2
P1-M2-E1-S2       Story 2 in that epic
P1-M2-E1-S2-T3    Task 3 in that story
```

Issue titles should begin with the stable identifier, for example:

```text
[P1-M2-E1-S2] Accept tenant-scoped MQTT JSON telemetry
```

## Project Fields

Track these fields in one GitHub Project:

| Field | Values or purpose |
| --- | --- |
| Status | Backlog, Ready, In progress, In review, Blocked, Done |
| Type | Epic, Story, Task, Spike, Bug, ADR |
| Milestone | P1-M0 through P1-M5 |
| Area | Experience, Control plane, Data plane, Adapter, Platform operations, Contract |
| Priority | Critical, High, Normal, Low |
| Size | 1, 2, 3, 5; split work larger than 5 |
| Risk | Normal, Security-sensitive, Data-loss-sensitive, Device-control-sensitive |
| Owner | One directly responsible person |
| Dependency | Blocking issue or contract identifier |

## Workflow

```text
Backlog → Ready → In progress → In review → Done
                      ↘ Blocked ↗
```

- `Ready` means the story meets the shared Definition of Ready.
- Each developer should normally own one `In progress` story at a time.
- Pull requests link to one primary story and list any tasks they complete.
- A merged pull request does not make a story Done unless its acceptance criteria are verified.
- A blocked story records the dependency, owner, and next review point.
- The project view is reviewed weekly; milestone evidence is reviewed at each gate.

## Story Template

```markdown
## User story
As a <role>, I want <capability>, so that <outcome>.

## Acceptance criteria
- [ ] Observable behavior or contract result
- [ ] Authorization and tenant boundary
- [ ] Failure and recovery behavior

## Engineering tasks
- [ ] T1 — Small, concrete implementation task
- [ ] T2 — Test or verification task
- [ ] T3 — Documentation or operational task

## Dependencies
- Contract, issue, or milestone identifier

## Evidence
- Test, screenshot, trace, fixture, or runbook produced when complete
```

## Planning Rules

1. Prefer end-to-end stories over backend-only or frontend-only stories.
2. Split stories at a contract or observable behavior boundary, not by developer specialty.
3. Use spikes only for a named unknown and require a written decision or measured result.
4. Treat security, migration, observability, and documentation tasks as part of the story—not cleanup work.
5. Do not close epics by percentage. Close them when every required story and epic exit criterion is complete.
6. Do not mark planned code as implemented until repository and runtime evidence exists.

