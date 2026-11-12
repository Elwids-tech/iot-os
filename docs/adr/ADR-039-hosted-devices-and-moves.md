# ADR-039: Hosted Devices and Moves Within a Billing Account

**Status:** Accepted 2026-11-11, built in [spec 031](../../specs/031-move-devices-within-account/spec.md) (moves of adapter-fed devices in PRs 031-1 and 031-2; gateway, direct-device, history and assistant parts follow in later PRs); amended by [ADR-040](ADR-040-moved-back-devices-read-their-own-readings.md) (a device moved back reads its organization's earlier readings)
**Date:** 2026-11-11
**Amends:** [ADR-026](ADR-026-billing-accounts.md)
**Relates to:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md),
[ADR-014](ADR-014-control-plane-data-plane-http-integration.md),
[ADR-027](ADR-027-adapter-fed-activation-and-applied-generation.md),
[spec 031](../../specs/031-move-devices-within-account/spec.md),
[plan](../../specs/031-move-devices-within-account/plan.md)

## Context

[ADR-026](ADR-026-billing-accounts.md) groups organizations under a billing account
but keeps every organization an independent tenant: a billing account grants no
access, and nothing crosses between its organizations. Integrators connect hardware
in their own organization and later need each customer, an organization on the same
account, to see only its own devices. Today the only way is to archive each device
and onboard it again in the customer's organization. For an adapter that means a
second copy of the source, holding the integrator's vendor credential, polling the
vendor a second time, and rejecting every other device in its Discovery.

The code fixes what a move can be:

- Readings belong to the organization they were stored for. The runtime stamps every
  stored row with the device definition's organization and refuses a definition whose
  organization differs from the device row it already holds
  (`services/runtime/internal/storage/store.go`, `Apply` and `PersistResult`). A
  device cannot change organization in place.
- The runtime routes a Sparkplug message by its source key, connection, edge node and
  device ID (`internal/devices/types.go`, `Source.Key`), with no organization in it.
  It would already store a source's readings for a device in another organization;
  only Laravel stops that.
- Laravel's gate is the organization scope on the discovered source when a draft is
  saved (`DeviceConfigurationService::saveDraft`). A source belongs to the
  organization of the connection that announced it, and an adapter's sources to the
  adapter's organization, whose publisher is edge node `adapter-<adapter uuid>` in
  group `adapters-<organization uuid>` (ADR-010).
- Device profiles, parameters, dashboards, automations and their bindings are
  organization-scoped and validated against the organization on every save.

## Decision

**A device belongs to one organization for its whole life.** Moving a device to
another organization of the same billing account archives it in the source, as moved,
and creates a new device in the target, linked to it. The new device gets a copy of
the configuration and of the profile version it used. Readings are never copied or
re-stamped.

**The pipe stays; the device can be hosted.** A device's pipe is what brings its
messages in: an adapter and the publisher it runs as, or a gateway in one of an
organization's connections, with credentials, decoder and Discovery. Within one
billing account, a device may report through a pipe another organization owns. It is
then a *hosted device*.

- The pipe owner keeps the pipe, its credentials, decoder, Discovery, deliveries and
  samples, and the raw messages they show, including those of hosted devices. It sees
  in which organization each source is in use and how many hosted devices each
  organization has, never the hosted device's record, configuration or readings.
- The hosted device's organization owns the device, its configuration, readings,
  alerts, commands and automations. Of the pipe it sees only the kind, the name, the
  owner's name, whether it is online, and the metrics the pipe announces for that
  device's source.
- A device holds another organization's source only when a move or an onboarding into
  another organization gave it that source. Nobody can pick another organization's
  source by hand.
- Pipes are never copied into another organization.
- A directly connected device is its own gateway, so its gateway changes organization
  with it and keeps its credentials and message topic. The connection that names its
  Sparkplug group stays where it is, as a namespace; nobody manages it.
- Moves and hosting exist only inside one billing account. An organization can't
  leave its account while it has hosted devices or its pipes serve them.

**History may follow the device, read-only.** When the mover chooses it for a move,
the new device's organization may read the archived device's readings from before
the cutover. The readings stay stored for the source, under its retention. Laravel
decides access and asks the runtime for each organization's readings separately, so
the runtime never decides a crossing. Access ends when the source stops it or either
organization leaves the account. It is per link and does not follow a chain of
moves.

**Everything else stays inside one organization.** Profiles are copied, not shared.
A dashboard or automation never uses devices of two organizations. Billing accounts
still grant no access: the mover is a member of both organizations, with
`Device.move` in each.

## Consequences

- An integrator moves devices to a customer without copying a vendor credential or
  polling a vendor twice, and onboards new sources straight into the customer's
  organization.
- The organization is no longer the only boundary for two things, both bounded by the
  billing account: a pipe can feed another organization's devices, and a moved device
  can read its predecessor's history. Constitution principle III is amended to name
  them (constitution 1.1.0). Each crossing has isolation tests proving that
  organizations outside the account, and members of only one side, see nothing more.
- Archiving a device must end its adapter installation and release its onboarding
  record. Otherwise a source could never serve a second device.
- Pipe changes now affect other organizations. Deleting or archiving a pipe that
  serves hosted devices is refused, and pausing, redeploying, rolling back, changing
  the decoder or rotating credentials first names the organizations affected.
- Offline alerts follow ownership: the pipe's own to the pipe owner, a hosted device's
  to its organization. The runtime attributes gateway episodes to the gateway's
  organization rather than to its first device's.
- A move stops each predecessor before the cutover. Readings arriving between the stop
  and the successor's start are stored for neither organization; the gap is under a
  minute.
- Spec 016 (sharing and transfers between unrelated organizations, in draft) can
  reuse the device link and cutover, and needs its own decision for anything that
  crosses an account.
