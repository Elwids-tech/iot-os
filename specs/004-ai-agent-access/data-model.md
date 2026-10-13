# Data Model: AI Agent Access

The `agent_*` tables are new, Passport's tables are published from the package, and
`organizations` gains two columns. Every user reference is the integer
`user_id` (ADR-013). Timestamps are UTC. Paths are relative to `apps/api/`.

## Overview

```text
oauth_clients (Passport) 1 ──< agent_connections >── 1 users
                                   │        └────── 1 organizations (agent_access_enabled)
                                   ├──< agent_activity
                                   └──< agent_proposal_groups 1 ──< agent_proposals
oauth_auth_codes, oauth_access_tokens, oauth_refresh_tokens (Passport) ── client_id, user_id
```

Passport owns clients, codes and tokens (research D3). This feature adds the
connection that binds a person's client to one organization and access level, plus
activity and proposals.

## 1. `organizations` (two new columns)

| Column | Type | Rule |
| --- | --- | --- |
| `agent_access_enabled` | boolean, default `false` | FR-002: off for every organization, including new ones |
| `agent_access_changed_at` | timestamp, nullable | Set on every change |

Every change is also recorded with `DeviceAudit::record('agents.access_enabled' |
'agents.access_disabled', …)` with the actor (FR-003).

## 2. Passport tables (published migrations)

`oauth_clients` (UUID `id`), `oauth_auth_codes`, `oauth_access_tokens`,
`oauth_refresh_tokens` and `oauth_device_codes` (unused), published from Passport
13.9. Their `user_id` columns are integer foreign keys (ADR-013).

- **Clients**: created by `laravel/mcp`'s registration controller. They are public
  (no secret), use the `authorization_code` and `refresh_token` grants, and hold the
  `mcp:use` scope. `name` is self-declared. `redirect_uris` are checked against
  `mcp.redirect_domains`, with loopback always allowed.
- **Tokens**: access tokens last 1 hour and refresh tokens 90 days. Refresh tokens
  rotate on use. Revocation is the `revoked` flag, which the guard checks on every
  request.
- **Pruning**: `passport:purge` (revoked and expired tokens and codes) runs daily.
  Clients with no connection 24 hours after creation are deleted by `agents:prune`.

## 3. `User` and the `mcp` guard

`App\Domain\Shared\Models\User` implements Passport's `OAuthenticatable` and uses
Passport's `HasApiTokens` in place of Sanctum's. The `mcp` guard (driver `passport`)
uses the `users` provider, so tools receive the domain `User`.

Sanctum still authenticates portal sessions (`auth:sanctum`, stateful) and integration
applications (their own `PersonalAccessToken` relation). `$user->tokens()` now means
the person's Passport tokens. The password reset's existing `tokens()->delete()`
therefore removes agent tokens, and the reset also revokes the person's connections.
No migration changes `users`.

## 4. `agent_connections`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | bigint | |
| `uuid` | uuid, unique | |
| `user_id` | integer, foreign key, cascade | |
| `organization_id` | foreign key, cascade | |
| `oauth_client_id` | uuid, foreign key to `oauth_clients`, restrict | One client per DCR registration |
| `access_level` | enum `read`, `draft` | |
| `last_used_at` | timestamp, nullable | Updated at most once a minute |
| `expires_at` | timestamp | `last_used_at` (or `created_at`) + 90 days; checked at every call (FR-012) |
| `revoked_at` | timestamp, nullable | |
| `revoked_by_user_id` | integer, nullable | |
| `revoked_reason` | enum `person`, `administrator`, `membership_removed`, `password_reset`, `refresh_reuse`, `replaced`, nullable | Shown on **Connected AI apps** |
| `created_at`, `updated_at` | timestamps | |

**Unique**: one active connection per `(user_id, oauth_client_id)` (partial unique
index where `revoked_at is null`). Approving again for the same client replaces the
organization and level, and revokes the client's earlier tokens for the person
(FR-010). Revoking a connection sets `revoked` on the client's access and refresh
tokens for the person.

**States**:

```text
active ──(person, administrator, removal, reset, refresh reuse)──> revoked
active ──(no tool call for 90 days)──> expired   (derived: expires_at < now)
```

A connection is usable only when it is active, not expired, its organization's switch
is on, the deployment switch is on and the person is a member (D7).

## 5. `agent_activity`

One row per tool call (FR-034).

| Column | Type | Rule |
| --- | --- | --- |
| `id` | bigint | |
| `agent_connection_id` | foreign key, cascade | |
| `organization_id` | foreign key | Denormalized for administrator queries |
| `user_id` | integer | |
| `tool` | string(64) | |
| `targets` | jsonb | UUIDs the call addressed (device, site, profile, adapter, dashboard, group), at most 20 |
| `outcome` | enum `answered`, `refused`, `failed` | `refused` covers permission, access level, rate limit and not found |
| `reason` | string(64), nullable | Machine reason, such as `not_found`, `permission`, `rate_limited` |
| `duration_ms` | integer | |
| `created_at` | timestamp, indexed with `organization_id` and `agent_connection_id` | |

Results and arguments are not stored, only target references. Rows are deleted after
`IOT_AGENTS_ACTIVITY_DAYS` (default 90; FR-034 minimum) by `agents:prune`.

## 6. `agent_proposal_groups`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | bigint | |
| `uuid` | uuid, unique | Appears in the review link |
| `agent_connection_id` | foreign key, set null | The connection may be revoked later; the group stays reviewable |
| `organization_id` | foreign key | |
| `user_id` | integer | Only this person can review the group |
| `title` | string(160) | From the agent; untrusted text |
| `status` | enum `open`, `done` | `done` when no proposal is open |
| `created_at`, `updated_at` | timestamps | |

## 7. `agent_proposals`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | bigint | |
| `uuid` | uuid, unique | |
| `agent_proposal_group_id` | foreign key, cascade | |
| `kind` | enum `profile_section`, `decoder_revision`, `device_registration`, `dashboard` | |
| `target_uuid` | uuid, nullable | Profile, adapter, device or dashboard; null when creating |
| `base_revision` | integer, nullable | Profile `draft_revision`, adapter `draft_revision`, dashboard `revision` |
| `summary` | string(240) | From the agent; untrusted text |
| `payload` | jsonb | The validated change, per kind (below) |
| `before` | jsonb, nullable | Snapshot for the comparison view |
| `diagnostics` | jsonb | Validation result; `blocking` true blocks apply |
| `depends_on` | jsonb, nullable | `{proposal_uuid}` or `{live_action: "publish_profile", profile_uuid, revision}` |
| `content_hash` | char(64) | SHA-256 of the canonical JSON of kind, target, base revision and payload |
| `status` | enum `open`, `applied`, `discarded`, `expired`, `superseded` | |
| `applied_by_user_id`, `applied_at` | nullable | |
| `result` | jsonb, nullable | Created or changed record references |
| `expires_at` | timestamp | Created + 7 days |
| `created_at`, `updated_at` | timestamps | |

**Payloads by kind**:

| Kind | Payload | Validated by | Applied by |
| --- | --- | --- | --- |
| `profile_section` | `{section: identity|parameters|groups|calculations, changes[]}` (the in-app assistant's shape) | The FormRequest rules and validators used by `ProfileProposalService::preview` | `ProfileSectionWriter` (extracted) via `DeviceProfileAuthoring::mutate`, or `CreateDeviceProfile` |
| `decoder_revision` | `{adapter_uuid or new {name, artifact_uuid}, code, fixtures[]}` | `AdapterService::fields`; optional decoder test result attached | `AdapterService::save` |
| `device_registration` | `{name, code, site_uuid?, tags[], attributes{}, source: {candidate_uuid} or {gateway_uuid, device_id} or {direct: true}, profile_uuid, profile_revision, mappings[]}` | `RegisterDevice::rules` (extracted) and `DeviceConfigurationService::compile` in a rolled-back transaction | `RegisterDevice` then `DeviceConfigurationService::saveDraft`; the device stays `registered` (not activated) |
| `dashboard` | The full dashboard document (`schema_version` 2) and `name`; for changes, the dashboard uuid and revision | `DashboardDefinition` (array entry point) plus `Device.view` on every referenced device | `SaveDashboard` (extracted) |

**States**:

```text
open ──apply (hash, base, permission, not blocking)──> applied
open ──discard──> discarded
open ──base changed / 7 days──> expired
open ──newer proposal for the same target in the group──> superseded
```

Apply is idempotent: applying an applied proposal returns its `result`.

## 8. Configuration (`config/agents.php`)

| Key | Environment | Default |
| --- | --- | --- |
| `enabled` | `IOT_AGENTS_ENABLED` | `false` |
| `resource` | derived from `APP_URL` + `/mcp` | |
| Passport keys | `PASSPORT_PRIVATE_KEY`, `PASSPORT_PUBLIC_KEY` | Generated per deployment; kept in `.local/` |
| `mcp.redirect_domains` | `IOT_AGENTS_REDIRECT_DOMAINS` (comma-separated) | `*` (any); loopback is always allowed |
| Access and refresh token lifetimes | `Passport::tokensExpireIn`, `refreshTokensExpireIn` | 1 hour, 90 days |
| `connection_idle_days` | | 90 |
| `activity_days` | `IOT_AGENTS_ACTIVITY_DAYS` | 90 |
| `rate_per_minute`, `rate_per_hour` | | 120, 2000 |
| `max_result_characters` | | 60000 |

## 9. Spec requirements to structures

| Requirement | Structure |
| --- | --- |
| FR-001, FR-041 | `agents.enabled`; `features.agent_access` capability |
| FR-002, FR-003 | `organizations.agent_access_enabled`; `device_audit_events` |
| FR-005 to FR-010 | Passport clients and codes, `agent_connections` |
| FR-011 to FR-014 | `agent_connections`, Passport tokens, the `mcp` guard, revocation hooks |
| FR-015 to FR-018 | `AuthenticateAgent`, `AgentTool` |
| FR-019 to FR-027 | Tools and query services ([contracts/mcp-tools.md](contracts/mcp-tools.md)) |
| FR-028 to FR-030 | `agent_proposal_groups`, `agent_proposals` |
| FR-031 to FR-033 | Tool catalogue (no live tools), field lists, `untrusted` notice |
| FR-034 to FR-036 | `agent_activity`, rate limiter, result bound |
