# Contract: Point map v1

The schema, fixtures and cases live in `contracts/pointmaps/v1/` (PR 2). A point map
says, for one device type, which point feeds each reading and which equipment it
applies to. The shared part is protocol-neutral; only `address` depends on `protocol`.

```json
{
  "version": 1,
  "protocol": "opcua",
  "rhythm_seconds": 300,
  "readings": [
    {
      "key": "zone_temperature",
      "name": "Zone temperature",
      "data_type": "number",
      "unit": "°C",
      "scale": 1,
      "offset": 0,
      "report": { "sample_ms": 10000, "deadband": { "kind": "percent", "value": 0.5 } },
      "address": {
        "relative_path": [
          { "namespace_uri": "urn:example:bms:example-tower", "name": "ZoneTemperature" }
        ]
      }
    }
  ],
  "equipment": [
    {
      "source_id": "ExampleTower/Floor3/Zone2/ZoneController",
      "display_name": "Floor 3 Zone 2 controller",
      "address": {
        "node_id": "s=Floor3.Zone2.ZoneController",
        "namespace_uri": "urn:example:bms:example-tower",
        "path": [
          { "namespace_uri": "urn:example:bms:example-tower", "name": "ExampleTower" },
          { "namespace_uri": "urn:example:bms:example-tower", "name": "Floor3" },
          { "namespace_uri": "urn:example:bms:example-tower", "name": "Zone2" },
          { "namespace_uri": "urn:example:bms:example-tower", "name": "ZoneController" }
        ]
      },
      "overrides": { "zone_temperature": { "node_id": "s=…", "namespace_uri": "…" } },
      "missing": ["occupancy"]
    }
  ]
}
```

Rules:

- `readings[].key` is unique, follows the profile parameter key rules, and maps to one
  parameter of the adapter's profile.
- `data_type` is `number`, `boolean`, `state` (integer with labels) or `text`.
- `deadband.kind` is `none`, `absolute` or `percent`; `percent` needs a range on the
  point, otherwise the review reports a problem.
- `sample_ms` ≥ 1000. `rhythm_seconds` is 60 to 3600.
- Namespaces are always URIs, never indexes.
- `equipment[].source_id` is unique in the map and becomes the publisher's
  `sourceDeviceId`.
- `overrides` gives one equipment a different point for a reading (flat tag lists
  whose names do not follow the relative path). `missing` lists readings that
  equipment does not have.
- For a flat server, `relative_path` holds one name pattern segment
  (`{ "pattern": "{equipment}.ZN-T" }`) and each equipment's `address.path` is the
  folder of the tag list plus the equipment's tag prefix.
- Readings × equipment (less `missing`) is the point count checked against the limit.

Later protocols add an `address` shape under their own `protocol` value (a Modbus
unit, table and register; a BACnet device, object type and instance; an OBIS code)
and reuse everything else.
