# Signed webhook delivery

Applications can configure one alert-event webhook. A separate
`webhooks-worker` scans the committed journal and persists delivery intent before
sending. Telemetry ingestion and alert evaluation do not make outbound calls or
wait for a receiver. The pull feed remains the ordered recovery interface.

## Configuration and authority

Existing organization managers with `Device.manage` and `Device.view` manage
webhooks under `/api/v1/organizations/{organization}/applications/{application}`.
An application must currently grant both `events:read` and `alerts:read`.

| Method / suffix | Behavior |
| --- | --- |
| GET `/webhook` | Endpoint, enabled state, revision and diagnostic; never the secret |
| PUT `/webhook` | `{revision, url}`; use revision 0 to create |
| POST `/webhook/disable` | `{revision}`; disables and cancels pending deliveries |
| GET `/webhook/deliveries?page=1` | 25 deliveries/page, status and attempt history |
| POST `/webhook/deliveries/{uuid}/retry` | `{retry_revision}`; explicitly retries a failed delivery |

**Every PUT rotates the signing key, cancels pending deliveries and starts at the
current committed journal head.** It does not replay history or resume an old
backlog. Recover skipped events through the pull feed. Stale revisions return
409. The new signing secret is returned once with `Cache-Control: no-store`,
stored encrypted, and excluded from reads and audit details. Provision it in the
receiver's backend secret store, selected by the receiver's configured route.
There is no automatic key overlap or self-service settings UI in this slice.

Webhook authority belongs to the application grant, independently of short-lived
read tokens. Rotating or expiring a read token does not stop its webhook.
Application revocation or grant changes disable the endpoint and cancel pending
work. Each send rechecks current grants, organization existence, device ownership
and endpoint revision. Resaving after a grant change intentionally starts from
now with a new secret. Already admitted network requests cannot be recalled.

## Destination controls

Operators set `IOT_WEBHOOK_ALLOWED_HOSTS` to comma-separated exact, lowercase DNS
hostnames. The default empty list permits no external destinations. Only HTTPS
on port 443 is accepted; credentials, query strings, fragments, IP literals,
control characters and backslashes are rejected. IPv6-only receivers are not yet
supported. Configuration and every send resolve IPv4 addresses and reject the
entire result if any address is private, loopback, link-local, carrier-grade NAT,
multicast, documentation or other blocked/reserved space.

The sender pins a validated address with cURL `CURLOPT_RESOLVE`, retaining TLS
hostname/certificate validation. It disables proxies and redirects, limits
connection time to 3 seconds and transfer time to 5 seconds, and discards response
bodies. DNS resolution follows the host resolver's timeout. These are enforced
application-level egress controls; this change does not install a production
network firewall. Deployment-level egress policy and pilot load limits remain
operator responsibilities.

A separate local verification overlay permits exactly
`http://webhook-sink:8080/events`, only when APP_ENV is local/testing and the explicit
verification flag is enabled. That sink has no host port or platform-storage
mount. Normal local configuration disables the exception. Production rejects it.

## Signature contract and replay handling

The POST body is the immutable `integration-event.v1` envelope from the journal.
Headers:

- `X-Iot-Delivery-Id`: stable delivery UUID, including manual retries.
- `X-Iot-Timestamp`: Unix seconds, regenerated for each attempt.
- `X-Iot-Signature`: `v1=` plus hex HMAC-SHA256.

The signed bytes are `timestamp + "." + deliveryId + "." + rawBody`, with the
literal signing-secret string as the HMAC key. Do not parse or reserialize the
body before verification. SDK 0.3.0 exports `verifyWebhook`, which uses WebCrypto
verification, checks timestamp skew (default/max 300 seconds) and validates the
public event envelope. Clocks must be synchronized. Body size is bounded to 1 MiB.

A valid signature within the timestamp window can still be replayed. Persist
processed event IDs (and delivery receipts) transactionally before returning a
2xx response. Never treat HMAC verification alone as exactly-once processing.
Return 2xx only after durable receipt; it means accepted, not necessarily processed.
Webhooks may duplicate or arrive out of order, especially after manual retry.
Use them as a wake-up signal for the ordered cursor feed when maintaining a
projection; do not blindly apply arrival-ordered snapshots over newer state.

## Retry and delivery states

The database-backed delivery queue records stable ID/body, endpoint revision,
status, attempts, retry deadline, diagnostics and HTTP outcomes. Each endpoint
starts at most one send per second across workers. A failed pending delivery
blocks newer scheduling until it succeeds or becomes terminal; terminal failures
remain visible while later events can proceed.

- 2xx: `delivered` (receiver acceptance).
- Network/timeout uncertainty, 408, 425, 429 or 5xx: up to five recorded attempts,
  using fixed 10/30/120/600-second backoff and a 24-hour deadline.
- Other responses, including redirects: terminal `failed` immediately.
- Changed access/endpoint: `cancelled`; blocked DNS/destination disables the
  endpoint and fails the delivery without connecting.

The worker does not follow redirects or consume receiver Retry-After headers;
429 uses the documented fixed backoff. Manual retry applies only to a failed
record under the current active endpoint revision, preserves its ID/body/history,
and grants five more attempts and a fresh deadline. Repeated/stale retry requests
return 409. Old-revision, cancelled or delivered records cannot be retried.

Application, endpoint and delivery locks serialize concurrent workers. The
bounded network call holds those locks, so revocation can briefly wait for an
admitted send; after revocation commits no subsequent send is admitted. If the
receiver accepts a request and the worker dies before committing the result, the
same delivery is retried. In-flight attempts lost to rollback cannot reliably be
counted; the persisted deadline still bounds recovery. Delivery/attempt retention
is currently indefinite; archive/pruning policy remains pending.

## Runtime and verification

Run `php artisan integrations:webhooks-work --max-time=3600` under a supervisor.
`--once` processes one bounded batch (up to 50 endpoints). Compose adds a separate
worker on the platform network with restart behavior. Replica workers share the
same SQL locks, cursor and delivery records. Failed worker passes leave durable
work available for subsequent polling.

The local fixture uses the `compose.webhook-verification.yml` overlay and
`tooling/verify-webhooks.mjs`. Its receiver intentionally responds 503 first and
204 next. Verification checks real worker retries, identical body/ID, recorded
outcomes, PHP/Node signature interoperability, tamper rejection and disabling.
The verification overlay and sink are removed afterward; fixture credentials and
records are deleted. Unit tests cover private/mixed DNS, DNS changes at send time,
revocation, tenant/manager permissions, deadlines and manual retry fencing.
