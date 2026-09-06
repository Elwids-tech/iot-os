# Schneider three-phase energy meter starter

`SchneiderThreePhaseEnergyMeterSeeder` adds a **draft** device profile to an existing organization. It is a generic Schneider Electric authoring example, not a verified definition for a particular PowerLogic, Acti9 or other meter model.

## Run

From `apps/api`, against the intended **development** database:

```bash
php artisan db:seed --class=SchneiderThreePhaseEnergyMeterSeeder
```

The default target is the existing `acme-manufacturing` organization. In the tenant portal, choose **Acme Manufacturing → Device profiles** and open **Schneider Electric three-phase energy meter (starter)**. Its profile code is `schneider-three-phase-energy-meter`.

For the Docker development stack, rebuild the API image to include the new seeder, then run only this class:

```bash
docker compose --env-file .env -p iot-os-dev -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml exec -T api php artisan db:seed --class=SchneiderThreePhaseEnergyMeterSeeder
```

Another existing tenant can be targeted explicitly from a Laravel seeder using:

```php
$this->callWith(SchneiderThreePhaseEnergyMeterSeeder::class, [
    'organizationSlug' => 'your-existing-organization-slug',
]);
```

Import `Database\Seeders\SchneiderThreePhaseEnergyMeterSeeder` when calling from another namespace. The seeder intentionally is **not** included in `DatabaseSeeder`; it does not create organizations, reset passwords, change permissions, run migrations, or seed every tenant. It refuses production execution. Do not run `migrate:fresh` or the normal demo seeders to load this example.

## Contents

| Group | Parameters | Units |
| --- | --- | --- |
| Voltage | L1–N, L2–N, L3–N; L1–L2, L2–L3, L3–L1 | V |
| Current | L1, L2, L3 | A |
| Power | Active, reactive and apparent power for each phase and meter-reported totals | kW, kvar, kVA |
| Power quality | Frequency; per-phase and total signed power factor | Hz; dimensionless |
| Energy | Imported and exported cumulative active energy | kWh |
| Calculated values | Average phase voltage, average phase current, net active energy | V, A, kWh |

There are **31 parameters, six groups, three calculations and one optional alarm template**. All parameters are non-commandable. Derived values are calculated by the platform rather than reported by the meter.

- Average voltage/current: arithmetic mean of the three phase values.
- Net energy: imported minus exported cumulative active energy. This can be negative and is **not interval consumption**. Both source registers must use a common accumulation/reset basis.
- Non-negative validation applies to voltage, current, frequency, apparent power and cumulative import/export counters. Signed active/reactive power is allowed. Signed power factor accepts `-1` through `1`.
- Counters are monotonic with `reset_behavior: diagnose`; verify the actual register rollover/reset behavior.
- Five-minute reporting staleness is an editable example, not a manufacturer specification. The staleness alarm suggestion references total active power and is **disabled by default**. It is not an active alarm.

## Before publishing

Confirm the exact model and firmware, three-wire/four-wire configuration, supported registers, CT/PT scaling, units and power-factor/sign conventions against the manufacturer manual. Phase-to-neutral voltage and its average are only appropriate where those readings are available. Remove unsupported parameters and their dependent calculations/templates. This starter deliberately does not invent nominal voltage, frequency, current limits, accuracy ratings, demand intervals or Modbus addresses.

There are no protocol bindings, published artifacts, device assignments or activation events. Publishing remains an explicit action in the Studio.

## Repeat runs and verification

The entire profile is created and validated in one transaction. A matching profile code in the selected organization is left untouched, even when edited, published, archived or soft-deleted. Deleted examples are not silently restored, and repeat runs do not refill removed fields or children. Each organization receives independent UUIDs and parameter references.

The focused test suite uses the repository's isolated SQLite test database, never the developer database:

```bash
cd apps/api
php artisan test --compact --filter=SchneiderThreePhaseEnergyMeterSeederTest
```

Tests cover draft structure and compilation, sample calculations and validation boundaries, creation without model events, repeat-run preservation, deleted profiles, explicit tenant targeting, missing tenants, transaction rollback and production protection.
