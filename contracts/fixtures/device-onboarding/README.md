# Device Onboarding Contract Fixtures

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
