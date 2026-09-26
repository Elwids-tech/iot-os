# Scoped application access and Node SDK

Application access provides independent machine identities and read-only device
metadata and alert state. A follow-up adds the [durable alert event feed](integration-events.md)
and consumer recovery. Telemetry history, commands, workflow mutation and signed
webhooks remain pending; current-state lists alone are not a durable stream.

## Identity and grants

An application belongs to one organization, with 1–100 explicitly selected device
UUIDs and a subset of `devices:read`, `alerts:read`, `events:read`. The event feed requires both `events:read` and `alerts:read`. There are no wildcard grants.
Devices must belong to the organization, and reads recheck device ownership.
Alerts are scoped using their immutable deployment's device binding, not the
workflow's current draft. Responses omit internal configuration, credentials,
comments, people and notification delivery records.

Machine credentials use Sanctum's hashed personal-access-token storage, but a
separate middleware authenticates them. The application model deliberately does
not implement Sanctum's user-token trait: its tokens cannot log in to portal or
administration routes. Integration routes ignore user cookies and user tokens.
Both token abilities and current application grants are required.

An application is organization-owned, not tied to the issuing manager's future
membership. Authorized managers must explicitly revoke the grant when the
integration should lose access. Revocation prevents subsequent requests; already
admitted in-flight reads cannot be recalled.

## Management APIs

Use existing user/session authentication at
`/api/v1/organizations/{organization_uuid}/applications`. All actions require
organization membership and both `Device.manage` and `Device.view` (the existing
super-admin exception applies). Application ownership is checked on every action.

| Method and suffix | Purpose |
| --- | --- |
| GET empty suffix | List application grants and revisions; never tokens |
| POST empty suffix | Create `{name, abilities, device_uuids}`; returns revision 1 |
| PUT `/{application_uuid}` | Replace grants using `{revision, name, abilities, device_uuids}`; invalidates tokens |
| POST `/{application_uuid}/token` | Issue/rotate `{revision, abilities, expires_in_days}`; token abilities must be a subset of grants |
| POST `/{application_uuid}/revoke` | Permanently revoke using `{revision}` |

Token lifetime is 1–90 days. Rotation immediately invalidates the old token;
there is one active credential per application, with no overlap window. Store the
new plaintext token from the response once in your server's secret store. It is
never returned by list APIs or audits. Token responses use `Cache-Control:
no-store`. If a rotation response is lost, read the latest application revision
and rotate again; do not blindly replay management mutations. Revision conflicts
return 409. Revoked applications cannot be reactivated. Creation is bounded to
50 total application records per organization, including revoked audit records.
No self-service cleanup or management UI is provided in this slice.

Grant changes, token rotation and revocation lock the application and write audit
records in the same SQL transaction. Grant changes invalidate all current tokens.
Issuance, rotation and revocation never place plaintext credentials in audits.

## Machine read contract v1

Use `Authorization: Bearer <application-token>` at
`/api/integration/v1/organizations/{organization_uuid}`. Serve this over HTTPS in
production; the SDK permits explicit HTTP only on local loopback.

| Method and suffix | Ability | Result |
| --- | --- | --- |
| GET `/devices` | `devices:read` | Paginated granted device metadata |
| GET `/devices/{uuid}` | `devices:read` | One granted device |
| GET `/alerts` | `alerts:read` | Paginated episodes for granted devices |
| GET `/alerts/{uuid}` | `alerts:read` | One granted episode |

Device fields: `uuid`, `code`, `name`, `lifecycle`, `presence`, `last_seen_at`.
Alert fields: `uuid`, `episode`, `condition` (`active` or `cleared`), `activated_at`,
`cleared_at`, `acknowledged_at`, `workflow_uuid`, `workflow_name`, `device_uuid`,
`execution_stopped_reason`. Timestamps and stop reason may be null. Presence uses the same runtime-freshness guard as the portal: an online record without a runtime heartbeat in the last 20 seconds is unknown. Presence does
not establish GPS freshness; missing GPS is never inferred safe or outside.

Single reads return `{data: resource}`; lists return `{data: resource[], meta:
{current_page, last_page, total}}`. Pagination is ordered by internal creation ID;
`page` is 1–100000, `per_page` is 1–100 (default 25). Alerts accept
`condition=active|cleared`. Pagination is current state, not a stable snapshot;
concurrent condition/grant changes can change membership between pages.

Missing/expired/revoked credentials return 401; missing abilities return 403;
foreign organizations or ungranted resources return 404. Invalid input returns
422. Application reads are limited to 60 requests/minute across token rotations,
with an additional 240 requests/minute source-IP route limit. Management is
limited to 30 requests/minute using the existing authenticated throttle. A 429
includes `Retry-After`. Limits use Laravel's configured shared cache; deployments
must share that cache between API replicas for a shared limit.

## SDK and verification

See [the independent SDK](../packages/integration-sdk/README.md) for package,
error, timeout and example usage. It is locally packaged, not registry-published.
The SDK validates v1 response fields at runtime, bounds page traversal, rejects
redirects and never automatically replays requests. There is no browser/cookie
transport, device-control API or database/broker dependency.

`tooling/verify-integration-sdk.php` creates only temporary local fixtures and a
short-lived management credential in a mode-0600 file. With that file copied to
`/tmp/iot-sdk-fixture.json`, run `tooling/verify-integration-sdk.mjs`; optionally
set `IOT_SDK_MODULE` to an independently installed tarball's module path. It uses
real HTTP management APIs to issue, narrow, rotate and revoke machine credentials
and uses the SDK for device/alert reads, pagination and isolation checks. Signal
completion by touching `/tmp/iot-sdk-release` in the API container. The fixture
cleans its own database records and credentials; remove the host copy as well.

Remaining P3: signed webhook delivery, telemetry read contracts, integration management UI and pilot quotas/load tests. Durable alert polling and projection recovery are now implemented.
The visual workflow builder remains deferred.
