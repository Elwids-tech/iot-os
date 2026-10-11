# Canonical Ingestion Contract

**Status:** Draft  
**Version:** 0.1  
**Last updated:** 2026-08-22

## Purpose

The canonical ingestion contract separates adapters and device protocols from deterministic Go ingestion. Native JSON, Sparkplug B, Node-RED, and future plugin runtimes all converge on this contract.

## Envelope

```json
{
  "contract_version": "iot.telemetry.v1",
  "adapter_id": "adapter_01",
  "adapter_version": "4",
  "source_device_id": "vendor-device-42",
  "device_id": "device_01",
  "profile_version_id": "profile-version-12",
  "observed_at": "2026-08-22T15:20:00Z",
  "received_at": "2026-08-22T15:20:01Z",
  "sequence": 1842,
  "trace_id": "trace_01",
  "quality": "good",
  "signals": [
    {
      "key": "temperature",
      "type": "float64",
      "value": 72.4,
      "unit": "celsius",
      "quality": "good"
    },
    {
      "key": "running",
      "type": "boolean",
      "value": true,
      "quality": "good"
    }
  ],
  "raw_payload_reference": null,
  "protocol_metadata": {
    "transport": "mqtt",
    "topic": "devices/42/telemetry"
  }
}
```

The wire format may become Protobuf for cross-language typing and efficiency. A JSON representation remains available for diagnostics, APIs, fixtures, and human review.

## Identity and Trust

Organization and tenant identity are derived from authenticated connection or adapter configuration. They are not trusted when supplied by a device payload.

The ingestion boundary must validate that:

- The authenticated connection may represent the adapter and device.
- The adapter version is active for that connection.
- The device is assigned to the referenced profile version.
- Signal keys exist in the activated profile.
- Event size, rate, timestamp, and sequence policies are satisfied.

## Signal Types

Initial types:

- `float64`
- `int64`
- `uint64`
- `boolean`
- `string`
- `bytes`
- `state`

Complex structures should be decomposed into governed signals or stored as referenced artifacts rather than becoming arbitrary nested telemetry.

## Time

- `observed_at` is source event time when available.
- `received_at` is assigned at the trusted ingress boundary.
- The platform records clock-quality and skew diagnostics when source time cannot be trusted.

## Idempotency

The final contract must define an idempotency key derived from adapter, source device, sequence, and event identity. Consumers must tolerate redelivery from JetStream.

## Invalid Events

Invalid events produce structured diagnostics containing stage, code, safe explanation, adapter version, profile version, trace ID, and raw-payload reference when permitted. They do not silently disappear or enter validated telemetry storage.

## Evolution Rules

- Additive fields remain backward compatible within a major contract version.
- Removing or changing field meaning requires a new major version.
- Producers declare `contract_version`.
- Consumers support an explicit version range.
- Adapter and profile versions remain separately traceable from contract version.

