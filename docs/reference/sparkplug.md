# Sparkplug B

Sparkplug B 3.0 over MQTT is the only device ingestion protocol the runtime speaks
([ADR-005](../adr/ADR-005-sparkplug-b-boundary.md)). Native Sparkplug devices and
gateways connect directly; vendor MQTT devices reach it through
[adapters](../features/adapters.md).

The specification is maintained by the Eclipse Foundation:
**<https://sparkplug.eclipse.org/>**. This page describes how IoT OS uses it.

Code: [`services/runtime/internal/sparkplug`](../../services/runtime/internal/sparkplug)
(session state, decoding), [`internal/app/application.go`](../../services/runtime/internal/app/application.go)
(broker connections, STATE, rebirth, commands). Protobuf: the official Eclipse Tahu
`sparkplug_b.proto`, pinned by commit, SHA-256 and generator versions in
[`contracts/sparkplug/upstream.json`](../../contracts/sparkplug/upstream.json), with
binary fixtures in [`contracts/sparkplug/fixtures`](../../contracts/sparkplug/fixtures).

## Mapping to the platform

| Sparkplug | Platform |
| --- | --- |
| Group ID | One **broker connection** (`SparkplugConnection.group_id`, globally unique); broker ACLs confine it to `spBv1.0/<group_id>/…` |
| Primary Host ID | The connection's `host_id`; the runtime is the host application |
| Edge Node ID | A **gateway** (`SparkplugGateway.edge_node_id`) |
| Device ID | A **discovered source** (`source_device_id`); empty means the edge node's own metrics |
| Metric name | Mapped to a profile parameter in the device configuration |

Sparkplug identifiers are source addresses only. A platform device is bound to a
source by its configuration, so the Sparkplug hierarchy never becomes the domain
model. Births create **discovery candidates**, never trusted devices; a person
registers, maps and activates them ([devices](../features/devices.md)).

## What the runtime does

- **Host application state.** For each ready connection the runtime connects with
  the host credentials over TLS 1.2+, subscribes to the group's topics and its own
  `spBv1.0/STATE/<host_id>`, publishes its online state (retained, QoS 1) and sets
  an offline will.
- **Births.** NBIRTH must have `seq = 0` and a `bdSeq` metric; it starts a session.
  DBIRTH registers a device's metrics, datatypes and aliases. A change in metric
  names or datatypes bumps the candidate's `birth_revision`; if it no longer matches
  an applied configuration the device is marked review required, until a later
  birth matches it again ([ADR-025](../adr/ADR-025-review-follows-current-birth.md)).
- **Data.** NDATA/DDATA are accepted only after a birth, with the next sequence
  number (mod 256) and the same datatypes; aliases resolve through the birth.
  Duplicates and wraparound are handled.
- **Deaths.** NDEATH must match the session's `bdSeq`; NDEATH and DDEATH mark
  presence offline.
- **Rebirth.** When a session is missing or inconsistent the runtime publishes
  NCMD `Node Control/Rebirth`, at most once per 30 seconds per edge node; requests
  inside that window are queued. Until the births arrive, presence is unknown only
  for what the rejected packet broke: the edge node and its devices, or one device
  that sent data before its DBIRTH. Only a lost broker connection makes every
  device on the connection unknown.
- **Commands.** Confirmed device commands are sent as NCMD or DCMD to the mapped
  outbound metric. Completion requires a later live reading that matches
  ([commands](../features/devices.md#commands-and-controls)).

## Datatypes

Supported: Int8–Int64, UInt8–UInt64, Float, Double, Boolean, String, Text, UUID,
DateTime and Bytes. Int64/UInt64 values outside JavaScript's safe integer range,
out-of-range unsigned values, non-finite numbers and malformed values produce
diagnostics. DataSets, Templates and custom codecs are not
supported.

## Limits

- Interoperability is tested with the platform's simulators and the Waveshare
  board; this is not formal Sparkplug conformance certification.
- One runtime is the host application for every connection; there is no host
  redundancy.
- Adapter output uses group `adapters-<organization uuid>` and edge node
  `adapter-<adapter uuid>`, published by the managed publisher.
