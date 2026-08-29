# Device Onboarding Contract Fixtures

The same manifest also validates `device-onboarding-v2`. Its valid cases cover one Gateway payload routed to separate temperature and humidity logical Devices, divide-by-ten calibration, a minimal `temp_level` Command payload, one multi-parameter three-phase meter, same-Device derivation, a route-aware Runtime Bundle, and canonical telemetry. Its invalid cases lock duplicate UUID, dependency-cycle, unsafe-symbol, missing-policy, unresolved-target, and incompatible-type diagnostics.

Raw MQTT payloads and Command examples intentionally contain only manufacturer values plus binding-required routing, timestamp, message, and correlation fields. Labels, units, constraints, presentation hints, and formulas remain definition metadata.

The manifest drives executable JSON Schema validation.

- `valid/temperature-humidity-thermostat` covers the original conversational
  onboarding example: Device ID and timestamp envelopes, temperature and
  humidity telemetry, and a correlated two-way `temp_level` Command.
- `valid/multi-event` proves bounded `$.events[*]` record selection and
  discriminator-based event dispatch.
- `invalid` locks rejected Profile keys and unsupported JSONPath wildcards.

Payload-only files beside the schema instances are future compiler inputs. The
proposal fixture already contains a source payload and expected canonical
preview so the same scenario can cross the AI, Laravel, Go, and UI boundaries.
