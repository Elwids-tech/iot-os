# Device profiles

A device profile describes a device type: its parameters, groups, calculations,
display hints and alarm suggestions. Publishing it produces an immutable revision
that devices pin through their configuration ([devices](devices.md)).

Code: Laravel [`Domain/DeviceProfiles`](../../apps/api/app/Domain/DeviceProfiles)
(compiler: [`ProfileDefinitionCompiler`](../../apps/api/app/Domain/DeviceProfiles/Services/ProfileDefinitionCompiler.php),
publish: [`PublishDeviceProfile`](../../apps/api/app/Domain/DeviceProfiles/Actions/PublishDeviceProfile.php));
runtime [`internal/devices/profile.go`](../../services/runtime/internal/devices/profile.go);
portal [`src/profiles`](../../apps/portal/src/profiles). Contract examples:
[`contracts/definitions/device-profiles`](../../contracts/definitions/device-profiles).

## Authoring

Open **Build → Device profiles** (visible to users who can edit profiles). Profile URLs include the organization:
`/organizations/:organizationUuid/device-profiles/:profileUuid/:section`.

1. Create a profile or open one. Edit Overview metadata with explicit Save/Cancel.
2. Add groups and parameters. The parameter sheet has Basics, Behavior, Validation
   and Advanced tabs: kind, data type, capabilities (`reports_state`,
   `accepts_command`), unit, precision, staleness hints, counter settings,
   validation rules and display hints. Removing a group moves its parameters to
   Ungrouped.
3. Add calculations for derived parameters and test them with sample values.
4. Optionally add alarm templates. They are suggestions only and never raise
   alerts.
5. Validate the exact saved draft, review changes against the published revision,
   and publish. Publishing never activates or upgrades a device.

Advanced configuration uses a JSON editor that shares form values with the guided
controls. Unsupported expressions are preserved and need advanced editing or an
explicit replacement.

The [profile assistant](assistant.md#device-profile-assistant) can draft sections
from documentation and samples; every change is reviewed and saved explicitly.
For a ready-made example, run the Schneider three-phase meter seeder
([fixtures](../dev/simulators-and-fixtures.md#seeders)).

## Rules that protect published data

- **Revisions are immutable.** Each publication compiles a canonical
  `device-profile.v2` definition with a SHA-256 hash. Earlier revisions stay
  readable and usable. Editing after publication creates pending changes.
- **Published parameters are fixed in key, kind and data type**, because devices,
  dashboards and history bind to them. A unit can change only to another spelling
  of the same unit. Labels, descriptions, groups and display settings stay
  editable.
- **Retired keys are never reused.** A published parameter can be deleted when
  nothing references it, but its key cannot be used again in that profile.
- **Dependencies block deletion.** A parameter referenced by a calculation, alarm
  template or mapping cannot be deleted; the error names the dependants. Only
  unused, never-published draft profiles can be deleted.
- **Optimistic concurrency.** Every draft mutation sends `draft_revision`; a
  conflict returns 409 and keeps the local form until you choose what to reapply.
- **Validation is server-side.** Expressions are evaluated by a bounded,
  restricted evaluator; unknown aliases, type errors, missing references and
  cycles block validation and publication. PHP and Go evaluators share parity
  fixtures ([`contracts/devices/v1/expressions.fixture.json`](../../contracts/devices/v1/expressions.fixture.json)).

## Units and display hints

Stored units come from the shared catalogue
[`contracts/units/v1/units.json`](../../contracts/units/v1/units.json), served at
`GET /api/v1/units`. Each unit has a quantity and a conversion to that quantity's
base unit. Spellings normalize on save (`kwh` → `kWh`, `m3/h` → `m³/h`); case
alone never picks between units such as `mW` and `MW`. Custom units are allowed
but have no quantity and are never converted. Changing a unit label never
converts stored values.

**Behavior → Dashboards** sets hints that dashboards read when they render: a
display range (`display_config.min`/`max`, separate from validation), a preferred
aggregation (`avg`, `min`, `max`, `last`, `sum`, or `increase` for counters), a
suggested visualization, and labels with tones (`good`, `info`, `warning`,
`critical`, `muted`) for enum and boolean values. `display.widget` picks a control
for writable parameters (for example `color` with `format: "hex_color"`). Hints
never change stored values.

## Incoming conversions and calculations

An **incoming conversion** normalizes one received measurement before storage. A
**calculation** creates an additional derived parameter from stored values.
Neither runs until a published revision is activated on a device.

- Only reported, read-only numeric measurements and counters can have a
  conversion: `{"source_unit": "W", "multiplier": 0.001, "offset": 0}` stores
  watts as kilowatts. Multipliers must be finite and non-zero; monotonic counters
  need a positive multiplier. Fractional results for integer outputs and
  non-finite results are invalid, never rounded.
- A device mapping chooses `profile` (use this default), `custom` (override) or
  `none` (pass through) ([devices](devices.md#configuration-and-activation)).
- Calculations consume values after conversion: doubling a power that arrived as
  1000 W and was stored as 1 kW gives 2 kW.
- **Calculations → Add calculation** can create the output parameter and the
  formula in one transaction (`POST device-profiles/{profile}/calculations`).
- Failed input quality or conversion marks readings invalid and propagates to
  dependent calculations. An unconverted value is never substituted.
- Conversion changes apply to future readings only. Shared numeric fixtures:
  [`contracts/devices/v2/conversions.fixture.json`](../../contracts/devices/v2/conversions.fixture.json).

The runtime still accepts `device-profile.v1` and `device-configuration.v1`
artifacts for existing devices; v1 cannot carry conversions.

## API

Under `/api/v1/organizations/{organization}/device-profiles`
([routes](../../apps/api/app/Domain/DeviceProfiles/routes/api.php)):

| Path | Purpose |
| --- | --- |
| `/`, `/{profile}` | List (`search`, `status`, `category`, paging), create, read, update, delete draft |
| `/{profile}/parameters`, `parameter-order`, `parameter-groups`, `group-order` | Parameters and groups |
| `/{profile}/calculations`, `parameters/{p}/calculation` | Calculations |
| `/{profile}/alarm-templates` | Alarm suggestions |
| `/{profile}/preview` | Non-saving validation, calculation or conversion preview for a draft revision |
| `/{profile}/validate`, `compile`, `publish` | Validation, compilation, publication |
| `/{profile}/artifacts`, `artifacts/active`, `artifacts/{revision}` | Published revisions |
| `/{profile}/transport-bindings` | Stored binding records; not used by the runtime |

The organization context includes `capabilities.device_profiles`.

## Permissions

`DeviceProfile.view-any`, `view`, `create`, `update`, `delete-draft`,
`validate`, `publish`, and `TransportBinding.manage`. Organization Admin has all;
Moderators can view and validate; Members can view. Existing databases receive
these grants through the additive `DeviceProfilePermissionSeeder`.
