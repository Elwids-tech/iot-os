# Feature Specification: HTTP Adapter Sources

**Feature Branch**: `spec/020-http-adapter-sources`

**Created**: 2026-10-27

**Status**: Draft

**Input**: Owner request: add two device adapter source types beside the tenant MQTT
broker and the vendor MQTT broker. An **HTTP webhook** source gives each adapter an
HTTPS ingest URL and a per-adapter secret, so a vendor cloud can post its JSON. An
**HTTP polling** source calls a vendor REST API on a schedule and resumes from a
cursor. Both feed the existing sandboxed decoder and managed Sparkplug B publisher.
Cover how a webhook reaches the tenant runtime, body-size and rate limits, replay and
deduplication, secret rotation and revocation, diagnostics for rejected requests,
encrypted credentials, a persisted cursor, minimum interval, backoff, egress
restrictions, splitting one response into many decoder inputs, and source timestamps
for GPS fixes.

## Context

Adapters connect devices that speak their manufacturer's JSON instead of Sparkplug B
([adapters](../../docs/features/adapters.md),
[ADR-010](../../docs/adr/ADR-010-per-tenant-adapter-runtimes.md)). Each organization
gets its own ingress broker and Node-RED runtime. An adapter's source is either the
tenant broker, which devices publish to with a connection kit, or a vendor broker the
runtime subscribes to. The decoder runs in QuickJS, and the managed publisher turns its
output into Sparkplug B for the normal device path. Laravel owns adapters, revisions,
fixtures, credentials and discovery.

Some device families never publish MQTT to anything the customer controls. Their
vendor's cloud either pushes JSON to a webhook or keeps the data behind a REST API.
Two public examples: cellular asset trackers whose readings (GPS position,
temperature, humidity, barometric pressure, light) are available only from the vendor's
history API (BeWhere: `GET /accounts/{accountKey}/streams/history?start=&end=&limit=1000`
with an API key, resuming from the previous response's `maxDate`), and sensors whose
cloud forwards each message to an HTTP webhook (mcThings). Today a customer has to run
their own bridge that receives the webhook or polls the API and republishes to the
tenant broker. This feature lets the platform do both.

ADR-004 already planned API polling inside the adapter runtime, and the archived
ingestion plan listed HTTP ingress and external API polling as adapter sources
([data ingestion](../../docs/archive/2026-10/plan/architecture/data-ingestion-and-adapters.md)).
The runtime already reaches the internet for vendor brokers through a public-address
guard (`services/adapters/lib/broker.cjs`).

Reading the code turned up three facts that shape the requirements:

1. **Nothing can receive a webhook today.** The tenant runtime has no inbound port by
   design (ADR-010). The constitution rules out the two obvious receivers: Laravel
   MUST NOT ingest telemetry, and the Go runtime MUST NOT serve external applications
   (principle I). The webhook needs a receiver of its own (FR-011).
2. **Adapter readings always claim a source timestamp.** When the decoder returns no
   `observedAt`, the managed publisher stamps each metric with the receipt time
   (`services/adapters/nodes/adapter.js:268-273`). The runtime labels every
   timestamped metric `timestamp_source: source`
   (`services/runtime/internal/devices/profile.go:152-155`). Location fixes accept only
   source-timed readings (`services/runtime/internal/location/location.go:159`), so
   today an adapter without `observedAt` produces trusted fixes stamped with the
   arrival time. Polled history arrives minutes to hours late, and a GPS fix stamped
   with the poll time would be both wrong and trusted (principle VI).
3. **The adapter path can drop messages.** The decoder node drops input while 32
   messages are queued (`nodes/adapter.js:131-139`), and `messageId` deduplication is
   an in-memory map of 10,000 keys that a restart clears (`nodes/adapter.js:284-290`).
   A vendor cloud treats a 2xx answer as delivered, and a poller re-reads overlapping
   windows, so both new sources need a durable hand-off and deduplication that
   survives restarts. Runtime-side duplicates are the subject of spec 012, lossless
   ingestion (a draft on `spec/012-lossless-ingestion`); this spec covers the adapter
   side.

The feature changes no existing permission or role. It adds two source types, their
routes and settings, and additive decoder-contract fields. Existing MQTT adapters keep
their behaviour, except for the timestamp label (FR-050) and the shared no-drop and
deduplication fixes (FR-062, FR-063).

**Terms**: a *source type* is how an adapter receives vendor data: tenant MQTT broker,
vendor MQTT broker, HTTP webhook or HTTP polling. A *delivery* is one HTTP request a
vendor cloud sends to an *ingest URL*. A *webhook secret* is what proves a delivery
comes from the customer's vendor account. A *poll run* is one scheduled execution of
an HTTP polling source; it fetches one or more *pages*. A *record* is one item split
from a page; each record is one decoder input. The *cursor* is where the next run
resumes. A *result* is one object a decoder returns: a `sourceDeviceId` with its
metrics. *Source-timed* readings carry the time the device or vendor reported;
*receipt-timed* readings carry the time the platform received them. The *webhook
receiver* is the platform-owned service at the public edge that receives deliveries.

## Clarifications

### Session 2026-10-27

- Q: How should a webhook delivery reach the tenant's adapter runtime, which has no
  public port today? → A: A new platform-owned webhook receiver at the edge (no Docker
  access, no database credentials) checks the secret and the limits, then publishes
  the delivery to the tenant's own ingress broker under a per-adapter publish-only
  identity. The adapter's flow subscribes to it like the tenant broker source. A new
  ADR amends ADR-010.
- Q: Which ways of proving a delivery is genuine should the first release support?
  → A: All three: a secret token in a configurable header, an HMAC-SHA256 signature
  of the body (optionally with a signed timestamp), and a token in the URL path for
  vendor clouds that cannot set headers, redacted from logs and labelled the weakest
  mode.
- Q: How should an integrator describe the vendor API request and where to resume
  from? → A: A settings form only: an HTTPS URL, parameters and headers with cursor
  and window placeholders, JSON Pointers to the records and the next cursor, and the
  cursor kind (timestamp, next-page token or time window). No sandboxed request code
  in this feature.
- Q: Should readings without a decoder-supplied `observedAt` be labelled
  receipt-timed for every adapter source, or only for the new HTTP sources? → A:
  Every adapter source, MQTT included. Only the label changes; deployed adapters with
  location bindings and no `observedAt` are listed before release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive a vendor cloud webhook (Priority: P1)

An integrator onboards a sensor family whose vendor cloud forwards messages by
webhook. They create an adapter, choose **HTTP webhook** as the source and save. The
adapter shows its ingest URL and a secret, shown once. They paste both into the vendor
cloud's webhook settings. Real deliveries appear under **Recent deliveries**; they save
one as a fixture, write the decoder against it, test and deploy. The sensors appear as
discovered sources and are activated as today.

**Why this priority**: it is half of the request and the shorter path to value: no
schedule, no cursor, and the vendor does the sending.

**Independent Test**: in the local stack, the webhook simulator posts signed JSON to a
saved adapter's ingest URL. The delivery shows under Recent deliveries; after saving it
as a fixture, testing and deploying, a discovered source can be activated and its
readings appear on the device page.

**Acceptance Scenarios**:

1. **Given** a person with `Device.manage` and `Device.manage-connections`, **When**
   they choose HTTP webhook and save, **Then** the adapter shows its ingest URL, the
   authentication mode and a newly generated secret that is shown once with a copy
   button.
2. **Given** a saved adapter with no deployed revision, **When** the vendor cloud
   posts an authenticated delivery, **Then** it is answered `202`, it appears under
   Recent deliveries (time, path, content type, size, body excerpt) and can be saved
   as a fixture, and nothing is decoded or stored as telemetry.
3. **Given** a deployed revision, **When** an authenticated delivery arrives, **Then**
   it is decoded with the input in FR-019 and published, and the answer is `202` once
   the delivery has been handed off durably (FR-017).
4. **Given** a delivery without the secret, with a wrong signature or with a stale
   signature timestamp, **Then** it is answered `401`, its body is not kept, and the
   rejection is counted in the adapter's diagnostics.
5. **Given** a body over 1 MiB, **Then** `413`; a rate limit exceeded, **Then** `429`
   with `Retry-After`; a paused adapter or an unavailable tenant broker, **Then**
   `503` with `Retry-After`.
6. **Given** the vendor cloud retries a delivery and the decoder returns the same
   `messageId` for it, **Then** its readings are stored once.

---

### User Story 2 - Rotate or revoke a webhook secret (Priority: P1)

The integrator suspects the secret leaked, or the vendor cloud's settings are being
handed to someone else. They rotate it, update the vendor cloud, and revoke the old
secret once deliveries arrive with the new one.

**Why this priority**: an ingest URL without a way to replace its secret cannot be
used in production.

**Independent Test**: rotate a secret while the simulator keeps posting with the old
one; both are accepted. Revoke the old one; within 10 seconds deliveries using it are
answered `401` and deliveries with the new one are still accepted.

**Acceptance Scenarios**:

1. **Given** an adapter with one active secret, **When** the person rotates it,
   **Then** a new secret is shown once, and both are accepted until the person
   revokes the old one or 7 days pass.
2. **When** a secret is revoked, **Then** deliveries that use it are answered `401`
   within 10 seconds.
3. Rotation and revocation need no new revision or deployment. Each is recorded in the
   device audit log with the actor and the secret's label, never its value.
4. **Given** HMAC authentication and a vendor cloud that issues its own signing
   secret, **Then** the person can paste that secret instead of generating one.
5. Each secret shows when it was created, by whom, and when it was last used.
6. **Given** URL token mode, **When** the person rotates, **Then** they get a new
   ingest URL with the new token to paste into the vendor cloud, and the old URL keeps
   working until it is revoked or 7 days pass.

---

### User Story 3 - Poll a vendor REST API (Priority: P1)

An integrator onboards asset trackers whose data is only available from the vendor's
REST API. They create an adapter, choose **HTTP polling**, and enter the request with
placeholders for the cursor, the API key, the interval (5 minutes by default), where
the records sit in the response and where the next cursor is. **Fetch now** runs one
request and shows the response and the records split from it. They save a few records
as fixtures, write a decoder for one record, test and deploy. The adapter polls every
5 minutes and resumes from the cursor.

**Why this priority**: it is the other half of the request, and the only way to reach
device families whose vendor offers no push.

**Independent Test**: the vendor API simulator serves paged history with a timestamp
cursor. After deployment and activation, every record it served appears exactly once
with its own observation time, including across a runtime restart in the middle of a
run.

**Acceptance Scenarios**:

1. **Given** a polling configuration and saved credentials, **When** the person runs
   Fetch now, **Then** they see the HTTP status, the duration, a response excerpt with
   credentials redacted, the records split from it and the cursor it would advance
   to, and the stored cursor does not move.
2. **Given** a deployed polling adapter, **When** a run receives a page, **Then** each
   record is decoded on its own, and the cursor advances only after every record of
   that page has been published or recorded as a permanent failure.
3. **Given** a page that says more records are available (a full page or a next-page
   token), **Then** the run fetches the next page at once, up to the page limit per
   run.
4. **Given** the runtime restarts, the adapter is redeployed with a new revision, or
   the tenant runtime is recreated, **Then** polling resumes from the last committed
   cursor, and records fetched again because of the overlap are stored once.
5. **Given** the vendor API answers `429` or `5xx` or does not answer in time,
   **Then** the adapter backs off exponentially up to 1 hour, honours `Retry-After`,
   and shows **Retrying** with the next attempt time.
6. **Given** the vendor API answers `401` or `403`, **Then** polling stops with
   **Credentials rejected** until the person saves new credentials and deploys.
7. **Given** an interval under 1 minute, **Then** the save is refused.
8. **Given** a URL whose host is or resolves to a private, loopback, link-local or
   otherwise non-public address, **Then** it is refused at save (for literal
   addresses), at Fetch now, at every run and at every redirect.

---

### User Story 4 - Trustworthy times for late data (Priority: P1)

A fleet manager follows trackers on the map. A position the vendor recorded at 09:12
that the platform polled at 09:20 must show 09:12, and the map must not present an old
fix as the current position.

**Why this priority**: GPS tracking is the reason for the polling source. Without
correct timestamps the positions are wrong while looking trustworthy.

**Independent Test**: the vendor API simulator returns history whose records are 10
to 120 minutes old. Each stored reading shows its record's time, latitude and
longitude from one record form one location fix, and the latest position on the
device page is the newest record's, whatever order the records arrived in.

**Acceptance Scenarios**:

1. **Given** a decoder that returns `observedAt`, **Then** the readings are
   source-timed with that time, and latitude and longitude from one result form one
   location fix.
2. **Given** a decoder that returns no `observedAt`, **Then** the readings are
   receipt-timed, and a location binding reports an untrusted time instead of a
   position.
3. **Given** a result older than the newest observation already published for that
   source device, **Then** it is kept in history and charts, but it does not replace
   the latest value or count as a counter decrease.
4. **Given** a page with records in any order, **Then** they are published oldest
   observation first.
5. **Given** a record observed two hours before it arrived, **Then** its age is shown
   from its observation time, and it does not make the device look fresh.

---

### User Story 5 - Find out why data is not arriving (Priority: P2)

Deliveries stop showing up, or a tracker's readings are missing. The integrator opens
the adapter and sees which deliveries were rejected and why, or what the last poll
runs did, without asking an operator to read container logs.

**Why this priority**: vendor clouds fail silently from the customer's side. Without
these diagnostics every problem becomes a support ticket, but the source types work
without them.

**Independent Test**: send the simulator's unauthenticated, oversized, rate-limited
and undecodable deliveries, and run polls against a simulator that returns `500` and
then `401`. Each case shows on the adapter with its reason within one minute.

**Acceptance Scenarios**:

1. **Given** a webhook adapter, **Then** its page shows counts per outcome for the
   last 24 hours and 7 days: accepted, unauthenticated, stale or replayed signature,
   too large, rate limited, paused, broker unavailable, decode failed, profile
   validation failed and duplicate.
2. **Then** it lists the last 20 rejected deliveries with time, reason, source address,
   path and size. Bodies of unauthenticated deliveries are never kept. For
   authenticated deliveries that failed decoding, the decoder's error and a body
   excerpt are kept, and the person can save the body as a fixture.
3. **Given** a polling adapter, **Then** its page lists the last 20 runs with start
   time, duration, HTTP status, pages, records, published and failed counts, the
   cursor before and after, and the error.
4. The adapter list and the device's ingestion diagnostics (portal and the
   `get_ingestion_diagnostics` agent tool) show the source's state: for example
   **Receiving**, **No deliveries yet** or **Rejecting** for a webhook, and
   **Polling**, **Retrying** or **Stopped: credentials rejected** for polling.

---

### Edge Cases

- **One delivery carries several messages.** A vendor posts a JSON array of messages
  from several devices. The decoder returns a list of results (FR-060).
- **Body that is not JSON.** Form-encoded, text or binary bodies give `payload: null`;
  the decoder reads `bytes` as for MQTT.
- **Compressed body.** A gzip or deflate body is decompressed, and the decompressed
  size counts toward 1 MiB, so a small compressed bomb is answered `413`.
- **Endpoint verification handshakes.** Some vendor clouds first call the URL with a
  challenge. They are out of scope; the docs say so and FR-015 answers such calls with
  `405`.
- **Signature clock skew.** A signature timestamp more than 5 minutes from the
  platform's clock is rejected as stale.
- **Source type changed.** When a revision that switches an adapter away from HTTP
  webhook is deployed, its ingest URL answers `404` and its secrets are revoked.
- **Response too large.** A page over 8 MiB fails the run with **Response too
  large**, suggests a smaller page size, and leaves the cursor where it was.
- **One record too large or undecodable.** That record is recorded as a permanent
  failure with its error; the rest of the page continues and the cursor advances, so
  one bad record never stalls the adapter (principle VII).
- **Empty page.** A page with no records and no cursor value keeps the cursor and
  counts as a successful run.
- **Cursor stuck.** A full page whose cursor did not advance stops the run's paging
  with **Cursor did not advance**, so an API that ignores the cursor is not fetched in
  a loop.
- **Long outage.** After hours of vendor or runtime downtime the backlog is caught up
  page by page. A run that reaches the page limit is followed by the next run after a
  short pause instead of a full interval, until a page comes back short.
- **Records older than retention.** A result observed before the organization's
  telemetry retention would keep it is refused with a diagnostic.
- **Two adapters, one vendor account.** Each adapter keeps its own cursor and
  credentials.
- **Credentials expire mid-run.** The run stops at the first `401`, the cursor stays
  at the last committed page, and nothing is skipped.
- **Organization deleted.** Its ingest URLs answer `404`, and its webhook secrets and
  polling credentials are destroyed with its adapters.
- **Adapters switched off.** With `IOT_ADAPTERS_ENABLED=false`, ingest URLs answer
  `404` and no polling runs.

## Requirements *(mandatory)*

### Functional Requirements

**Source types**

- **FR-001**: An adapter's source MUST be one of tenant MQTT broker, vendor MQTT
  broker, HTTP webhook or HTTP polling. The source settings are part of the immutable
  revision, as today; secret values are never shown again after they are saved.
- **FR-002**: Both new source types MUST use the existing decoder, fixtures, test gate
  (only a tested revision deploys), deployment and acknowledgement, pause, rollback,
  discovery, activation and provenance.
- **FR-003**: Polling MUST be offered wherever adapters are enabled. The webhook source
  MUST be offered only when the operator has configured a public ingest address; until
  then the portal explains that the deployment does not accept webhooks.

**HTTP webhook**

- **FR-010**: Each webhook adapter MUST have one HTTPS ingest URL that stays the same
  for the adapter's life, across revisions and secret rotations (in URL token mode
  only the token segment changes, FR-012). It MUST contain an unguessable identifier
  and no organization or adapter name. Paths below the URL are accepted and passed to
  the decoder (FR-019), so one adapter can receive several kinds of message.
- **FR-011**: Deliveries MUST arrive at the webhook receiver, a platform-owned service
  at the public edge that holds no Docker access and no database credentials. It
  checks the secret and the limits, then publishes the delivery to the adapter's own
  tenant ingress broker under a publish-only identity limited to that adapter's
  reserved topic. The adapter's flow subscribes to that topic as the tenant broker
  source does, so the tenant runtime keeps no inbound port. Tenant identity comes
  only from the ingest URL and the verified secret, never from the body (principle
  III), and a delivery can reach only its own tenant's broker. Neither Laravel nor the
  Go runtime receives deliveries (principle I). The receiver keeps the routing and
  secret material it needs locally, so deliveries keep being accepted while the
  control plane is down. The tenant broker's message limit MUST fit a 1 MiB body with
  its request metadata. Because this adds a shared public entry point and a component
  that holds a publish identity on every tenant broker, the plan MUST add a new ADR
  that amends ADR-010.
- **FR-012**: Each webhook adapter MUST use one of three authentication modes,
  chosen in its source settings, and every comparison MUST be constant-time:
  - **Header token**: the secret in a header whose name the person sets
    (`Authorization: Bearer` by default).
  - **HMAC signature**: an HMAC-SHA256 of the raw body in a header the person names,
    hex or base64, with an optional prefix such as `sha256=`. When a timestamp header
    is configured, the signature covers the timestamp and the body, and a timestamp
    more than 5 minutes from the platform's clock is refused. This is the
    recommended mode.
  - **URL token**: the secret as a path segment right after the ingest URL's
    identifier, for vendor clouds that cannot set headers. It is removed before the
    decoder sees the path, redacted from every platform log, and the portal labels it
    the weakest mode.
- **FR-013**: Platform-generated secrets MUST have at least 32 random bytes. A pasted
  vendor-issued signing secret MUST have at least 16 characters. Secrets are stored
  encrypted and MUST NOT appear in logs, diagnostics, revision definitions, API
  responses after creation, or anything the assistant can read.
- **FR-014**: An adapter MUST have at most two active secrets. Rotating creates a new
  one and keeps the previous one valid until it is revoked or 7 days pass. Revocation
  MUST take effect within 10 seconds. Neither needs a new revision. Both are audited.
- **FR-015**: The ingest URL MUST accept `POST` and answer other methods with `405`.
  Bodies MUST be at most 1 MiB after decompression, headers at most 16 KiB. Any
  content type is accepted.
- **FR-016**: Answers MUST be: `202` accepted, with a delivery identifier; `400`
  malformed request; `401` not authenticated, the same answer for a missing secret, a
  wrong signature and a stale timestamp; `404` unknown URL; `405` wrong method; `413`
  too large; `429` rate limited and `503` paused or tenant broker unavailable, both with
  `Retry-After`. Answers MUST NOT reveal the organization, the adapter or why
  authentication failed.
- **FR-017**: A `202` MUST be sent only after the tenant ingress broker has durably
  accepted the delivery, and MUST mean the delivery will be decoded and then
  published or recorded as a failure, even if the tenant runtime restarts or is
  redeployed right after answering. When the tenant cannot take more, the ingest URL
  MUST answer `429` or `503` instead of accepting and dropping.
- **FR-018**: Default rate limits, configurable by the operator: 10 deliveries per
  second per adapter with bursts of 100, 50 per second per organization, and 30
  failed authentications per minute per source address, after which that address is
  answered `429` for 5 minutes. Limited deliveries are counted in diagnostics.
- **FR-019**: A delivery's decoder input MUST keep today's fields (`payload`, `bytes`,
  `payloadBase64`, `receivedAt`, `retained: false`) and add `source: "webhook"`,
  `topic` set to the path below the ingest URL (empty when none), and `http` with the
  method, path, query parameters, content type and request headers. Headers are
  lower-cased and bounded, and exclude the authentication and signature headers,
  `authorization`, `cookie` and proxy headers. Fixtures MAY carry the same `http`
  fields so a test reproduces a real delivery.
- **FR-020**: While an adapter has no deployed revision, authenticated deliveries MUST
  be answered `202` and kept as samples (the last 20, for 7 days, with a body excerpt
  of up to 64 KiB) that the person can save as fixtures. They are not decoded.

**HTTP polling**

- **FR-030**: A polling source MUST define its request with settings only, validated
  at save; sandboxed request functions are out of scope. The settings are:
  - the method (`GET`, or `POST` with a JSON body template) and an HTTPS URL;
  - query parameters, headers and body values that may use the placeholders
    `{cursor}`, `{window_start}`, `{window_end}` and `{now}`, each formatted as ISO
    8601, epoch seconds or epoch milliseconds;
  - a page size, sent as a query parameter the person names;
  - a JSON Pointer to the records array (empty when the response itself is the
    array);
  - the cursor kind: a **timestamp** read from the response by JSON Pointer (such as
    `/maxDate`), a **next-page token** read the same way, or a **time window** that
    resumes from the end of the last committed window;
  - when more pages exist: a full page, or a next-page token present.
- **FR-031**: Polling credentials MUST support an API key in a header or a query
  parameter, a bearer token, and basic authentication. They are stored encrypted with
  the adapter's secrets, as vendor broker passwords are, and are never shown again.
  URLs with embedded credentials MUST be refused, and credentials MUST be redacted
  wherever a request or response is shown.
- **FR-032**: The interval MUST default to 5 minutes, be at least 1 minute and at most
  24 hours. Runs are spread with jitter, and an adapter never runs two polls at once.
  A run fetches at most 20 pages by default; a run that reaches the limit is followed
  by the next run after a short pause instead of a full interval.
- **FR-033**: At the first deployment the person MUST choose where the cursor starts:
  1 hour before deployment by default, at most 30 days back. A person with
  `Device.manage-connections` can reset the cursor to a chosen time; the reset is
  audited, and records fetched again are deduplicated (FR-062).
- **FR-034**: The cursor MUST advance only after every record of a page has been
  published or recorded as a permanent failure. It MUST survive runtime restarts,
  redeployments and re-creation of the tenant runtime. The last committed cursor and
  when it was committed are shown on the adapter.
- **FR-035**: Each record MUST become one decoder input: `payload` is the record,
  `bytes` and `payloadBase64` its JSON, `receivedAt` the time the page arrived,
  `source: "poll"`, and `poll` with the page number, the record's index, the page's
  record count and the cursor the page was fetched with.
- **FR-036**: Limits: a page MUST be at most 8 MiB after decompression and 5,000
  records; a record at most 1 MiB; a request times out after 30 seconds; at most 3
  redirects, each to an HTTPS public address, and credentials are re-sent only to
  the original host. An organization makes at most 60 polling requests a minute by
  default, configurable by the operator.
- **FR-037**: Polling MUST use HTTPS to public addresses only. Every address a host
  resolves to MUST be public, and the connection MUST use an address that was
  checked, so a DNS answer cannot change between the check and the connection. This
  applies at save for literal addresses, at Fetch now, at every run and at every
  redirect. A development-only operator switch MAY allow private addresses, like the
  existing one for vendor brokers.
- **FR-038**: Network errors, timeouts, `408`, `429` and `5xx` MUST back off
  exponentially from the interval to at most 1 hour, honouring `Retry-After` up to
  1 hour. `400`, `401`, `403`, `404`, a body that is not JSON, or a missing records
  location MUST stop polling with a named reason until a new revision is deployed or
  the person resumes it. Nothing is retried forever (principle VII).
- **FR-039**: **Fetch now** MUST run one request with the draft's settings and saved
  credentials without moving the cursor or publishing anything. It shows the HTTP
  status, the duration, response headers and an excerpt of up to 256 KiB with
  credentials redacted, the first 20 records, and the next cursor, and lets the
  person save records as fixtures. It is limited to 6 a minute per adapter.
- **FR-040**: A full page whose cursor did not advance MUST stop the run's paging with
  **Cursor did not advance**.

**Timestamps and ordering (every adapter source)**

- **FR-050**: A reading MUST be source-timed only when its decoder result has
  `observedAt`. Otherwise it is receipt-timed, the receipt being when the platform
  received the delivery, page or MQTT message. This applies to every adapter source
  from the release on, MQTT sources included. Stored values and times do not change,
  only the label. Before release, the plan MUST list deployed adapters whose decoders
  return no `observedAt` while their devices have a location binding, because those
  bindings will report an untrusted time until the decoder returns `observedAt`; the
  release notes and `docs/features/adapters.md` say so.
- **FR-051**: An `observedAt` more than 5 minutes in the future stays refused, as
  today. One older than the organization's telemetry retention MUST be refused with a
  diagnostic.
- **FR-052**: The results of one page or one delivery MUST be published oldest
  observation first.
- **FR-053**: A result older than the newest observation already published for the
  same source device MUST be published as historical: it is kept in history and
  charts, but it does not replace the latest value, does not count as a counter
  decrease and does not make the device look fresh.
- **FR-054**: The metrics of one decoder result MUST share one observation time, so
  latitude, longitude and accuracy from one record form one location fix under the
  existing same-event pairing.

**Decoder contract**

- **FR-060**: `decode` MAY return a list of 1 to 500 results instead of one. Each
  result is validated on its own; an invalid result fails alone, with a diagnostic.
- **FR-061**: Existing decoders, fixtures and MQTT sources MUST keep working
  unchanged, apart from FR-050, FR-062 and FR-063. The new input fields are additive.
- **FR-062**: Results with a `messageId` MUST be deduplicated per adapter and source
  device for at least 7 days or the last 100,000 identifiers per adapter, whichever
  is reached first. Deduplication survives runtime restarts and redeployments of the
  same adapter, and duplicates are counted in diagnostics.
- **FR-063**: An adapter source MUST NOT drop a message because the decoder is busy. The
  source waits, and its upstream (the tenant broker, the vendor broker or the next
  page) holds the backlog.

**Diagnostics and visibility**

- **FR-070**: Webhook adapters MUST show counts per outcome for the last 24 hours and
  7 days and the last 20 rejected deliveries (User Story 5). Source addresses are
  kept for 7 days. Unauthenticated bodies and secrets are never kept.
- **FR-071**: Decode and validation failures of authenticated deliveries and polled
  records MUST keep the error and a body excerpt of up to 16 KiB for 7 days, and the
  person can save the body as a fixture.
- **FR-072**: Polling adapters MUST show the last 20 runs (User Story 5) and the next
  scheduled run.
- **FR-073**: The adapter list and detail MUST show the source's state with the kit's
  status components: for a webhook **Receiving**, **No deliveries yet** or
  **Rejecting** (only rejections in the last hour); for polling **Polling**,
  **Retrying** with the next attempt, or **Stopped** with the reason.
- **FR-074**: The device's ingestion diagnostics, in the portal and the
  `get_ingestion_diagnostics` agent tool, MUST include the source's state.
- **FR-075**: Operators MUST get metrics in the monitoring stack for deliveries per
  outcome, hand-off latency, poll runs per outcome and backoff, without secrets or
  bodies.

**Security, permissions and isolation**

- **FR-080**: Tests MUST prove that one adapter's secret cannot deliver to another
  adapter in the same or another organization, that a delivery never reaches another
  tenant's runtime, and that another organization cannot read or change polling
  credentials, deliveries, runs, cursors or secrets (principle III).
- **FR-081**: Viewing an adapter, its ingest URL, runs and diagnostics MUST need
  `Device.view`; editing its settings `Device.manage`; creating, rotating and revoking
  secrets, entering polling credentials, Fetch now and cursor reset also
  `Device.manage-connections`.
- **FR-082**: Secret creation, rotation and revocation, polling credential changes and
  cursor resets MUST be recorded in the device audit log.
- **FR-083**: The adapter assistant MAY propose decoders and non-secret source
  settings from fixtures and saved deliveries. It MUST NOT see secrets or
  credentials, and MUST NOT rotate, revoke, run Fetch now, reset a cursor or deploy
  (principle V).

**Contracts, docs and test tools**

- **FR-090**: Public API changes MUST update the OpenAPI description and
  `packages/api-client`. New cross-process messages (webhook receiver and runtime
  configuration, runtime reports for deliveries, runs and cursors, the decoder input
  and output) MUST get versioned contracts with golden fixtures (principle IV).
- **FR-091**: `docs/features/adapters.md`, the developer docs (signing deliveries,
  configuring polling) and the operations docs (ingest address, firewall, limits)
  MUST change with the behaviour.
- **FR-092**: The local stack MUST gain a webhook sender simulator (signed, retried,
  oversized and duplicate deliveries) and a vendor REST API simulator (paged history
  with a timestamp cursor, `429`, `500` and `401` injection), listed in the
  simulators guide.

### Key Entities

- **Webhook source settings** (part of a revision): the authentication mode, header
  names, signature encoding and timestamp tolerance.
- **Webhook secret**: belongs to one adapter; label, origin (generated or
  vendor-issued), encrypted value, created at and by, last used at, expires at (after
  a rotation) and revoked at.
- **Ingest URL**: the adapter's stable HTTPS address; derived from an unguessable
  identifier that is not the adapter's public UUID.
- **Delivery record**: time, outcome, source address, path, content type, size,
  delivery identifier, and for authenticated failures the error and a body excerpt.
- **Polling source settings** (part of a revision): the request definition, where the
  credentials go, interval, page size, page limit, records and cursor locations, and
  the cursor kind.
- **Polling credentials**: encrypted, in the adapter's secrets and the revision's
  secret snapshot.
- **Cursor**: per adapter; its value, kind, when it was committed, and which run
  committed it. Runtime state, not part of a revision.
- **Poll run**: start, end, outcome, HTTP status, pages, records, published and
  failed counts, cursor before and after, error, next attempt.
- **Deduplication entry**: adapter, source device, message identifier, first seen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An integrator connects a webhook-capable vendor cloud and sees the first
  reading on an activated device within 15 minutes, without running any software of
  their own.
- **SC-002**: Over a 24-hour simulator run polling every 5 minutes, with a runtime
  restart, a redeployment and a 1-hour vendor outage, every record the vendor API
  served is stored exactly once: no gaps and no duplicates.
- **SC-003**: Every location fix from polled history carries the time the vendor
  recorded; none carries the poll time.
- **SC-004**: A revoked secret is refused within 10 seconds of revocation.
- **SC-005**: In the security tests (literal private addresses, names resolving to
  private addresses, redirects to them and DNS rebinding), no polling request reaches
  a non-public address.
- **SC-006**: While one organization sends ten times its delivery limit, another
  organization's accepted deliveries are still answered within 1 second at the 95th
  percentile.
- **SC-007**: On the pilot reference host, 95% of accepted deliveries are answered
  within 500 ms, and their readings are visible on the device within 10 seconds.
- **SC-008**: Every rejected delivery and failed run is visible on the adapter, with
  its reason, within 1 minute.
- **SC-009**: A page of 1,000 records is decoded and published within one 5-minute
  interval on the pilot reference host.

## Assumptions

- Scale is the pilot's: a single-node Compose deployment, tens of organizations, and
  hundreds of devices per adapter.
- Vendor clouds send webhooks over HTTPS and retry on non-2xx answers; the vendor
  REST APIs answer JSON.
- Not in the first release: OAuth 2.0 for polling (such as client credentials),
  sandboxed request functions for polling, webhook verification handshakes, mutual TLS or source-address allow-lists for
  vendor clouds, sending commands to devices over HTTP (adapter downlink stays on the
  roadmap), and ready-made decoders or settings for particular vendors.
- Changing polling credentials creates a new revision that is tested and deployed, as
  changing a vendor broker password does today. Webhook secrets are managed apart from
  revisions, like hardware credentials.
- Product names (BeWhere, mcThings) are public examples only. No customer, prospect
  or pilot names appear in the spec, fixtures or docs.
- Spec 012's runtime-side deduplication is complementary. This spec does not depend on
  it, and it does not depend on this spec.
- Webhook deliveries enter through the tenant broker and every source shares the
  decoder and the publisher, so the fixes for Context item 3 (no drop while the
  decoder is busy, deduplication that survives restarts) apply to every adapter
  source. For a vendor MQTT broker, "no drop" means the adapter stops reading from
  the broker while the decoder is busy; what the vendor broker keeps meanwhile is up
  to that broker.
