# Internal event contracts

`v1/telemetry-committed.schema.json` defines `telemetry.committed.v1`, published on
`iot.committed.telemetry.v1` after telemetry storage commits. Its fixture is
checked by `tooling/verify-devices-contracts.py` and the Go projection contract test.

This is an internal contract, not a public subscription or tenant authorization
boundary. See [events and messaging](../../docs/reference/events.md#committed-telemetry)
for delivery, ordering, monitoring and the example consumer.

Other event and command schemas remain independently versioned in their domain
contract directories; this feed does not replace lifecycle events or ingestion.
