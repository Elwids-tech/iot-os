# Integrations

External applications read platform data through scoped machine credentials, a
versioned integration API, a durable event feed and signed webhooks. A server-side
TypeScript SDK wraps them.

Code: Laravel [`Domain/Integrations`](../../apps/api/app/Domain/Integrations); SDK
[`packages/integration-sdk`](../../packages/integration-sdk/README.md); sample host
[`apps/vertical-demo`](../../apps/vertical-demo/README.md); portal
[`src/integrations`](../../apps/portal/src/integrations). Event contracts are in the
[events reference](../reference/events.md#integration-events).

## Applications and grants

An **application** belongs to one organization and has:

- **abilities**, explicitly chosen, no wildcards:

  | Ability | Grants |
  | --- | --- |
  | `devices:read` | Device metadata |
  | `alerts:read` | Alert episodes |
  | `events:read` | The event feed; also needs `alerts:read` or `geofences:read` |
  | `telemetry:read` | Latest values, chart history, raw records, location bindings and fixes |
  | `locations:read` | Location map query (current positions and trails) |
  | `geofences:read` | Geofences and activation status |
  | `geofences:manage`, `geofences:activate` | Create and update geofences; activation needs both |

- **1–100 granted devices** of that organization. Every read rechecks ownership;
  alerts are scoped by their deployment's bound device.

Machine tokens use Sanctum's hashed token storage but a separate middleware
([`AuthenticateApplication`](../../apps/api/app/Domain/Integrations/Http/AuthenticateApplication.php)):
they cannot sign in to the portal or admin, and integration routes ignore user
cookies and user tokens. A request needs the ability on **both** the application
and the token.

- One active token per application, valid 1–90 days, with abilities that are a
  subset of the grants. Issuing a token immediately invalidates the previous one.
  The plaintext is returned once with `Cache-Control: no-store`.
- Changing grants bumps `grant_revision`, invalidates the token and event cursors,
  and disables the webhook. Revocation is permanent. At most 50 applications per
  organization, including revoked ones.
- Applications belong to the organization, not to the manager who created them.
- Limits: 60 requests per minute per application, 240 per minute per source IP;
  429 includes `Retry-After`. Limits use Laravel's shared cache.

### Managing applications

**Connect → Integrations** (needs `Device.view` and `Device.manage`) creates
applications, picks devices and abilities, issues tokens and configures the
webhook. Secrets appear once in a masked panel and live only in component state;
dismissing it or leaving the page clears them. Saving grants explains that it
invalidates the token and disables the webhook. Conflicts keep your edits until
you choose **Reload latest state**.

Management API under `/api/v1/organizations/{organization}/applications`
(session auth, 30 requests per minute):

| Method and path | Purpose |
| --- | --- |
| `GET /`, `POST /` | List (never tokens); create `{name, abilities, device_uuids}` |
| `PUT /{application}` | Replace grants with `{revision, name, abilities, device_uuids}` |
| `POST /{application}/token` | Issue or rotate `{revision, abilities, expires_in_days}` |
| `POST /{application}/revoke` | Revoke permanently `{revision}` |
| `GET/PUT /{application}/webhook`, `POST .../webhook/disable` | Webhook endpoint |
| `GET .../webhook/deliveries`, `POST .../deliveries/{d}/retry` | Delivery history and manual retry |

## Integration API

Base: `/api/integration/v1/organizations/{organization}` with
`Authorization: Bearer <application token>`. Use HTTPS; the SDK allows HTTP only
on loopback. Errors: 401 missing, expired or revoked credentials; 403 missing
ability; 404 foreign organization or ungranted resource; 422 invalid input; 503
runtime unavailable (never an empty result).

| Method and path | Ability | Contract |
| --- | --- | --- |
| `GET devices`, `GET devices/{uuid}` | `devices:read` | `uuid`, `code`, `name`, `lifecycle`, `presence`, `last_seen_at` |
| `GET alerts`, `GET alerts/{uuid}` | `alerts:read` | Episode snapshot; `condition=active\|cleared` filter |
| `GET events/checkpoint`, `GET events?cursor=&limit=` | `events:read` | Ordered event feed (below) |
| `GET devices/{uuid}/telemetry/latest` | `telemetry:read` | `telemetry-latest.v1` |
| `GET devices/{uuid}/telemetry/history` | `telemetry:read` | `telemetry-history.v1` |
| `GET devices/{uuid}/telemetry/records` | `telemetry:read` | `telemetry-records.v1` |
| `GET devices/{uuid}/location-bindings` | `telemetry:read` | Approved immutable bindings `{version_uuid, binding}` |
| `GET devices/{uuid}/locations/{event}?version_uuid=` | `telemetry:read` | `location-fix.v1` |
| `POST location-map/query` | `locations:read` | Positions and trails (1h, 6h, 24h, 7d) for granted devices |
| `GET geofences`, `GET geofences/{uuid}`, `GET geofences/{uuid}/activations/{batch}` | `geofences:read` | Geofences filtered to granted devices; activation status |
| `POST geofences`, `PUT geofences/{uuid}`, `POST .../items/{item}/retry` | `geofences:activate` (+ `geofences:manage`) | Save and activate (202), retry a failed item |

Lists return `{data, meta: {current_page, last_page, total}}`, ordered by creation,
`per_page` 1–100. They are current state, not snapshots.

### Telemetry semantics

- **Latest** returns retained values with their quality and timestamps; receiving
  the response does not make them fresh. An unconfigured device returns an empty
  array, never zeros. Presence is separate from quality.
- **History** is selected and bucketed by **receipt time**, inclusive bounds, at
  most 31 days, `max_points` 10–1000 (more than 2000 resulting points is a 422).
  Series stay separated by configuration, type and unit. Bounds are clipped to
  retention and reported back. Empty means no observations, not zero.
- **Records** are unaggregated good-quality observations (diagnostics excluded),
  newest first by `(received_at, event_uuid)`, `page_size` 1–100, a total `limit`
  of 1–5000 with `limit_reached`, and a signed cursor bound to the query. Not a
  complete export.
- **Location fixes** resolve one stored event through the selected immutable
  binding with the same resolver as geofencing ([automation](automation.md#location-bindings)).
  Consumers cannot submit coordinates or evaluation time; independent latest
  values are never paired into a fix.

### Geofence activation

`POST geofences` and `PUT geofences/{uuid}` return 202 once the geofence is saved,
with an activation batch of one item per device. If the runtime rejects the geofence
itself, the request returns 422 and nothing is saved. After the save, an item the
runtime rejects, or that cannot be requested (its device or assignment is gone, or
the runtime is unreachable), is `failed` with a `diagnostic`; the other items are
still requested. Retry a failed item with `POST .../items/{item}/retry`; a pending
item cannot be retried.

### Event feed

The feed is an ordered, per-organization journal of `integration-event.v1`
envelopes ([types](../reference/events.md#integration-events)). Writers lock the
organization's stream row until commit, so positions appear in commit order with
no gaps visible to readers.

- `GET events/checkpoint` returns a cursor at the current head; `GET events`
  returns `{data, next_cursor, has_more}` with `limit` 1–100.
- Cursors are encrypted and bound to the organization, application and grant
  revision. Token rotation keeps them; a grant change returns 409 (rebuild from a
  fresh checkpoint). A cursor from another application returns 422.
- Pages skip events for ungranted devices; save `next_cursor` even for empty pages.
  The feed filters by device, not by event type.
- To build a projection: take a checkpoint, read all current alert pages, then
  apply events after the checkpoint in order. Apply `data` as an authoritative
  snapshot. Record processed event IDs with your projection; the feed is
  at-least-once.
- Events are retained indefinitely for now; there is no retention floor or 410
  contract yet.

## Webhooks

One HTTPS receiver per application, which must grant `events:read` and
`alerts:read`. A separate `webhooks-worker` (`php artisan
integrations:webhooks-work`) scans the committed journal and persists each delivery
before sending, so ingestion and alert evaluation never wait for a receiver.

- **Every save rotates the signing secret, cancels pending deliveries and starts at
  the current journal head.** History is not replayed; recover gaps through the
  feed.
- **Destinations**: `IOT_WEBHOOK_ALLOWED_HOSTS` lists exact hostnames (empty allows
  none). HTTPS on port 443 only; no credentials, query, fragment or IP literal.
  Every send resolves IPv4 and rejects the whole result if any address is private,
  loopback, link-local or reserved, then pins the validated address. No proxies or
  redirects; 3 s connect and 5 s transfer timeouts. IPv6-only receivers are not
  supported. This is application-level egress control, not a network firewall.
- **Signature**: headers `X-Iot-Delivery-Id`, `X-Iot-Timestamp` (Unix seconds, per
  attempt) and `X-Iot-Signature: v1=<hex HMAC-SHA256>` over
  `timestamp + "." + deliveryId + "." + rawBody` with the secret as key. The SDK's
  `verifyWebhook` checks it with a 300-second skew window. A valid signature can
  be replayed; deduplicate by event ID before returning 2xx.
- **Retries**: 2xx is delivered. Timeouts, network errors, 408, 425, 429 and 5xx
  retry at 10 s, 30 s, 2 min and 10 min, up to five attempts within 24 hours. Other
  responses, including redirects, fail immediately. A failed delivery blocks newer
  ones for that endpoint until it succeeds or fails terminally. At most one send per
  second per endpoint. Managers can retry a failed delivery from the current
  endpoint revision.
- Revoking the application or changing its grants disables the endpoint and
  cancels pending work.

For local checks, `compose.webhook-verification.yml` adds a sink at
`http://webhook-sink:8080/events`, allowed only in local/testing with the
verification flag ([testing](../dev/testing.md#verification-scripts)).

## SDK and sample host

[`@iot-os/integration-sdk`](../../packages/integration-sdk/README.md) (0.5.0, Node
22.12+, not published to a registry) covers devices, alerts, the event feed,
webhook verification, telemetry, records, location bindings and fixes, the location
map and geofences. It validates responses at runtime, rejects redirects, has a
15-second default timeout and never retries automatically. Its event type list
does not yet include `automation.triggered.v1`, so the feed throws a contract error
when one arrives ([roadmap](../roadmap.md#next)).

[`apps/vertical-demo`](../../apps/vertical-demo/README.md) is a server-rendered
sample host that uses only the SDK and `@iot-os/ui`, proving that portable
components and machine credentials work outside the portal. It is a local
single-organization example, not a product.
