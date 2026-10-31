# Field Mapping (`field-mapping.v1`)

This is a no-code description of how to read one JSON message. It compiles to an
ordinary decoder ([research R4](../research.md#r4-field-mapping-format-interpreter-and-compilation)).

## Files

All the files live in `contracts/adapters/v1/`:

- `field-mapping.v1.schema.json`, the `.fixture.json` and the `.cases.json`.
- `field-mapping.v1.runtime.js`: the interpreter, in ES2020 with no imports or
  globals. It runs in the browser for previews and in quickjs inside a revision. It
  is at most 12 KiB.
- `field-mapping.v1.parity.json`: cases of `{mapping, input, expected}`, where
  `expected` is the decoder output or `{ignored, reason}` or `{error}`.

## Shape

```json
{
  "version": 1,
  "records": "/data",
  "match": [
    { "on": "topic", "pattern": "sensors/+/telemetry" },
    { "on": "field", "pointer": "/type", "equals": "telemetry" }
  ],
  "identity": { "from": "field", "pointer": "/device_id" },
  "time": { "pointer": "/ts", "format": "epoch_s" },
  "readings": [
    { "pointer": "/temperature", "key": "temperature", "label": "Temperature", "data_type": "number", "unit": "°C", "scale": 1, "offset": 0 },
    { "pointer": "/battery_v", "key": "battery", "label": "Battery", "data_type": "number", "unit": "V", "scale": 1, "offset": 0 },
    { "pointer": "/fw", "key": "firmware", "label": "Firmware", "data_type": "string", "unit": null }
  ]
}
```

| Field | Rule |
| --- | --- |
| `version` | Always `1` |
| `records` | Optional. A JSON Pointer (RFC 6901) to an array in the payload; each item becomes one record (at most 500). Without it the payload is one record |
| `match` | Optional, at most 8 rules, all of which must hold. `topic` rules use MQTT wildcards against the topic or webhook path; `field` rules compare the value at `pointer` with `equals` (string, number or boolean). A message that fails is ignored with the reason `not_matched` |
| `identity.from` | One of `field` (`pointer`), `topic` (`segment`: a 0-based index into the topic split on `/`) or `fixed` (`value`, at most 128 characters, for a single-device source) |
| `time` | Optional. `pointer` with `format` `iso`, `epoch_s` or `epoch_ms`. Without it, results are receipt-timed (spec 020). An unparseable time fails that record with `time_invalid` |
| `readings` | 1–200 entries. `key` matches `^[a-z][a-z0-9_]{0,62}$` and is unique. `data_type` is `number`, `integer`, `boolean` or `string`. `unit` is a unit-catalogue symbol or a custom unit, or null. `scale` (non-zero) and `offset` apply to `number` and `integer` only, as `value × scale + offset` |

All pointers resolve within a record. `identity.pointer` and `time.pointer` may start
with `/$message`, which resolves against the whole message, for example a gateway ID
next to a list of readings.

## Semantics

These hold the same in the browser, in the sandbox and in Laravel's parity test:

1. **Parse**: a message whose payload is not JSON is a decode failure,
   `not_json`. The journey sends such sources to Edit as code (FR-037).
2. **Match**: if `match` fails, the result is `{ignore: true, reason:
   "not_matched"}` (see [decoder output](#decoder-output-changed)).
3. **Records**: a records pointer that is missing or not an array is a failure,
   `records_missing`.
4. **Identity**:
   - A missing, empty or non-scalar identity fails that record (`identity_missing`).
   - Numbers are written in decimal.
   - Values are trimmed and capped at 128 characters.
5. **Readings**:
   - A missing or null value is left out, never zero (principle VI).
   - A numeric string becomes a number for `number` and `integer`, and the preview
     marks it as a type difference.
   - A value that cannot be converted fails that reading with `type_mismatch`. The
     record keeps its other readings.
   - A record with no readings is ignored with `no_readings`.
6. **Output**: one result per record, `{sourceDeviceId, metrics: [{name, value,
   unit}], observedAt?}`.
   - It is a single result when there is one record and a list otherwise.
   - Records that failed or were ignored are reported in `helpers` diagnostics and
     do not stop the others.

## Compiled decoder

```text
<field-mapping.v1.runtime.js verbatim>
const MAPPING = <canonical JSON of the mapping: sorted keys, no whitespace>;
function decode(input, helpers) { return fieldMapping.decode(MAPPING, input, helpers); }
```

The portal and `FieldMappingCompiler` (PHP) produce byte-identical text, and the
parity cases check that. When the compiled text exceeds the decoder limit of 64,000
characters, the save gets a 422, `mapping_too_large`.

## Decoder output (changed)

`decoder-output.v1` gains an additive **ignored** result: `{"ignore": true, "reason":
"<code, at most 40 characters>"}`.

- A decoder may return it, alone or in a list, to skip a message or record on
  purpose.
- `validateResults` accepts it.
- The outcome counter adds `ignored`. It shows on See data and in Manage (FR-033).
- Hand-written decoders may use it too.
- The decoder-output cases gain valid and invalid ignored results.

## Suggestions (portal only, no contract)

`suggestMapping(samples, units)` gives the following, each marked as suggested:

- **Identity**: a field whose name matches serial, sn, device, id, imei, mac, eui or
  dev_eui and whose value stays the same within one record; otherwise a topic
  segment that differs between topics.
- **Time**: a field named ts, time, timestamp, observedAt, date or created_at that
  parses in one of the formats.
- **Readings**: numeric and boolean leaves that vary across samples, plus string
  leaves with fewer than 10 distinct values.
- **Units**: from name suffixes in the unit catalogue (`_c`, `_pct`, `_v`, `_mv`,
  `_kwh`…).
- **Labels**: from field names.
- **Records**: the first array of objects, when one exists.

The assistant is never needed (FR-031).
