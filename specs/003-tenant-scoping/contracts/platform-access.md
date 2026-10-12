# Contract: Explicit platform grant and its record

Spec User Story 6, FR-026 to FR-028 and clarification Q2. Design:
[research.md](../research.md) D7. Data: [data-model.md](../data-model.md) sections 6
and 7.

## The grant

| Item | Value |
| --- | --- |
| Permission | `PlatformAdministration.act-in-organizations` (guard `web`), a case of `PlatformAdministrationPermission` |
| Held through | Platform role `super-administrator` (system, not editable in admin), which holds every `PlatformAdministrationPermission` case |
| Not held by | `platform-administrator`: its bundle excludes the grant explicitly |
| Assigned to | Every user with `is_super_admin = true` (data migration), plus the users created by `deployment:administrator` and `BootstrapStaging` |

## Evaluation

The snapshot (`PermissionSnapshot`) decides. Nothing else short-circuits.

| Principal | Member of the organization? | Holds the grant? | Result |
| --- | --- | --- | --- |
| Person | yes | no | Their roles, as today |
| Person | yes | yes | Their roles; a permission their roles lack is allowed and marked as relying on the grant |
| Person | no | yes | Admitted by `EnterOrganization`; every tenant permission, including permissions outside the organization's ceiling, as today; each use is marked |
| Person | no | no | Not found (FR-003) |
| Application | — | — | Never: the grant applies only to people |

Platform permissions (`can:PlatformAdministration.*` routes) are evaluated by
`PlatformAuthorization` from platform roles only. Its `is_super_admin` short-circuit is
removed, and super administrators hold every platform permission through the
`super-administrator` role.

**Removed**:

- `Gate::before` in `AppServiceProvider`.
- The `is_super_admin ||` checks in `ResolveOrganizationContext` (the middleware itself
  is replaced), `DeviceAuthorization`, `DeviceProfileAuthorization`,
  `DagAuthorization`, `DashboardAccess`, `HelpAccess`, `AssistantAccess` and
  `PlatformAuthorization`.

**Kept**: `is_super_admin` as the platform-team identity. It decides who may manage
the platform team (`PlatformTeamController`), who receives operator notifications
(`DeliverNotificationEmail`), and the organization list in `/me`, which for a grant
holder is every organization.

## The record

When a request, job or tool call ends and its snapshot's `grantUsed` set is not empty,
one row is written to `platform_access_events`:

```json
{
  "uuid": "6f0c…",
  "user_id": 1,
  "organization_id": 42,
  "context": "request",
  "operation": "POST /v1/organizations/{organization}/devices/{device}/commands/send",
  "permissions": ["Device.command"],
  "write": true,
  "request_id": "0b9e…",
  "occurred_at": "2026-10-12T09:30:00Z"
}
```

- One row per request, job or tool call, at most (FR-028: "Reads are recorded at most
  once per request"). Writes are covered because the row lists every permission the
  request used through the grant, and `write` says whether it changed data.
- Requests write the row in the middleware's terminate step, and jobs and tool calls
  in `finally`. A request that fails after an authorization decision still writes it.
- `user_id` is the integer user id (ADR-013).
- Retention: pruned daily after `authorization.platform_access_retention_days` (default
  365, owner decision). This spec adds no API or screen; platform operators query the
  table directly.

## Tests

- A walker variant with a grant-holding non-member: every portal operation behaves as
  for an Organization Admin, and each request writes one row.
- A member with the grant whose roles lack a permission: the action succeeds, and the
  row lists exactly that permission. A permission the roles hold writes no row.
- Removing the role from a user removes their access to organizations they do not
  belong to (US6 scenario 4).
- The data migration is idempotent and attaches every super administrator.
- No `is_super_admin` check remains in `app/Domain/**/Services`, `app/Providers` or
  `app/Domain/Authorization/Http/Middleware`, enforced by an architecture test.
