# Contract: BMS simulator

`tooling/simulators/bms_server.py`. A development tool; nothing in the product
depends on it.

## Building

Namespace `urn:example:bms:example-tower`. Site **Example Campus**, building
**Example Tower**: fourteen levels (two basements, ground, levels 1 to 10, roof),
described floor by floor in [the building plan](../building.md), which lists every
zone, equipment item, sensor, actuator and command.

The building is read from one model file,
`tooling/simulators/bms/buildings/example-tower.yaml`. The address space, the physics,
both naming styles and the totals below all come from it.

| Size | What runs | Points | Of which commands | Devices |
| --- | --- | --- | --- | --- |
| `standard` | Levels 2 and 3, the plant floor, the roof, the main meter | 706 | 148 | 84 |
| `tower` | The whole building | 2,466 | 531 | 294 |
| `large` | The tower with 30 office floors | 6,602 | 1,565 | 778 |

Every point has a display name, a description, a source timestamp and a status; analog
points have `EngineeringUnits` and `EURange`; states have their labels.

## Commands

The simulator is built with controls although the connector of this spec reads only
([research R20](../research.md)).

- A command point is a variable with write access; every other point is read only.
- Anonymous sessions read only. Writing needs the `operator` test sign-in (name and
  password, or its certificate).
- A value outside the point's limits is refused with `BadOutOfRange`; the wrong data
  type with `BadTypeMismatch`; a write without the right with `BadUserAccessDenied`.
- An accepted write takes effect in the physics at the next step. Equipment in hand
  mode accepts the write and ignores it, and its operating state reads `hand`.
- `--writes off` makes every point read only.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `--style` | `structured` (folders and typed objects), `flat` (one folder of tags such as `ET_L03_VAV_2.ZN-T`) | `structured` |
| `--size` | `standard`, `tower`, `large` (see the table above) | `standard` |
| `--writes` | `on`, `off` | `on` |
| `--season` | `summer`, `winter`, `mild` | `summer` |
| `--export-model` | print the building model as JSON and stop | |
| `--speed` | simulated seconds per second | `1` |
| `--seed` | integer | `7` |
| `--security` | any of `none`, `basic256sha256` | both |
| `--auth` | any of `anonymous`, `username`, `certificate` | all |
| `--port`, `--host`, `--control-port` | | `4840`, `127.0.0.1`, `4841` |
| `--strict-trust` | refuse client certificates until they are added to the trusted folder | off |
| `--node-ids` | `stable`, `renumber` (new numeric ids at each start) | `stable` |

Test sign-in values are written to `.local/devices/bms-simulator.json` at first start
(never committed).

## Scenarios

Switched with `POST /scenarios/{name}` (`{"on": true, "target": "…"}`) on the control
port, or from `bms_controls.html`. The control port also answers `GET /state`
(scenarios in force, simulated time) and `POST /write` (`{"point": "L03-VAV-2.temperature_setpoint", "value": 23}`),
which writes as the operator would, for tests and for trying controls by hand.

| Name | Effect |
| --- | --- |
| `damper_stuck` | One zone's damper holds its position; the zone drifts off setpoint |
| `filter_alarm` | An air handling unit's filter pressure rises until its alarm is on |
| `chiller_trip` | A chiller faults; chilled water warms; the second chiller stages on |
| `controller_offline` | One zone controller's points turn `Bad_NoCommunication` |
| `sensor_failure` | One point turns `Bad_SensorFailure` |
| `uncertain_value` | One point reports `Uncertain_LastUsableValue` |
| `server_restart` | The server stops for a given time, then starts again |
| `certificate_changed` | The server restarts with a new certificate |
| `clock_wrong` | Source timestamps run a given offset ahead or behind |
| `meter_replaced` | A meter's total starts again from zero |
| `session_limit` | The server accepts one session only |
| `slow_browse` | Browse answers are delayed |
| `hand_mode` | One equipment item is switched to hand at its panel; writes to it are accepted and ignored |
| `power_outage` | The mains fail; the generator starts and the transfer switch moves to it; the uninterruptible supply runs on battery until then |
| `water_leak` | A leak detector turns on and the level's water flow rises |
| `car_park_co` | Carbon monoxide rises on one car park level; its fans speed up |
| `lift_fault` | One lift goes out of service |
| `fire_alarm` | One level's fire alarm turns on; its air handling unit stops |

## Tests

`pytest` covers the model file against its schema and the totals above, a seeded day
(repeatable values, totals only rise, sub-meters add up to the main meter), every
local control loop reaching its setpoint, every command kind (accepted, out of range,
wrong type, not allowed, hand mode), every scenario's effect, both naming styles
exposing the same points, and one read through a standard client for each security
and sign-in choice.
