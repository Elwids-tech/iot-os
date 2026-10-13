# Contract: Portal API for Agent Access

All routes are under `/api/v1`, use the portal session (`auth:sanctum`, stateful)
and are described in `contracts/openapi/supplements/agents.yaml`. Organization routes
use the organization middleware (membership before permission), and all of them answer
404 while `IOT_AGENTS_ENABLED=false`. User references are integer `user_id`.

## Capabilities (changed)

`OrganizationResource` (in `/me` and `/organizations/{organization}/context`) gains:

```json
{
  "features": {"device_adapters": true, "agent_access": true},
  "agents": {"enabled": false, "manage": true}
}
```

- `features.agent_access` is the deployment switch.
- `agents.enabled` is the organization's switch.
- `agents.manage` is `Organization.update`.

## Consent

Passport keeps the pending authorization in the API session (contracts/oauth.md), so
these routes take no request id.

| Method and path | Who | Body | Response |
| --- | --- | --- | --- |
| `GET agent-authorizations/current` | Signed-in person | — | Shape below; `404` when no authorization is pending |
| `POST agent-authorizations/approve` | Same person | `{auth_token, organization_uuid, access_level: read|draft}` | `{redirect_to}`; `403` when the person is not a member or a switch is off; `409` when `auth_token` does not match (another authorization replaced it) |
| `POST agent-authorizations/deny` | Same person | `{auth_token}` | `{redirect_to}` |

`GET agent-authorizations/current` returns:

```json
{
  "auth_token": "…",
  "client": {"name": "Claude", "self_declared": true, "client_uri": null},
  "redirect_host": "claude.ai",
  "organizations": [
    {"uuid": "…", "name": "…", "available": true, "reason": null}
  ],
  "access_levels": ["read", "draft"]
}
```

- `client.name` is always self-declared while registration is dynamic only
  (research D4). The portal leads with `redirect_host`.
- An organization has `available: false` with a `reason` (`switched_off`) when its
  switch is off. Administrators see a link to switch it on.

## Connections

| Method and path | Who | Response |
| --- | --- | --- |
| `GET me/agent-connections` | Signed-in person | Their connections in every organization (shape below) |
| `DELETE me/agent-connections/{connection}` | Owner | `204`; reason `person` |
| `GET organizations/{organization}/agent-access` | Member | `{enabled, can_manage, connector_url}` |
| `PUT organizations/{organization}/agent-access` | `Organization.update` | `{enabled}`; audited |
| `GET organizations/{organization}/agent-connections` | `Organization.update` | All connections to the organization, with `user {id, name, email}` |
| `DELETE organizations/{organization}/agent-connections/{connection}` | `Organization.update` | `204`; reason `administrator`; audited |
| `GET organizations/{organization}/agent-connections/{connection}/activity` | Owner or `Organization.update` | Page of `{tool, outcome, reason, targets[], duration_ms, created_at}`, 50 per page, newest first |

A connection is returned as:

```json
{
  "uuid": "…",
  "agent": {"name": "Claude", "redirect_host": "claude.ai"},
  "organization": {"uuid": "…", "name": "…"},
  "access_level": "read",
  "created_at": "…",
  "last_used_at": "…",
  "expires_at": "…",
  "state": "active",
  "revoked_reason": null
}
```

`state` is one of `active`, `expired`, `revoked` or `unavailable`. `unavailable`
means the organization's switch is off.

## Reviews

| Method and path | Who | Body | Response |
| --- | --- | --- | --- |
| `GET organizations/{organization}/agent-reviews/{group}` | The group's person | — | The group, its proposals (`kind`, `summary`, `status`, `before`, `payload`, `diagnostics`, `blocking`, `waiting_for`, `content_hash`, `expires_at`, `result`) and the preparing agent's name |
| `POST …/agent-reviews/{group}/proposals/{proposal}/apply` | The group's person, with the kind's permission | `{content_hash}` | `{result}`; `409` stale or hash mismatch; `422` blocking; idempotent |
| `POST …/agent-reviews/{group}/apply` | Same | `{proposals: [{uuid, content_hash}]}` | `{applied[], failed: {uuid, status, message} or null}`, in dependency order, stopping at the first failure |
| `POST …/agent-reviews/{group}/proposals/{proposal}/discard` | Same | — | `204` |
| `POST …/agent-reviews/{group}/discard` | Same | — | `204` |
| `GET …/agent-reviews/{group}/proposals/{proposal}/preview` | Same; `dashboard` kind only | — | A dashboard document the portal renders read-only with live data |
