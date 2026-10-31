# Research: Activity Log

## R1. Extend `device_audit_events` or adopt `spatie/laravel-activitylog`

**Decision**: adopt the package and move the existing trail into it (ADR-028).

**Rationale**: the owner suggested it and the project prefers maintained Laravel
packages (`spatie/laravel-permission` is already used). Version 5.1.3 requires PHP 8.4
and supports Laravel 12 and 13. Moving the existing events keeps one trail instead of
two that would each be half the story.

**Alternatives**: extending `device_audit_events` in place (smallest change, but an
in-house schema named after devices, with no causer relation, no cleaning command and
no ecosystem); keeping both tables (two trails, every user action recorded twice or
split).

## R2. Automatic model events (`LogsActivity`) or explicit actions

**Decision**: explicit actions through one recorder; no `LogsActivity` on models.

**Rationale**: the runtime callbacks and workers update the same models (devices,
adapters, workflows) without a person, which would flood the log with attribute
changes nobody made. Many actions people care about are not attribute changes
(activate, deploy, rotate, invite). Role assignments go through
`spatie/laravel-permission` pivots, which fire no model events. Existing callers
already name their actions, and billing history depends on those names.

**Alternatives**: `LogsActivity` per model with `logOnly()` (two styles side by side,
duplicate events next to the existing explicit ones).

## R3. No implicit causer

**Decision**: the recorder sets the causer only from the actor it is given.

**Rationale**: the package falls back to the authenticated user. Runtime callbacks and
queued jobs record system events deliberately with no actor; a request-scoped fallback
would attribute them to whoever happened to be signed in on a shared request (for
example a runtime callback authenticated by a service token).

## R4. Paging

**Decision**: keyset paging on `id` descending with Laravel's cursor paginator, 50 per
page.

**Rationale**: the log only grows; offsets get slower and shift while new events
arrive. The timeline only needs "older". Ids are assigned in commit order closely
enough, and the copy keeps the old order.

## R5. Subject names

**Decision**: store a name snapshot when the caller passes a model; at read time show
the subject's current name for known kinds (device, site, dashboard, device profile,
workflow, adapter, application, billing account, organization, role), else the
snapshot, else only the kind.

**Rationale**: the 75 existing calls pass only UUIDs; resolving current names per page
(one query per kind) gives them names without touching every call.

## R6. Who can read it

**Decision**: `PlatformAdministration.manage-organizations`.

**Rationale**: those administrators already list every organization and user and
manage members and roles. A separate permission would need seeding and role changes for
no new protection.
