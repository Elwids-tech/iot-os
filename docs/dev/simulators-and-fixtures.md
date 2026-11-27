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

### Many water meters

`--meters <count>` also announces `count` water meters, `meter-001` onwards, as
downstream devices of the same gateway, each with `flow_rate` (L/min) and
`total_volume` (L) as Doubles, matching the profile that
`php artisan devices:prepare-water-meter-profile` publishes. Each meter reports
once every 10 seconds, a tenth of them each second. The simulator prints
`Rebirth requested (N since start)` for every rebirth the platform asks for, which
is how a bulk onboarding run's rebirths are counted
([devices](../features/devices.md#bulk-onboarding), spec 026 quickstart 5):

```sh
.local/devices/python/bin/python tooling/simulators/sparkplug_simulator.py \
  --config .local/devices/simulator.json --state-file .local/devices/simulator-state \
  --meters 247
```

The energy meter and RGB light are still announced, so they serve as sources of
another type. `--meters` cannot be combined with `--gps`. `--meters-from <n>` numbers
the meters from `n`; the width grows past 999, so `--meters 500 --meters-from 601`
announces `meter-0601` to `meter-1100`.

**Load checks.** 500 onboarded meters reporting every 10 s are the platform's tested
rate (50 messages a second). While they run,
[`tooling/measure-history-latency.py`](../../tooling/measure-history-latency.py) waits,
then reads each message's commit time from PostgreSQL (`pg_xact_commit_timestamp` of its
observation rows). It reports the time from receipt to that commit timestamp (taken
before the commit's flush), the queue before the storing transaction starts and the
transaction itself, with no polling delay.
It needs `track_commit_timestamp` on, which takes a database restart (`ALTER SYSTEM`,
then `ALTER SYSTEM RESET` afterwards). Run it once per runtime build under the same load
and compare (spec 029 SC-004, [billing](../features/billing.md#data-points)).
[`tooling/measure-runtime-restart.py`](../../tooling/measure-runtime-restart.py) restarts
or kills the runtime under the same load and reports what it cost, and
`BenchmarkPipeline` measures what the runtime's serial stages carry
([runtime](runtime.md)).
Retire load-test devices afterwards with deactivate, then archive once the runtime
has acknowledged. An archived device keeps its source id ("already onboarded"), so
the next load check takes new numbers with `--meters-from`.

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

## Building management simulator (OPC UA)

[`bms_server.py`](../../tooling/simulators/bms_server.py) serves Example Tower, an
invented office tower, as an OPC UA server, for the OPC UA connector of
[spec 038](../../specs/038-opc-ua-connector/spec.md). **A passing run against it is not
verification against a real building's server**: real servers name, type and secure
their points in their own ways.

### The building

The building is defined once, in
[`bms/buildings/example-tower.yaml`](../../tooling/simulators/bms/buildings/example-tower.yaml)
(checked against the schema beside it), and explained floor by floor in the
[building plan](../../specs/038-opc-ua-connector/building.md): levels, zones with their
outlines, every equipment item with its position, footprint and what feeds it, and the
point library. A 3D model and the expected entity hierarchy are drawn from the same
file; `--export-model` prints it as JSON. Keys never change: `L03` is a level,
`L03-Z2` a zone, `L03-VAV-2` a zone box and `L03-VAV-2.zone_temperature` a point.

The building runs itself: a seeded day of weather and people, zone heat balances,
plant that stages with load and electricity that adds up through the meter tree
([`bms/physics.py`](../../tooling/simulators/bms/physics.py)). Every piece of
equipment has its own control loop
([`bms/controls.py`](../../tooling/simulators/bms/controls.py)), so a written setpoint
moves the zone and a plant switched off stops. The same seed gives the same day.

### Running it

On its own, in the simulators' virtual environment:

```sh
.local/devices/python/bin/python tooling/simulators/bms_server.py --size standard --speed 60
```

With the stack, add the overlay to the usual compose command; adapters reach it at
`opc.tcp://bms-simulator:4840`:

```sh
docker compose --env-file .env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
  -f deploy/compose/compose.bms-simulator.yml up -d --build bms-simulator
```

`BMS_SIMULATOR_SIZE`, `BMS_SIMULATOR_STYLE` and `BMS_SIMULATOR_SPEED` set its size,
naming style and speed in the stack.

| Option | Values | Default |
| --- | --- | --- |
| `--style` | `structured` (site, building, level and zone folders, each equipment item a typed object), `flat` (one folder of vendor-style tags such as `ET_L03_VAV_2.ZN-T`) | `structured` |
| `--size` | `standard` (levels 2 and 3, the plant floor, the roof and the main meter: 706 points), `tower` (2,466), `large` (6,602) | `standard` |
| `--writes` | `off` makes every point read only | `on` |
| `--season`, `--seed`, `--speed` | the day it runs, and simulated seconds a second | `summer`, `7`, `1` |
| `--security` | any of `none`, `basic256sha256` | both |
| `--auth` | any of `anonymous`, `username`, `certificate` | all |
| `--strict-trust` | refuse client certificates until they are in the trusted folder | off |
| `--node-ids` | `stable` (string ids, the point keys), `renumber` (new numeric ids at each start; paths stay) | `stable` |
| `--host`, `--port`, `--control-host`, `--control-port` | where it listens; keep the control port on loopback | `127.0.0.1`, `4840`, `127.0.0.1`, `4841` |
| `--export-model` | print the building as JSON and stop | |

Desktop clients use `opc.tcp://localhost:4840`. Points carry their display name,
description, source time and status; numbers are `AnalogItemType` with `EURange` and
`EngineeringUnits`, on/off values and named states carry their labels.

### Sign-in and writing

At first start the simulator writes its test sign-in values to
`.local/devices/bms-simulator.json` and its certificates to
`.local/devices/bms-simulator/`: the server certificate, the operator's client
certificate and key, and the `trusted` and `rejected` folders. Nothing there is
committed.

Anonymous sessions read only. Writing a command point (a setpoint, a mode or a
request) needs the `operator`: by name and password, or with the operator certificate.
Any other client certificate reads. A value outside the point's limits is refused with
`BadOutOfRange`, the wrong type with `BadTypeMismatch`, a sensor, status, alarm or
total with `BadNotWritable`, and a session that may not write with
`BadUserAccessDenied`. With `--strict-trust`, a client certificate the server has not
seen lands in `rejected/`; move it to `trusted/` and connect again.

### Scenarios and the controls page

The control port serves a controls page at `http://localhost:4841/`
([`bms_controls.html`](../../tooling/simulators/bms_controls.html)): watched points
with their status, a switch for each scenario with an optional target, and a form
that writes a command as the operator. The same port answers `GET /state`,
`GET /values?points=…`, `GET /scenarios`, `POST /scenarios/{name}`
(`{"on": true, "target": "L03-VAV-2"}`) and `POST /write`
(`{"point": "L03-VAV-2.temperature_setpoint", "value": 21}`).

| Scenario | Effect | Target (default) |
| --- | --- | --- |
| `damper_stuck` | A zone's damper holds its position; the zone drifts off setpoint | zone box (`L03-VAV-2`) |
| `filter_alarm` | An air handling unit's filter pressure rises until its alarm is on | air handling unit (`L03-AHU-1`) |
| `chiller_trip` | A chiller faults; chilled water warms; the next chiller stages on | chiller (the running one) |
| `controller_offline` | A controller's points turn `BadNoCommunication`, holding their last value | equipment (`L03-VAV-2`) |
| `sensor_failure` | One point turns `BadSensorFailure` | point (`L03-VAV-2.zone_temperature`) |
| `uncertain_value` | One point reports `UncertainLastUsableValue` | point (`L03-VAV-3.zone_temperature`) |
| `server_restart` | The server stops for a time, then starts again | seconds (30) |
| `certificate_changed` | The server restarts with a new certificate | |
| `clock_wrong` | Source times run ahead (or, negative, behind) | seconds (600) |
| `meter_replaced` | A meter's totals start again from zero | meter (`L03-EM-1`) |
| `session_limit` | The server accepts one session only | |
| `slow_browse` | Browse answers wait | seconds (3) |
| `hand_mode` | An item is in hand at its panel; writes are accepted and ignored | equipment (`L03-AHU-1`) |
| `power_outage` | The mains fail; the generator takes the load; the supply runs on battery until then | |
| `water_leak` | A leak detector turns on and the water flow rises | level (`L03`) |
| `car_park_co` | Carbon monoxide rises on a car park level; its fans speed up | car park level (`B1`, tower) |
| `lift_fault` | A lift goes out of service | lift (`G-LIFT-1`, tower) |
| `fire_alarm` | A level's fire alarm turns on; its air handling unit stops; stairs pressurise | level (`L03`) |

`asyncua` (LGPL-3.0-or-later) and `PyYAML` (MIT) are in the requirements for this
simulator only; nothing in a release uses them. Its tests (`test_bms_*.py`) run with
the other simulator tests.

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
