# Simulators and fixtures

Simulators exercise the real pipeline (broker, runtime, storage, API) without
hardware. **A passing simulator run is not hardware verification**: it says
nothing about a real device's payloads, clocks, radio or firmware.

All simulators live in [`tooling/simulators`](../../tooling/simulators). They need
a Python virtual environment with their requirements:

```sh
python3 -m venv .local/devices/python
.local/devices/python/bin/pip install -r tooling/simulators/requirements.txt
```

They read a private gateway or device configuration file (credentials, CA path,
Sparkplug identities) and keep state in a file you pass with `--state-file`, so
`bdSeq`, counters and actuator state survive restarts. Keep both files under the
ignored `.local/` directory. **Run only one publisher per gateway identity.**

## Sparkplug simulators (native path)

Prepare credentials and the matching example profiles from the API container. The
command is restricted to local/testing environments, is additive, and never
replaces existing profiles or accounts
([`PrepareDeviceSimulator`](../../apps/api/app/Console/Commands/PrepareDeviceSimulator.php)):

```sh
devices_compose() {
  docker compose --env-file .env --env-file .local/devices/devices.env \
    -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
    -f deploy/compose/compose.devices.yml "$@"
}
devices_compose exec -T api php artisan devices:prepare-simulator \
  --organization=acme-manufacturing --output=/tmp/devices-simulator.json \
  --broker=ssl://localhost:8883 --ca="$PWD/.local/devices/certs/ca.crt"
devices_compose cp api:/tmp/devices-simulator.json .local/devices/simulator.json
```

Then run [`sparkplug_simulator.py`](../../tooling/simulators/sparkplug_simulator.py):

```sh
.local/devices/python/bin/python tooling/simulators/sparkplug_simulator.py \
  --config .local/devices/simulator.json --state-file .local/devices/simulator-state
```

The default configuration publishes an energy meter (calculation inputs) and an
RGB light (reports periodically and after commands). Registered devices still
need to be mapped and activated in the portal
([devices](../features/devices.md#onboarding-a-sparkplug-device)).

### RGB light v2

`--rgb-controls` on the prepare command creates a separate
`simulator-rgb-light-v2` profile and `simulator-rgb-edge` gateway without
touching the v1 example. Run the simulator with `--rgb-v2` (Power, Colour
`#RRGGBB`, Solid/Blink/Strobe, brightness 0–100%) and optionally
`--control-port 8766` to get a loopback-only page at `http://127.0.0.1:8766`
where you change the "physical" state yourself. Local changes and MQTT commands
share one update path. `node tooling/verify-rgb-controls.mjs` registers, maps and
activates the demo device, exercises both directions and creates a Controls
dashboard (localhost only; uses the seeded super-admin, override with
`RGB_EMAIL`/`RGB_PASSWORD`). The [Waveshare board](../hardware/waveshare-audio-board.md)
can take over this device identity.

### GPS trackers

`--gps` on the prepare command creates the GPS fixture
([`GpsUseCaseSeeder`](../../apps/api/database/seeders/GpsUseCaseSeeder.php)): a
latitude/longitude/accuracy profile, a gateway, three trackers (`gps-tracker`,
`gps-tracker-2`, `gps-tracker-3`), one fence around Calgary demo coordinates
with a draft geofence workflow per tracker, and a dashboard with coordinates,
history, location and alert panels. Run the simulator with `--gps`; the trackers
follow phase-offset routes across the fence and publish a paired fix every second.
Devices start deactivated so fresh births arrive first: activate each device, then
**Save and activate** in the geofence editor. The seeder is idempotent and never
replaces existing geometry, deployments or layout.

### Water meter

```sh
cd apps/api && php artisan devices:prepare-water-meter-profile --organization=acme-manufacturing
```

Pick **Water meter (simulator)** in **Devices → Add device**, extract the
downloaded connection kit privately, then:

```sh
.local/devices/python/bin/python tooling/simulators/water_meter.py \
  --config <kit>/device-config.json --state-file <private>/water-meter-state
```

It publishes as a direct Sparkplug edge node: 12 L/min by default (`--flow-rate`),
a total that starts at 1,000 L and integrates running time only, alias-based
NDATA, rebirth on request and NDEATH on clean shutdown.

### D1

[`d1_simulator.py`](../../tooling/simulators/d1_simulator.py) is a minimal
downstream device with one `Brightness` Int32 percentage, reporting every two
seconds and accepting 0–100 commands. Useful for the smallest end-to-end command
loop.

## Vendor MQTT simulators (adapter path)

These publish a manufacturer's own JSON, with no Sparkplug, to a tenant adapter
ingress broker using a hardware connection kit downloaded from **Device
adapters** ([adapters](../features/adapters.md)).

| Script | Device | Defaults |
| --- | --- | --- |
| [`vendor_water_meter.py`](../../tooling/simulators/vendor_water_meter.py) | Water meter with `serial`, `flow_ml_min`, `total_ml` | serial `WM-1042`, topic `meters/WM-1042/telemetry`, persistent total |
| [`vendor_env_sensor.py`](../../tooling/simulators/vendor_env_sensor.py) | Temperature/humidity sensor with radio and battery diagnostics, epoch-second `ts` | serial `ENV-0042`, topic `sensors/<serial>/telemetry` |

`php artisan devices:prepare-environment-sensor-profile` adds a published profile
for the environment sensor (no device or credentials). Both scripts take `--kit`,
`--serial`, `--topic`, `--interval` and `--count`.

## Seeders

| Seeder | What it creates | Notes |
| --- | --- | --- |
| `DatabaseSeeder` | Demo platform roles, two organizations (Acme Manufacturing, Northstar Utilities) and demo accounts | **New, empty development database only.** It updates its example accounts, so never use it as an upgrade |
| `DevicePermissionSeeder`, `DeviceProfilePermissionSeeder`, `PermissionSeeder` | Additive permission records and default grants | Safe on an existing database; reconcile restricted organizations |
| `SchneiderThreePhaseEnergyMeterSeeder` | A **draft** generic three-phase meter profile in `acme-manufacturing`: 31 parameters, six groups, three calculations, one disabled alarm suggestion | Refuses production; not in `DatabaseSeeder`; never overwrites a profile with the same code. Confirm registers, scaling and sign conventions against the real meter before publishing |
| `GpsUseCaseSeeder` | GPS fixture above | Local/testing only; run through `devices:prepare-simulator --gps` |
| `StudioBrowserSeeder` | Isolated accounts and a 500-parameter profile for the Profile Studio browser suite | Used by `tooling/test-profile-studio.mjs` |

Demo accounts (local only, password `password`): `super-admin@example.test`,
`platform-admin@example.test`, `shared.operator@example.test` (member of both
organizations), `acme.moderator@example.test`, `acme.member@example.test`,
`northstar.admin@example.test`, `northstar.member@example.test`.

## Contract fixtures

Executable schemas and golden fixtures sit beside each contract and are checked by
[`tooling/verify-devices-contracts.py`](../../tooling/verify-devices-contracts.py),
the Go tests and the PHP tests. See [contracts/README.md](../../contracts/README.md).

| Fixture | Used for |
| --- | --- |
| `contracts/sparkplug/fixtures/*.bin` + `expected.json` | Sparkplug B decoding (NBIRTH, DBIRTH, DDATA with aliases, DCMD, NDEATH) |
| `contracts/devices/v1/expressions.fixture.json` | PHP/Go calculation-evaluator parity |
| `contracts/devices/v2/conversions.fixture.json` | PHP/Go incoming-conversion parity |
| `contracts/location/v1/scenarios.fixture.json` | 30 location-fix scenarios (fresh, stale, historical, provenance, accuracy, reconnect, duplicates) |
| `contracts/rules/v1/simulation.*` | Geofence evaluator trace |
| `contracts/rules/v2/workflow.fixture.json` | Reference DAG: joined temperature/pressure windows, an alert and a pump-stop command |
| `contracts/definitions/device-profiles/*.json` | Compiled profile artifacts for the example devices |

[`location_scenarios.py`](../../tooling/simulators/location_scenarios.py)
regenerates location scenarios with other cadences or accuracy
(`--interval-seconds`, `--accuracy-metres`, `--scenario <name>`); it has no
network side effects.

## Disposable test environments

`./taskw devices:test` and `./taskw devices:serve` build a throwaway database,
broker and runtime with both Sparkplug simulators. See
[testing](testing.md#disposable-devices-environment).
