# Device Onboarding v2 Fixtures

These fixtures prove the corrected contract vocabulary before persistence, compiler runtime, or UI implementation.

- `valid/hub-fanout` models one authenticated Gateway payload routed to separate temperature and humidity logical Devices. The temperature wire value is divided by ten, and its thermostat Command publishes only `command_id`, timestamp, route path, and `temp_level`.
- `valid/three-phase-meter` models one logical Device with three voltages, three currents, total active power, and a same-Device average-voltage derivation. Every measured and derived parameter has a stable UUID.
- `invalid` locks schema and semantic diagnostics for duplicate UUIDs, derived cycles, forbidden CEL symbols, missing policies, unresolved mapping targets, and incompatible wire types.

The shared manifest at `../device-onboarding/manifest.json` validates these files. Raw payload examples are future D4R3 compiler inputs; their presence does not claim runtime replay, EMQX ingestion, TimescaleDB persistence, or physical-device verification.
