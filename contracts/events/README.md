# Internal event contracts

`v1/telemetry-committed.schema.json` defines `telemetry.committed.v1`, published on
`iot.committed.telemetry.v1` after telemetry storage commits. Readings of adapter
devices also carry `installation_uuid`, `adapter_revision_uuid` and
`manufacturer_serial`. Its fixture and cases are checked by
`tooling/verify-devices-contracts.py`; the Go tests compare the projection with the
fixture and assert an adapter projection against the schema
(`internal/devices/committed_test.go`).

This is an internal contract, not a public subscription or tenant authorization
boundary. See [events and messaging](../../docs/reference/events.md#committed-telemetry)
for delivery, ordering, monitoring and the example consumer.

Other event and command schemas remain independently versioned in their domain
contract directories; this feed does not replace lifecycle events or ingestion.
