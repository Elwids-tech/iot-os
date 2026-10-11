# Device profile definitions

Example compiled profile definitions (`schema_version: device-profile.v1`) for the
platform's simulators and test hardware: RGB light (v1 and v2), three-phase energy
meter, GPS tracker and the Waveshare audio board. `devices:prepare-simulator`, the
GPS seeder, `tooling/hardware/setup-waveshare.mjs` and the PHP, Go and portal tests
load them.

New profiles are compiled by Laravel as `device-profile.v2`
([`ProfileDefinitionCompiler`](../../apps/api/app/Domain/DeviceProfiles/Services/ProfileDefinitionCompiler.php));
the runtime accepts both versions, and only v2 can carry incoming conversions.
Profile definitions contain no transport locators. A device configuration pins one
published definition by UUID and hash and carries it inline to the runtime
([ADR-014](../../docs/adr/ADR-014-control-plane-data-plane-http-integration.md)).

`bindings/` holds a Sparkplug B and an HTTP transport-binding example for the energy
meter, showing one parameter UUID mapped by two bindings. Binding records are stored
by Laravel but not used by the runtime, and there is no HTTP ingestion path
([device profiles](../../docs/features/device-profiles.md)).
