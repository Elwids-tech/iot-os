# Raw telemetry and stored location reads

Delivered with SDK 0.5.0. [Public contract](../../docs/integration-raw-location.md).

- Device/tenant-scoped raw good-quality observations, source provenance, bounded
  keyset pages, signed request-bound cursors and explicit total-cap reporting.
- Narrow discovery of immutable successfully applied location bindings.
- Stored committed-event resolution through the existing location resolver;
  clients cannot supply replacement evidence or evaluation time. Unknown remains
  unknown, and historical fixes cannot become live eligible.
- No workflow, notification or command side effects; no external stream promise.

Verified: 151 API tests, 12 SDK tests, full isolated Devices regression suite
including database/broker/race checks, rebuilt API/workers/runtime, and live
HTTP verification from an independently installed SDK tarball. Temporary fixture
credentials, telemetry and binding versions were removed. No registry publication
or production deployment.

Next: P4 generic location/alert presentation. Integration management UI is delivered. Telemetry streaming, complete export/reconciliation,
standalone binding authoring and pilot load/retention operations remain pending.
The visual workflow builder stays deferred.

Portal management is delivered: [applications, tokens and webhooks](../../docs/integration-management.md).
