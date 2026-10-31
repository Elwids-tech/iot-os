# ADR-024: Adapter Sources Capture Raw Input Before Any Revision Is Deployed

**Status:** Proposed (accepted when spec 021's plan merges)
**Date:** 2026-10-28
**Amends:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md)
**Relates to:** [ADR-022](ADR-022-webhook-receiver.md), [ADR-023](ADR-023-protocol-connectors.md),
[spec 021](../../specs/021-data-first-onboarding/spec.md)

## Context

Spec 021 lets people see a device's messages before they define readings, write a
decoder or deploy anything. Webhooks already allow this: ADR-022's receiver keeps
samples while no revision is applied. MQTT sources do not.

- A tenant-broker device has no subscriber until the first deploy creates
  `adapter-<uuid>`, so its first messages are dropped.
- A vendor broker is not connected at all before deployment.
- The adapter flow reads only while its publisher is online, and a deployment needs a
  tested revision and a published profile.

So the first MQTT payload a person sees today comes from a decoder they wrote without
seeing one.

ADR-010 says that what runs in a tenant runtime is a deployed, tested revision.

## Decision

A tenant runtime may run a **capture flow** for an adapter that has no deployed
revision.

- **What it is**: a Node-RED tab `capture-<uuid>` with a source node in capture mode
  and a reporter. It has no decoder and no publisher. It reports each message
  (topic, flags, size, the first 64 KiB of the payload) to Laravel as a `capture`
  runtime event. Laravel keeps it with the adapter's other samples: the newest 100,
  for 7 days, visible to people who can view the source.
- **It is not a revision**: it is never tested, versioned or deployed as one. It
  creates no candidates, no Sparkplug births and no telemetry.
- **It runs on a lease**: Laravel starts it with an end time. The portal renews it
  while See data or Choose readings is open, and it ends 30 minutes after the last
  renewal, or on deploy, discard, delete or pause.
- **Identities**:
  - On the tenant broker it subscribes as its own identity, `capture-<uuid>`, with a
    clean session.
  - On a vendor broker it connects with the source's credentials as client
    `capture-<uuid>`, with a clean session.
  - Neither touches the adapter's persistent session.
- **Wider publish rights during Setup**:
  - While an adapter has never been applied, hardware credentials made for it may
    publish to any topic except the platform's `iot-os/` and `$` topics and the
    filters of the tenant's other deployed adapters, and the capture flow may
    subscribe to `#`. The platform can then show what the firmware really sends,
    and recognise a Sparkplug B device by its topics.
  - The other adapters' filters are deny entries with a higher priority than the
    broad allow. A setup device therefore cannot feed another data source, and
    capture drops those topics too.
  - Laravel refreshes both lists whenever an adapter in the organization deploys,
    pauses, is deleted or changes its filters.
  - The first deploy narrows those credentials to the source's filters.
- **Reading the broker log**: adapter-manager follows the tenant broker's connection
  log through the Docker API it already holds. It reports connections and refused
  credentials per username, so a person can be told their device's password was
  refused.
- **Manage drafts**: once a revision is deployed, the deployed source node copies raw
  input to its reporter while a change is drafted, under the same lease. No second
  connection is opened.

## Consequences

- **Exposure**: raw payloads of a device not yet onboarded reach Laravel. They are
  bounded, short-lived and kept per organization, as webhook samples already are.
  Laravel still stores no telemetry from them, so principle I holds as it did for
  ADR-022.
- **Vendor connections**: a vendor broker sees a second client id during a Manage
  change. A vendor that allows only one client id per credential refuses it; See data
  then shows `client_id_refused` and the person can rely on decode previews.
- **Setup publish rights**: within one tenant broker these are wider than before.
  They apply only to credentials of never-applied sources and never include
  `iot-os/` topics or another deployed adapter's filters. They are narrowed at the
  first deploy. Between a deploy elsewhere and the refresh that follows it, a setup
  credential could publish to the new filters for a few seconds; the refresh runs in
  the same request that queues that deploy.
- **Log reading**: adapter-manager does more with its Docker access. It only reads
  logs and gains no new privilege.
- **Recovery**: the history it keeps is lost on restart and is reported as unknown
  until new events arrive (principle VI).

## Alternatives considered

- **Capturing in adapter-manager**: long-lived vendor connections and credentials
  would sit in the process that holds the Docker socket.
- **Deploying a pass-through decoder revision**: needs a profile, publishes births
  and creates candidates, and makes "revision" mean two things.
- **Always copying raw input from deployed flows**: unnecessary volume and personal
  data.
- **A Mosquitto authentication plugin for diagnostics**: compiled code in every
  tenant broker image, for information the log already has.
