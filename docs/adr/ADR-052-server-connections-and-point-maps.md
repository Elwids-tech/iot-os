# ADR-052: Typed Protocols Use Shared Server Connections and Point Maps; OPC UA First

**Status:** Proposed
**Date:** 2026-11-25
**Relates to:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md), [ADR-023](ADR-023-protocol-connectors.md),
[ADR-045](ADR-045-adapter-runtime-without-node-red.md), [spec 038](../../specs/038-opc-ua-connector/spec.md)

## Context

ADR-023 decided that typed protocols (OPC UA, Modbus, BACnet, DLMS) use a reviewable
point map instead of a decoder, and left the point map's contract and editor to "the
first typed protocol". Spec 038 is that protocol: an OPC UA client for building
management servers.

Three facts of the adapter model do not fit a typed server as they stand:

- A device adapter is one device type with one published profile, and its sources are
  that type's serial numbers ([adapters](../features/adapters.md)). One building
  server holds air handling units, zone controllers, chillers and meters together.
- Source settings and secrets belong to the adapter. A server limits how many sessions
  a client may open and has to trust the client's certificate once.
- Adapter outbound connections accept only public addresses (`lib/broker.cjs`,
  `lib/poll.cjs`). A building behind a site VPN has a private address, and tenant
  runtimes share the platform network (a risk ADR-010 records).

OPC UA also gives every value a status code, while the runtime knows only `good` and
`invalid` readings, and a subscription reports nothing while a value is steady, while
adapter devices are judged by their silence.

## Decision

- **A server connection is a record of its own.** An organization saves a connection
  (address, security, sign-in, the accepted server certificate, the platform's
  certificate for it). Several device adapters reference one connection, and the
  tenant runtime holds one session for it. Each adapter stays one device type.
- **A point map is an immutable adapter revision with no decoder.** Its contract
  (`contracts/pointmaps/v1`) has a protocol-neutral part (readings with key, type,
  unit, scale and reporting; equipment that become sources) and a protocol-specific
  address. Its deploy gate is a review check that resolves every point on the server.
  Later typed protocols add an address shape and reuse the contract and the editor.
- **The connector core is a library without Node-RED** in `services/adapters`, used by
  the tenant runtime, the manager's browse routes and, later, an on-site agent
  (a separate ADR).
- **Output stays on the managed Sparkplug B publisher.** The source emits the
  decoder-output shape; Discovery, review and activation are unchanged.
- **Quality crosses the boundary as metric properties.** Bad is a null metric with a
  reason and is stored as `invalid`; `uncertain` is a new reading quality that keeps
  its value. A report made only of bad readings is not hearing from the device.
- **A reporting rhythm.** Besides change reports, each device's points are read and
  published once per rhythm with the server's time, labelled as such, so a steady
  device stays online.
- **Private addresses only by operator allowance.** Platform staff may allow named
  private ranges per organization. A range can never cover loopback, link-local,
  metadata or platform networks.
- **Equipment is identified by its path of names.** Node ids are stored with their
  namespace URI as a hint and resolved again from the path when they change.
- **Read only.** Writes and method calls need their own decision.

## Consequences

- One trust step and one session per building, however many device types are read.
- Modbus, BACnet and DLMS get a contract and an editor to reuse, at the cost of
  designing the shared part before the second protocol exists; the address shape is
  the only part allowed to differ.
- The tenant runtime gains a large dependency (`node-opcua-client`). Its memory under
  5,000 points is measured before the collecting work builds on it, and the runtime's
  limit is raised for organizations with a connection if needed.
- `uncertain` is a new value every reader of reading quality must handle.
- The hearing rule changes for all adapters if an all-null report counts today; the
  pull request that changes it states the effect.
- Rhythm reports add stored rows in proportion to points and rhythm; the review shows
  the expected number before deployment.
- The entity hierarchy (spec 009) is not touched: it records where devices sit, never
  which protocol or node feeds them.
