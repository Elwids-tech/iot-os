# ADR-023: Protocol Connectors Feed One Telemetry Envelope; Sparkplug B Is the Edge Uplink

**Status:** Accepted (direction; built protocol by protocol)
**Date:** 2026-10-27
**Relates to:** [ADR-005](ADR-005-sparkplug-b-boundary.md), [ADR-010](ADR-010-per-tenant-adapter-runtimes.md),
[ADR-022](ADR-022-webhook-receiver.md), [spec 002](../../specs/002-canonical-ingestion/spec.md),
[spec 020](../../specs/020-http-adapter-sources/spec.md)

## Context

The platform ingests Sparkplug B natively and everything else through adapters that
decode vendor JSON and re-encode it as Sparkplug B (ADR-010). Spec 020 adds webhook
and polling sources on that path. Customers also ask about OPC UA, DLMS/COSEM meters,
Modbus and BACnet. Each protocol differs in who connects to whom, how sessions,
security keys and backfill work, and whether values arrive typed or as opaque
bytes, but after that every protocol needs the same things: discovery, presence,
deduplication, storage and rules.

Platforms such as ThingsBoard converge on one shape: protocol-specific transports or
connectors, a converter step, and one internal message format, with an edge gateway
for private plant networks. That shape fits here. Its implementation does not: a
shared converter runtime breaks per-tenant isolation (ADR-010), and a private gateway
protocol would replace an open standard we already ingest.

## Decision

- **Every protocol is a connector, not a separate path into the data plane.** A
  connector owns only its protocol's mechanics: connections, sessions, schedules,
  retries, security keys and backfill. Everything after it is shared.
- **Connectors run where reachability puts them:**
  - **edge gateways** on site, dialling out, for plant-network protocols (OPC UA,
    Modbus, BACnet). Their uplink is **Sparkplug B**, so off-the-shelf gateways work
    today without platform code, and our own edge runtime is a later option;
  - **platform ingress** for protocols that push to us (MQTT, webhooks per ADR-022,
    later CoAP or DLMS push);
  - **tenant connectors** in the per-tenant runtime for protocols we call out to
    (HTTP polling per spec 020, later an OPC UA client or DLMS through a head-end
    system).
- **Typed protocols use a point map; opaque payloads use a decoder.** OPC UA nodes,
  OBIS codes and Modbus registers are mapped with reviewable settings (address, scale,
  unit, profile parameter). The sandboxed JavaScript decoder stays for vendor
  payloads.
- **One telemetry envelope.** Connectors and decoders produce the canonical envelope
  of spec 002 (`contracts/ingestion/v1`), read strictly by one ingestion path in the
  Go runtime. Until that path exists, adapter output keeps being re-encoded as
  Sparkplug B by the managed publisher; decoder input and output stay free of
  Sparkplug concepts so the switch changes no decoder or source.
- **Protocols are added one at a time, when a customer needs one**, each with its own
  spec, on the connector contract above. No catalogue is built ahead of demand.

| Protocol | Connector placement | Decode | Status |
| --- | --- | --- | --- |
| Sparkplug B | platform ingress | native | built |
| Manufacturer MQTT JSON | tenant ingress broker or vendor broker | decoder | built |
| HTTP webhook, HTTP polling | webhook receiver, tenant runtime | decoder | spec 020 |
| OPC UA, Modbus, BACnet on a plant network | edge gateway, Sparkplug B uplink | point map at the gateway | works with third-party gateways; own edge runtime planned |
| OPC UA server reachable over a VPN or the internet | tenant connector (client) | point map | planned |
| DLMS/COSEM through a head-end system | tenant connector (HTTP polling or webhook) | decoder | spec 020 covers it |
| DLMS/COSEM directly | platform ingress (push) or tenant connector (pull) | point map (OBIS, scaler, unit), load-profile backfill | planned |

## Consequences

- New protocols cost a connector and a mapping, not a new storage, presence or rules
  path.
- The Sparkplug B round trip on the adapter path (invented sessions and births,
  timestamps carried as metric properties) stays until spec 002's ingestion path is
  built; spec 020 keeps it contained to the managed publisher.
- Backfill rules defined by spec 020 (persisted cursor, historical results, oldest
  first, source time) are the rules later pull connectors reuse.
- Point maps need their own contract and editor when the first typed protocol is
  specified.
