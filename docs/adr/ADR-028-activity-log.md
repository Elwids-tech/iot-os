# ADR-028: One Activity Log on spatie/laravel-activitylog

**Status:** Proposed
**Date:** 2026-10-31
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-013](ADR-013-integer-user-ids.md),
[ADR-026](ADR-026-billing-accounts.md), [spec 024](../../specs/024-activity-log/spec.md)

## Context

ADR-002 gives Laravel the platform's audit. So far that audit is a table named
`device_audit_events`, written by about 75 calls to `DeviceAudit::record()` across
devices, adapters, automation, alerts, integrations, geospatial, support, assistant
settings, administrators and billing accounts. Each row holds an action code, the
organization, the acting user (`actor_id`), a resource UUID and free-form details.
Despite the name it is the platform's only audit trail. Billing account history
(spec 023), the retention page and organization deletion (spec 006) read it.

Nothing shows it to anyone except billing account history. Platform administrators
cannot see what people changed in the portal or the admin app. The trail also has gaps:
organization members, roles and invitations, organization settings changed by platform
administrators, dashboards and device profiles are not recorded. Most edits record
that something changed but not what.

The owner asked for an audit log of user activity, filterable by user and by
organization, and suggested `spatie/laravel-activitylog`. The project prefers
maintained Laravel packages over in-house code, and already uses
`spatie/laravel-permission`. Version 5.1 supports Laravel 13 and PHP 8.4.

## Decision

**The activity log is the platform's one audit trail, stored with
`spatie/laravel-activitylog`.** Its `activity_log` table replaces
`device_audit_events`. A migration copies every existing event across, in order, and
drops the old table. The package's schema is kept, with three columns added through
its documented custom activity model: `organization_id`, `subject_uuid` and
`subject_name`.

**Every event is an explicit domain action.** One recorder writes them: the action code
(for example `device.updated`) is the activity's `event`, the acting person is its
`causer` (a `User` by integer id, ADR-013), and the organization the change belongs to
is `organization_id`. The subject is referenced by UUID, and by its model when the
caller has it. Details go in `properties`. `DeviceAudit::record()` keeps its signature
and writes through the recorder, so existing callers and their action codes do not
change. We do not use the package's automatic model events (`LogsActivity`): the
runtime and workers write the same models without a person, many actions (activate,
deploy, invite, rotate) are not attribute changes, and role changes go through
permission pivots that fire no model events.

**Edits record what changed.** An edit stores the before and after values of the
fields a person changed, in the package's `attribute_changes` column. Secrets, tokens,
keys and passwords are never recorded; large definitions (dashboard layouts, workflow
graphs, profile drafts) are recorded as changed, not diffed.

**An event belongs to the organization whose data it changes,** including changes a
platform administrator makes to that organization. Platform-level changes (billing
accounts, platform roles, super administrators) belong to none.

**Platform administrators who manage organizations read it** in the admin app, as a
timeline filtered by person and by organization. Events with no person (runtime
acknowledgements, alert transitions, deployment results) stay recorded and are left
out of that view.

## Consequences

- One table and one recorder answer "who changed what, where and when" for the whole
  platform, in a schema most Laravel developers know.
- Billing account history, the retention page, organization deletion and two
  verification scripts read `activity_log` instead of `device_audit_events`. Deleting
  an organization still deletes its events (spec 006).
- The causer has no foreign key, so an event keeps its author's id after the user is
  deleted; the old table set it to null. The timeline shows such an author as a
  deleted user.
- New features record their changes through the recorder; a change with no event is a
  gap in the audit.
- Nothing is pruned, as before. The package's `activitylog:clean` command exists, but a
  retention period for the audit is a separate decision.
- Sign-ins, failed sign-ins and reads are not recorded. Organization admins have no
  activity view in the portal yet.
