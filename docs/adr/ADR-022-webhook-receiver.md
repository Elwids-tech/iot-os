# ADR-022: A Platform Webhook Receiver Hands Deliveries to Each Tenant's Ingress Broker

**Status:** Accepted
**Date:** 2026-10-27
**Amends:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md)
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-003](ADR-003-go-data-plane.md),
[spec 020](../../specs/020-http-adapter-sources/spec.md)

## Context

Some vendor clouds push each device message to an HTTPS webhook instead of publishing
MQTT. ADR-010 gives every tenant an ingress broker and a Node-RED runtime, and
deliberately gives the runtime no inbound port. Neither obvious receiver is allowed:
Laravel must not ingest telemetry, and the Go runtime must not serve external
applications (constitution, principle I).

A webhook also needs what a broker connection does not: a public HTTPS address per
adapter, a secret the vendor cloud presents with every request, rate limits, and an
answer that tells the vendor whether to retry.

## Decision

A new platform-owned service, **webhook-receiver** (`services/adapters/receiver.cjs`),
terminates webhook deliveries behind the release's reverse proxy:

- It holds no Docker socket and no database credentials. Its routing table (ingest
  identifier → tenant broker address, CA, a publish identity, the topic, the
  authentication settings and the secrets it needs) is a file that adapter-manager
  writes and the receiver reads from a read-only mount. Deliveries keep being
  accepted while Laravel is down.
- It checks the method, sizes, the rate limits and the secret (header token, HMAC
  signature or URL token, compared in constant time), then publishes the delivery
  with MQTT 5 at QoS 1 to the adapter's tenant ingress broker, on the reserved topic
  `iot-os/webhook/<adapter uuid>`, under a Dynamic Security client
  `webhook-<adapter uuid>` that can publish only there. The body is the payload; the
  request metadata travels as MQTT 5 user properties, so a 1 MiB body still fits the
  broker's message limit.
- It answers `202` only after the broker acknowledges the publish. While the adapter's
  runtime subscription is offline it accepts a bounded backlog (the broker queues it
  in the adapter's persistent session) and then answers `503` with `Retry-After`.
- The adapter's flow subscribes to that topic with its own identity, as the tenant
  broker source does, so the tenant runtime still has no inbound port. Tenant
  identity comes only from the ingest URL and the verified secret.
- It reports outcome counts, rejected deliveries and pre-deployment samples to
  Laravel's internal adapter API with its own token, in batches.
- Laravel owns ingest identifiers and secrets, and pushes routing changes through
  adapter-manager's private API, which provisions the broker identity and rewrites
  the routing file. Revocation takes effect within seconds and needs no deployment.

In a release it is published as `hooks.${DOMAIN}` (configurable); development exposes
it on `127.0.0.1:8095`. The webhook source is offered only when
`IOT_WEBHOOK_PUBLIC_URL` is set.

## Consequences

- One shared public entry point now reaches every tenant's broker. A bug in the
  receiver could misroute a delivery, so routing and authentication are covered by
  isolation tests (spec 020, FR-080), and each broker identity can publish to one
  adapter's topic only.
- The receiver's routing file holds broker passwords and HMAC signing secrets in
  clear text (header and URL tokens are stored as hashes). It lives in the adapter
  state directory, mode 0600, and backups treat it like the rest of that directory.
- Mosquitto writes its persistent store periodically, so a broker crash, unlike a
  runtime restart, can lose deliveries accepted since the last save. The tenant
  broker saves every 30 seconds.
- Throughput is bounded per adapter and organization by the receiver's limits, and
  by one decoder pass at a time per adapter in the runtime.
- Webhook verification handshakes, mutual TLS and source-address allow-lists are not
  supported (spec 020, Assumptions).
