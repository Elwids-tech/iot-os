# ADR-032: Applications Can Follow a Plant

**Status:** Proposed
**Date:** 2026-11-07
**Amends:** [ADR-014](ADR-014-control-plane-data-plane-http-integration.md)
**Relates to:** [ADR-016](ADR-016-public-api-contract.md), [ADR-018](ADR-018-agent-access-oauth.md), spec 009 (entity hierarchy, draft), spec 030

## Context

External applications read the platform by request. The integration API
([integrations](../features/integrations.md)) returns one device's latest values per
call, history per device and parameter, and devices as `uuid`, `code`, `name`,
`lifecycle`, `presence` and `last_seen_at`
([`ReadController`](../../apps/api/app/Domain/Integrations/Http/ReadController.php)).
Device parameters, sites, workflows, counter increase and state history are portal-only.
The event feed and webhooks carry alert, geofence and automation events and no
readings. An application is granted 1 to 100 devices of its organization and may make
60 requests a minute.

The only live feed of readings is `iot.committed.telemetry.v1` on JetStream
([events](../reference/events.md#committed-telemetry)). It is internal, it mixes
organizations, and only the Go runtime connects to NATS (ADR-014). The portal has no
push channel either: it polls, with about 116 `refetchInterval` queries.

A digital twin is the first application that has to show a whole plant as it is now
and keep it moving. At the moment its 3D scene loads it needs the current value and
time of every bound parameter; afterwards it needs each new reading within a second or
two; when an operator clicks an asset it needs up to 31 days of history; and to let a
person bind a tag it needs the device's parameters and where the device sits. With the
API as it stands, a snapshot of 100 devices costs 100 requests, more than a minute's
budget, polling live values is out of the question, and a plant of 400 devices cannot
be granted at all.

The constitution rules out the shortcuts. Clients talk only to Laravel and the runtime
must not serve external applications (principle I). Tenant identity comes from the
authenticated token, never a payload (III). Data crossing a process boundary has a
versioned contract (IV).

## Decision

- **A telemetry stream for applications.**
  `GET /api/integration/v1/organizations/{organization}/telemetry/stream` serves
  server-sent events for the application's granted devices. It needs a new ability,
  `telemetry:stream`, which also requires `telemetry:read`. Each event is a
  `telemetry-stream.v1` message: `device_uuid` and the readings the runtime committed
  (`parameter_uuid`, `key`, `data_type`, `unit`, `value`, `quality`, `observed_at`,
  `received_at`), derived from `telemetry.committed.v1` without its internal fields.
  The SSE `id` is the committed sequence; a client that reconnects with
  `Last-Event-ID` resumes from that sequence while JetStream still holds it, and
  receives a `reset` event, carrying the current head, when it does not.
- **Laravel serves the stream; JetStream stays inside Go.** The runtime gains an
  internal endpoint, `GET /internal/telemetry/stream`, that fans the committed feed out
  to one subscriber per request, filtered by organization and device set. Laravel
  authenticates the application, resolves its grant, opens the internal request and
  relays it. No new process and no new network path to the runtime: the application
  still talks only to Laravel, and the runtime still serves only Laravel.
- **Bulk latest.** `POST .../telemetry/latest/query` with up to 100 device UUIDs
  returns the latest values of all of them in one response
  (`telemetry-latest-batch.v1`), under `telemetry:read`. A snapshot is one request.
- **Parameters, sites and entities for applications.** `GET devices/{uuid}` carries
  the device's profile summary and its parameters (`uuid`, `key`, `name`, `unit`,
  `data_type`, `decimals`, `accepts_command`, `reports_state`) under `devices:read`.
  `GET sites` is served under a new ability, `entities:read`, which also covers
  `GET entities` and each data point's path once spec 009 lands. Sites remain the
  compatibility view spec 009 keeps.
- **Grants that follow the plant.** An application's grant is either the explicit
  device list of today, or a scope: one or more sites now, entity branches after spec
  009. A device in a granted scope is granted while it is there, including devices
  added later. Every read, the feed, webhooks and the stream filter by the same
  resolved set, and every request rechecks it as today. Changing the scope bumps
  `grant_revision` with the same consequences as changing the list.
- **Limits.** A stream connection counts as one request when it opens. An application
  may hold two streams at once and an organization ten; a stream that has sent nothing
  for 60 s sends a comment line so proxies keep it open. The per-minute request limit
  is unchanged.

## Consequences

- Each open stream occupies a PHP-FPM worker for its lifetime. Ten streams per
  organization is affordable for the first applications; before the limit rises, the
  relay moves to a dedicated streaming process behind the same authentication (Laravel
  Reverb, or a small Go-backed SSE relay that Laravel authorizes with a signed,
  short-lived ticket). That is a follow-up decision, recorded in the roadmap, not a
  reason to open NATS to tenants.
- The runtime's fan-out is a new internal surface. It serves only Laravel, on the
  internal network, and carries no authorization of its own; `contracts/internal`
  gains its schema and fixtures, and `GET /internal/status` reports open streams.
- Three contracts are added with golden fixtures: `telemetry-stream.v1`,
  `telemetry-latest-batch.v1`, and the device read with parameters. The OpenAPI
  description, `packages/api-client` and the SDK change in the same pull requests
  (constitution IV).
- `@iot-os/integration-sdk` 0.6 adds `telemetryStream()` as an async iterator with
  resume, `latestQuery()`, parameters on `device()`, and `sites()`. Nothing existing
  changes shape.
- Spec 009 becomes a prerequisite for entity-branch grants and paths; sites carry the
  first application. The entity hierarchy's later UNS publication is unaffected.
- Grants by scope change what "granted device" means in the feed and the webhook
  filter; the tests that prove another organization cannot read through a grant
  extend to scopes (constitution III).
- The first consumer is the Twin Studio connector; `apps/vertical-demo` stays
  request-based and needs nothing from this decision.
