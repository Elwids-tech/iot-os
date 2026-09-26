# External telemetry reads — first slice

Delivered: separately authorized `telemetry:read`, scoped latest readings and
bounded chart history, public v1 projections and SDK 0.4.0 methods. See
[contract and verification](../../docs/integration-telemetry.md).

Verified: 150 API tests, 10 SDK tests, rebuilt API/workers, independent SDK package
reading retained synthetic telemetry and chart history through the public API.
Live checks covered empty data, ability/device/tenant denial and fixture cleanup.

Follow-up: [raw observations and stored paired fixes](../../docs/integration-raw-location.md) delivered in SDK 0.5.0. Pending: telemetry streaming, integration management UI and pilot quota/load validation. This does
not establish raw ML export or location pairing. Visual builder remains deferred.
