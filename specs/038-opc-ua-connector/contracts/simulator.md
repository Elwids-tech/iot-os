# Contract: BMS simulator

`tooling/simulators/bms_server.py`. A development tool; nothing in the product
depends on it.

## Building (default size)

Namespace `urn:example:bms:example-tower`. Site **Example Campus**, building
**Example Tower**, floors 1 to 4, zones 1 to 4 on each floor.

| Equipment | Count | Points each (examples) |
| --- | --- | --- |
| Air handling unit | 2 | 20: supply, return, mixed and outdoor air temperature, supply air setpoint, supply and return fan status, speed and fault, cooling and heating valve position, outdoor damper position, filter differential pressure, filter alarm, duct static pressure and setpoint, operating mode (state), run hours |
| Zone controller | 16 | 12: zone temperature, setpoint, effective setpoint, occupancy, damper position, airflow, airflow setpoint, reheat valve position, CO₂, operating mode (state), window contact, communication alarm |
| Chiller | 2 | 14: status, fault, chilled water supply and return temperature, setpoint, load, power, condenser water temperatures, run hours, starts, alarm code (state) |
| Chilled water pump | 2 | 6: status, fault, speed, differential pressure, power, run hours |
| Cooling tower | 1 | 8: fan status, fan speed, basin temperature, supply and return temperature, makeup valve, vibration alarm, power |
| Boiler | 1 | 10: status, fault, supply and return temperature, setpoint, firing rate, flue gas temperature, gas valve, run hours, alarm code (state) |
| Heating pump | 2 | 6: as chilled water pump |
| Electricity meter | 5 | 12: energy imported (total), power, per-phase voltage and current, power factor, frequency |
| Water meter | 1 | 3: volume (total), flow, leak alarm |
| Heat meter | 1 | 5: energy (total), power, flow, supply and return temperature |

About 400 points. Every point has a display name, a description, a source timestamp
and a status; analog points have `EngineeringUnits` and `EURange`; states have their
labels.

## Options

| Option | Values | Default |
| --- | --- | --- |
| `--style` | `structured` (folders and typed objects), `flat` (one folder of tags such as `B1_F03_VAV_2.ZN-T`) | `structured` |
| `--size` | `standard` (about 400 points), `large` (at least 5,000: more floors and zones) | `standard` |
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
port, or from `bms_controls.html`.

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

## Tests

`pytest` covers the model (counts, units, ranges), a seeded day (repeatable values,
totals only rise), every scenario's effect, both naming styles exposing the same
points, and one read through a standard client for each security and sign-in choice.
