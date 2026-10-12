# Contract: OpenAPI extension vocabulary

The `x-*` fields the platform's contract uses. Tools ignore unknown extensions, so these
add meaning without breaking OpenAPI 3.1 consumers. The operation transformer writes the
fields marked **generated**; supplements write the fields marked **supplement**. G2, G3
and G5 in [ci-gate.md](ci-gate.md) check them.

## On operations

| Field | Type | Written by | Meaning |
| --- | --- | --- | --- |
| `x-audience` | `"integration"` \| `"account"` \| `"organization"` \| `"platform-admin"` | generated | Who calls it. Required on every operation. `integration` is the published surface; the five unauthenticated operations are `account` with `security: []`. |
| `x-abilities` | `{ all: string[], any_of?: string[][] }` | generated (`all`), supplement (`any_of`, extra `all`) | Integration abilities required on **both** the application and the token. `GET events` is `{all: ["events:read"], any_of: [["alerts:read", "geofences:read"]]}`; geofence writes are `{all: ["geofences:activate", "geofences:manage"]}`. Values come from `IntegrationAbility` (8 values). |
| `x-organization-scoped` | `true` | generated | The caller must belong to the organization in the path: 404 unknown organization, 403 non-member. |
| `x-permissions` | `string[]` | supplement | Tenant permissions the operation checks, for example `["Device.view", "Device.manage"]`. Required on fully described organization operations. |
| `x-platform-permission` | `string` | generated (`can:`), supplement (checks made inside the operation) | For example `PlatformAdministration.manage-organizations`. |
| `x-rate-limits` | `{ limit: integer, per: "minute" \| "hour" \| "day", key: "application" \| "ip" \| "user" \| "email" \| "organization", name?: string }[]` | generated (`ThrottleRequests:N,M`; named limiters, evaluated and named in `name`; the application limit of `AuthenticateApplication`), supplement (corrections) | Every limit that can return 429. Integration operations list `{240, minute, ip}` and `{60, minute, application}`. Named limiters include per-hour (`password-recovery`) and per-day (`organization-invitations`) limits. |
| `x-schema-status` | `"pending"` | generated (from `pending-schemas.json`) | Success bodies are deliberately open; only status codes are checked. Absent means fully described. |
| `x-async` | `{ poll: "METHOD /path", key?: string }` | supplement | A 202 operation and the operation that polls it; `key` names the client-supplied idempotency field (`operation_uuid`, `request_id`). |
| `x-concurrency` | `{ field: "revision" \| "draft_revision" \| "expected_revision" }` | supplement | Optimistic concurrency; a stale value returns 409. |
| `x-first-party-caller` | `false` | supplement | No portal, admin or client-library caller today (six `api/v1` routes). |

## On responses

| Field | Type | Meaning |
| --- | --- | --- |
| `x-runtime-shaped` | `true` | The body (or the referenced part of it) is the device runtime's own output passed through unchanged; fields such as `scope.user_id` and `null` lists are the runtime's. A later spec may stabilise it. |

## On schemas and properties

| Field | Type | Meaning |
| --- | --- | --- |
| `x-user-reference` | `true` | The value is a user id even though its name does not match the lint rule's pattern; must be an integer (ADR-013). |

## Security schemes

Both are defined in `contracts/openapi/supplements/shared.yaml`; the security
transformer references them from each route's middleware.

| Name | OpenAPI type | Description carried in the contract |
| --- | --- | --- |
| `session` | `apiKey` in cookie (session cookie), plus header `X-XSRF-TOKEN` on unsafe methods | First-party browser session. Bootstrap with `GET /sanctum/csrf-cookie`, then `POST /v1/auth/login`. 401 without a session; 419 when the anti-forgery token has expired. Application tokens are rejected. |
| `applicationToken` | `http`, scheme `bearer` | Integration API only. One active token per application, valid 1 to 90 days, abilities a subset of the application's grants; session cookies and user tokens are ignored. 401 missing, invalid, expired or revoked; 403 ability not granted on both application and token; 404 another organization or an ungranted resource. |
