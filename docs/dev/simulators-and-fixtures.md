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

### Thermal fire-watch box

[`fire_watch_box.py`](../../tooling/simulators/fire_watch_box.py) stands in for an
edge-AI fire-watch kit (colour and thermal cameras with on-board detection, a
battery) that reports its detections as a direct Sparkplug edge node. It publishes
ten metrics every second: hottest point and scene temperature, flame (with
confidence), smoke, person in the exclusion zone, camera view blocked, battery,
running on battery and a detection counter. Nothing happens until someone stages
an incident on its loopback-only control page (`--control-port`, default
`http://127.0.0.1:8767`): hot work igniting (the hottest point passes 80 °C, then
flame, then smoke after 15 s), smoke, a person entering the zone, covering the
camera, cutting mains power, or setting the battery level.

Two behaviours are deliberate. A covered camera publishes everything the cameras
see as Sparkplug nulls, which the runtime stores as invalid readings, so an alert
that was active stays active instead of reading "clear". An empty battery sends
NDEATH and disconnects; restoring mains reconnects with a new session and births
again.

[`setup-fire-watch-demo.mjs`](../../tooling/setup-fire-watch-demo.mjs) builds the
whole demo through the public API, local stack only, and is safe to rerun:

```sh
node tooling/setup-fire-watch-demo.mjs
```

It signs in as the seeded super administrator and does the following:

- Creates the organization **Fire watch demo (simulated)**
  (`FIRE_WATCH_ORG_NAME`, `FIRE_WATCH_ORG_SLUG`).
- Invites two administrators, Site Supervisor and Fire Watch Lead. It accepts
  their invitations through Mailpit and keeps the generated passwords in
  `.local/demos/fire-watch/demo.json`.
- Publishes the **Thermal fire-watch box** profile.
- Onboards the box as a direct device and writes its connection kit to
  `.local/demos/fire-watch/kit/`.
- Waits for the box's birth, then maps and activates it.

Start the box while it waits:

```sh
.local/devices/python/bin/python tooling/simulators/fire_watch_box.py \
  --config .local/demos/fire-watch/kit/device-config.json \
  --state-file .local/demos/fire-watch/box-state
```

It then activates six automations: flame, hot spot above 80 °C (cleared below
60 °C), smoke, person in the exclusion zone, camera view blocked and battery
below 20 %. Each automation emails both people when its alert activates and when
it clears. The script finishes with the **Fire watch · Hot work area** dashboard.
`--refresh-dashboard` rewrites the dashboard from the script.

To set up the same demo in an existing organization on a hosted environment, point
the script at it. You sign in at a prompt, and the password is not echoed:

```sh
FIRE_WATCH_API_URL=https://api.<domain> FIRE_WATCH_PORTAL_URL=https://app.<domain> \
  node tooling/setup-fire-watch-demo.mjs --organization <organization-uuid> \
  [--recipients colleague@example.com]
```

Hosted mode creates no accounts and never changes anyone's email preferences: you
and any listed members receive the alert email. It keeps the kit under
`.local/demos/fire-watch-<api host>-<organization>/`, prints a box command with
`--control-port 8768` so a local box can keep running on 8767, and waits (up to
three hours) while the environment answers 503 for connection kits.

Incidents show up in **Alerts**, where they can be acknowledged, assigned and
commented on, and the emails arrive in Mailpit. Each automation's recipients are
under Settings → Notifications.

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

## HTTP vendor simulators (webhook and polling sources)

These stand in for vendor clouds that reach devices over HTTP instead of MQTT, for
adapters whose source is **Vendor cloud sends webhooks** or **Poll a vendor API**
([HTTP adapter sources quickstart](../../specs/020-http-adapter-sources/quickstart.md)).
They use only the Python standard library (Python 3.12 or newer).

| Script | Vendor | Key options |
| --- | --- | --- |
| [`vendor_tracker_api.py`](../../tooling/simulators/vendor_tracker_api.py) | Cellular asset-tracker history REST API ("Example Tracker Cloud"): trackers record every 5 minutes, upload every 15 and sometimes come back from a coverage gap with a backlog, so records are minutes to hours old | `--api-key` (required), `--port 8096`, `--host 0.0.0.0` for containers, `--account A1`, `--trackers 3`, `--reading-every`, `--upload-every`, `--offline-max`, `--days 3`, `--seed 7` |
| [`vendor_webhook_cloud.py`](../../tooling/simulators/vendor_webhook_cloud.py) | Sensor cloud that POSTs a JSON array of messages (`messageId`, `deviceId`, `ts`, temperature, humidity, battery, rssi) | `--url` and `--secret` (required), `--auth hmac\|header\|url`, `--timestamp-header`, `--prefix`, `--encoding hex\|base64`, `--devices`, `--interval`, `--count`, `--batch` |

```bash
.local/devices/python/bin/python tooling/simulators/vendor_tracker_api.py \
  --host 0.0.0.0 --port 8096 --api-key <key>
.local/devices/python/bin/python tooling/simulators/vendor_webhook_cloud.py \
  --url <ingest URL> --secret <secret> --timestamp-header x-timestamp
```

The tracker API serves `GET /accounts/<account>/streams/history?start=&end=&limit=` with
the key in `x-api-key`: `start` exclusive, `end` inclusive, ISO 8601 or epoch
milliseconds, `limit` up to 1000, answered as `{"data", "count", "maxDate"}`. Records are
ordered by `receivedDate`, so `maxDate` is the next `start`. The data depends only on
the clock and `--seed`, so a restart serves the same records. Control endpoints need no
key: `POST /_control` with `{"fault": "none|429|500|401|slow", "count": n,
"retry_after": s}` fails the next `n` history requests, `GET /_served` lists every record
id answered with `200` (for exactly-once checks) and `POST /_served/reset` clears it. The
vendor's own documentation, which the onboarding assistant can read, is
[`vendor_tracker_api.md`](../../tooling/simulators/vendor_tracker_api.md).

The webhook sender retries network errors, `408`, `429` and `5xx` with backoff (1, 2, 4
… 60 s, six attempts, honouring `Retry-After`) and never other `4xx`. It prints one line
per attempt with the status and the `delivery_id` from the receiver's `202`. Fault flags
exercise the receiver: `--bad-signature`, `--no-secret`, `--stale-timestamp` (needs
`--timestamp-header`), `--oversize` (one 1.1 MiB delivery first), `--burst N` (N
deliveries as fast as possible, not retried), `--duplicate` (same body and message ids
twice) and `--gzip` (the signature covers the uncompressed body). Both scripts have
unittest tests beside them, run with the other simulator tests by
`python -m unittest discover -s tooling/simulators -p 'test_*.py'`.

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
