# ADR-013: Users Are Identified by Integer Id in API Contracts

**Status:** Accepted (recorded retroactively)
**Date:** 2026-10-11; recorded as a project lesson on 2026-09-27

## Context

Most platform resources (organizations, devices, profiles, workflows, alerts,
dashboards, applications) are addressed by UUID in URLs and payloads. Users are
not: the `users` table has no `uuid` column
([`0001_01_01_000000_create_users_table.php`](../../apps/api/database/migrations/0001_01_01_000000_create_users_table.php),
[`User`](../../apps/api/app/Domain/Shared/Models/User.php)), and every existing
endpoint already refers to users by their integer id. New contracts were at risk
of inventing a user UUID that does not exist.

## Decision

API contracts identify users by integer id. Name the field `user_id`, or keep the
existing domain name where one exists. Current examples:

- `acknowledged_by` and `assigned_to` on alerts; `PUT alerts/{alert}/assignee`
  takes `{user_id}` ([`AlertController`](../../apps/api/app/Domain/Automation/Http/Controllers/AlertController.php))
- `recipient_ids` in workflow notification settings
- `created_by` on dashboards; user targets in dashboard shares
- `members/{member}` routes, which accept numeric ids only, and admin platform-team
  routes ([`Administration/routes/api.php`](../../apps/api/app/Domain/Administration/routes/api.php))
- `id` in `GET /api/v1/me`

## Consequences

- Clients and the SDK type user references as numbers.
- User ids are sequential and reveal account counts; every endpoint must still
  scope users to an organization the caller can see, and return 404/422 for
  users outside it.
- Adding user UUIDs later would need a migration, dual-field contracts and a
  superseding ADR.
