# Research: HTTP Adapter Sources

Decisions behind [plan.md](plan.md). Each records what was chosen, why, and what else
was considered.

## R1. Where the webhook receiver runs and in what language

- **Decision**: a Node.js service, `services/adapters/receiver.cjs`, in its own
  container built from the adapter Dockerfile (target `webhook-receiver`), non-root,
  no Docker socket, no database, on the internal network behind Caddy
  (`hooks.${DOMAIN}`) in a release and on `127.0.0.1:8095` in development.
- **Rationale**: it shares the adapter package's MQTT client (MQTT 5 user properties
  and acknowledgements), token and HMAC helpers and test runner, and the team already
  ships that package. Principle I rules out Laravel and the Go runtime.
- **Alternatives**: a Go binary (a second edge codebase and a reading of principle I
  that needs its own debate); Node-RED HTTP-in nodes in each tenant runtime (a public
  port per tenant, the runtime facing the internet); Caddy plugins (no access to
  tenant brokers).

## R2. How routing and secrets reach the receiver

- **Decision**: Laravel calls adapter-manager `POST /webhook` whenever routing changes
  (save of a webhook source, deploy, pause, secret creation, rotation, revocation,
  source change, organization deletion). The manager provisions the broker identity
  and atomically rewrites `<state>/webhooks/routes.json`; the receiver mounts that
  directory read-only and reloads when the file's modification time changes, checked
  every second. Header and URL tokens are stored as SHA-256 hashes; HMAC secrets in
  clear (they are needed to verify).
- **Rationale**: the manager already holds the per-tenant broker administration path,
  so it is the only component that can create the publish identity. A file keeps the
  receiver working while Laravel and the manager are down, and a one-second check
  meets revocation within 10 seconds (SC-004).
- **Alternatives**: the receiver asking Laravel (a control-plane dependency on the hot
  path); a private receiver API that Laravel calls (the broker identity still needs
  the manager); Laravel writing the file (no shared volume, and Laravel should not
  hold tenant broker passwords).

## R3. Broker identities and topics

- **Decision**: per webhook adapter, the receiver client `webhook-<adapter uuid>` may
  publish `iot-os/webhook/<adapter uuid>` and subscribe to
  `iot-os/webhook/<adapter uuid>/status`; the runtime client `adapter-<adapter uuid>`
  may subscribe to the first and publish the retained second. `iot-os/` becomes a
  reserved prefix that topic filters for other sources may not use (Laravel and the
  manager both check).
- **Rationale**: one identity per adapter limits a leaked receiver password to one
  adapter's topic; a reserved prefix stops another adapter of the same tenant
  subscribing to it.
- **Alternatives**: one receiver identity per tenant (a bug could cross adapters);
  `$`-prefixed topics (MQTT reserves them for brokers).

## R4. When `202` is safe to send

- **Decision**: QoS 1 publish with MQTT 5; `202` only after a PUBACK with a success
  reason code. Reason code 0x10 (no matching subscribers) or any failure gives `503`.
  The runtime subscribes with a persistent session (`clean: false`, session expiry 7
  days), so the broker queues deliveries while the runtime restarts. The runtime
  publishes a retained `online` status and leaves an `offline` will; while it is
  offline the receiver accepts up to 500 deliveries or 32 MiB per adapter, then
  answers `503` with `Retry-After: 30`. Tenant Mosquitto: `max_queued_messages 2000`,
  `max_queued_bytes 67108864`, `autosave_interval 30`, memory 256 MiB.
- **Rationale**: FR-017 needs the delivery to survive a runtime restart after the
  answer. The bound keeps the broker's queue from ever dropping silently.
- **Alternatives**: a receiver-side spool (a second durable store); answering `202` on
  receipt (loses deliveries the runtime never sees).

## R5. Never dropping while the decoder is busy (FR-063)

- **Decision**: every MQTT source overrides mqtt.js `client.handleMessage(packet,
  callback)`. The client reads the next packet and sends the PUBACK only after the
  callback, and the callback runs when the publisher has settled the message
  (published and acknowledged, recorded as a permanent failure, or a duplicate).
  Settlement uses a module-level registry keyed by message id, so it works across
  Node-RED nodes. While the publisher is offline, the source ends its connection and
  reconnects when the publisher is online; queued messages wait in the broker. The
  32-message drop is removed.
- **Rationale**: backpressure moves to the upstream that can hold it (FR-063), and an
  unacknowledged message is redelivered after a crash.
- **Alternatives**: a bounded in-memory queue (drops or grows); writing a spool file
  (duplicates the broker's job).

## R6. Deduplication that survives restarts (FR-062)

- **Decision**: per adapter, an append-only log `/data/dedup-<adapter>.log` of
  `<epoch ms> <sha256(sourceDeviceId \0 messageId) first 32 hex>` lines, loaded at
  start, entries older than 7 days dropped, at most 100,000 kept, compacted when it
  doubles. A key is written after the platform broker acknowledges the publish, so a
  crash between the two causes at most a duplicate that the runtime's
  `ON CONFLICT DO NOTHING` absorbs, never a loss.
- **Alternatives**: SQLite in the runtime (a native module in Node-RED); keys in
  Laravel (a control-plane round trip per message).

## R7. Receipt-timed labels and historical results (FR-050, FR-053)

- **Decision**: Sparkplug requires a timestamp, so the publisher still stamps the
  receipt time, and adds the String property `timestamp_source = "receipt"` to every
  metric of a result without `observedAt`. The Go runtime reads the property
  (`decodeMetric`) and labels the reading `receipt`; any other value keeps today's
  behaviour. The publisher keeps the newest observation time per source device in
  `/data/observed-<adapter>.json` and sets `is_historical` on metrics of older
  results; the runtime already keeps historical readings out of the latest values,
  presence and counter checks.
- **Alternatives**: the payload timestamp only (the runtime treats it as a source
  time); a new Sparkplug metric per reading (pollutes births).

## R8. Decoding pages

- **Decision**: a page (or a delivery that returns a list) decodes as one batch:
  `decodeBatch` runs records through fresh workers two at a time, validates each
  result alone, sorts results by observation time (receipt-timed last), and sends one
  message to the publisher. Failures are reported with the record's index and a 16
  KiB excerpt.
- **Rationale**: FR-052 orders a page by observation time, which is known only after
  decoding. Two workers keep peak memory near 160 MiB in the 512 MiB runtime; a worker
  takes 20–50 ms, so 1,000 records take well under a minute (SC-009).
- **Alternatives**: one worker per adapter reused across records (shared state between
  tenant inputs); full parallelism (memory).

## R9. The guarded HTTP client for polling (FR-036, FR-037)

- **Decision**: `node:https` with `lookup: secureLookup` (every resolved address must be
  public; the connection uses the address the lookup returned, so a DNS change between
  check and connection cannot redirect it), `servername` for SNI, manual redirects (at
  most 3, each URL re-checked, `Authorization` and credential parameters dropped when
  the host changes), a 30-second overall timeout, gzip/deflate/br decompression with a
  running 8 MiB cap, and a 16 KiB header cap. Literal non-public addresses are refused
  at save. The development switch `IOT_ADAPTER_ALLOW_PRIVATE_BROKERS` also allows
  private addresses and `http:` for polling, so simulators on the host work.
- **Alternatives**: global `fetch` (undici; no per-request lookup without importing
  undici); a forward proxy for egress (a new component).

## R10. Cursor, generations and resumption (FR-033, FR-034)

- **Decision**: the runtime keeps `/data/poll-<adapter>.json`
  `{generation, cursor, kind, committed_at, run_id}`. Each deploy carries
  `cursor: {generation, value}`; a higher generation than the file's replaces the
  file's cursor. The first deploy starts generation 1 at the chosen start (1 hour back
  by default); a reset or a resume redeploys the applied revision with the next
  generation (the resume keeps the last committed cursor). The runtime reports the
  cursor in each run; Laravel shows it and sends it back as the fallback if the file
  is gone.
- **Alternatives**: the cursor in Laravel only (a control-plane round trip per page);
  a new revision per reset (revisions would mix definitions with runtime state).

## R11. Scheduling and budgets (FR-032, FR-036)

- **Decision**: one timer per adapter in the tenant runtime, first run within
  0–10% of the interval after deploy, then every interval ± 10% jitter; a run that
  reaches the page limit is followed after 5 seconds; never two runs at once. An
  organization-wide token bucket of 60 requests a minute lives in the runtime process
  (one runtime per organization). Backoff doubles from the interval up to 1 hour and
  honours `Retry-After` up to 1 hour.

## R12. Diagnostics storage (FR-070–FR-075)

- **Decision**: `device_adapter_deliveries` keeps samples, rejections and failures
  with excerpts for 7 days (the views show the last 20 of each kind);
  `device_adapter_outcome_counts` keeps hourly counts per outcome for 8 days;
  `device_adapter_poll_runs` keeps runs for 7 days. The receiver reports every 10
  seconds; the runtime reports each run, each failure (throttled to one per 2 seconds
  per adapter) and outcome counts every minute. Reports are idempotent (report ids and
  run ids). `adapters:prune` runs daily. Operators get Prometheus metrics from the
  receiver (deliveries per outcome, hand-off latency) and from the API's existing
  operations exporter (runs per outcome, backoff).

## R13. Fixtures from real traffic (FR-101)

- **Decision**: fixtures gain optional `source`, `http`, `poll` and `received_at`, and
  `topic` becomes optional. **Add as fixture** copies a captured input into the
  editor's draft (unsaved, like any edit). The manager's `/test` builds each input with
  `inputFromMessage` from those fields, so a test sees what the runtime would.

## R14. One onboarding assistant (FR-102–FR-108)

- **Decision**: scope `onboarding` replaces `adapter` (a data migration renames
  existing conversations). A conversation may start with no adapter or profile and
  binds to either when the person approves a proposal. The agent carries
  `OnboardingTools` and, for profile drafting, the existing `ProfileAssistantTools`
  and `ApplyProfileSection`, whose access checks accept onboarding conversations with
  the same profile capabilities. Adapter proposals extend `device_adapter_proposals`
  with `kind` (`reuse`, `create`, `change`). Questions reuse `ask_questions` through an
  extracted `AssistantQuestions` service. The portal body is a new
  `OnboardingAssistant` component that reuses `ProposalReview` for profile sections.
- **Rationale**: one conversation from "what is this device" to an activated device,
  without building a second profile editor.
- **Alternatives**: separate adapter and profile assistants with hand-offs (the owner
  chose one assistant); a planner agent that calls the other agents (two model loops
  per reply).

## R15. Fetch now by the assistant

- **Decision**: `fetch_now` calls the same `PollingService::fetch` as the portal, with
  the same per-adapter limit (6 a minute shared), and returns a redacted result: status,
  duration, a 16 KiB excerpt, the first 5 records and the next cursor. The run is
  recorded as an assistant event the portal shows in the conversation.

## R16. Release and configuration

- **Decision**: `IOT_WEBHOOK_PUBLIC_URL` (empty disables the webhook source),
  `IOT_WEBHOOK_RECEIVER_TOKEN` (receiver to Laravel), `IOT_WEBHOOK_TRUSTED_PROXIES`
  (addresses whose `X-Forwarded-For` the receiver believes), and limit overrides.
  The release overlay adds `webhook-receiver` with `WEBHOOK_RECEIVER_IMAGE`, and Caddy
  adds a `hooks.{$DOMAIN}` site that proxies only `/w/*`. The release tooling builds
  and pins the new image like the adapter manager's.
