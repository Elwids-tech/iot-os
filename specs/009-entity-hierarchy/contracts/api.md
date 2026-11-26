# Portal API: Entity Hierarchy

Under `/api/v1/organizations/{organization}` unless noted. Every route resolves the
organization and checks membership before the permission named (constitution III); an
entity, type or device of another organization answers `404`. A broken rule is a
standard `422` whose field message names the rule and what is allowed ("Line cannot
sit under Site. Allowed: Area."). A request that changes nothing records no activity
(FR-019). Operations are described in the generated OpenAPI contract (statuses that
inference misses in `contracts/openapi/supplements/entities.yaml`) and in
`packages/api-client/src/entities.ts`, in the same pull request (FR-022).

## Types and presets — PR 1

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET entity-types` | `Entity.view` | all types with rules and `entities_count` |
| `POST entity-types` | `EntityType.manage` | |
| `PATCH entity-types/{type}` | `EntityType.manage` | `key` immutable; Site type's fixed fields refused |
| `DELETE entity-types/{type}` | `EntityType.manage` | `422 in_use` while used or referenced |
| `GET entity-presets` | `Entity.view` | key, name, version, the types it adds and what it would merge |
| `POST entity-presets/{preset}/apply` | `EntityType.manage` | idempotent; returns the types added and merged |

Type view:

```json
{
  "uuid": "…", "key": "feeder", "name": "Feeder",
  "top_level": false, "parent_type_keys": ["substation"], "member_type_keys": [],
  "accepts_devices": true, "carries_timezone": false, "carries_location": false,
  "naming": { "template": "Feeder<number>", "example": "Feeder12", "description": "Feeder and its number" },
  "preset_keys": ["power_distribution"], "entities_count": 42
}
```

## Entities — PR 1 (placements in the view from PR 2)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET entities?parent={uuid}&page=` | `Entity.view` | children of a parent (top level without `parent`), 100 a page, ordered by name; `archived=only|with` |
| `GET entities/search?q=&page=` | `Entity.view` | name, path name or path; 25 a page (R16) |
| `GET entities/{entity}` | `Entity.view` | the entity with ancestors (breadcrumb) and counts |
| `POST entities` | `Entity.manage` | `parent_uuid` optional |
| `PATCH entities/{entity}` | `Entity.manage` | name, path name, description, time zone, location, attributes, `type_key` (retype) |
| `GET entities/{entity}/move-impact?parent=` | `Entity.view` | what a move would change (below); the portal shows it before moving |
| `POST entities/{entity}/move` | `Entity.manage` | `{parent_uuid: uuid|null}` |
| `POST entities/{entity}/archive`, `…/restore` | `Entity.manage` | restore takes an optional new `path_name` |
| `DELETE entities/{entity}` | `Entity.manage` | only an entity that never held anything; otherwise `422` asking to archive |
| `GET entities/path-name-suggestion?name=` | `Entity.view` | R11 |

Entity view:

```json
{
  "uuid": "…", "name": "Feeder 12", "path_name": "Feeder12",
  "path": "North/EastgateSS/Feeder12", "depth": 2,
  "type": { "key": "feeder", "name": "Feeder" },
  "parent_uuid": "…", "ancestors": [{ "uuid": "…", "name": "North", "path_name": "North" }],
  "description": null, "timezone": null, "effective_timezone": "Europe/Berlin",
  "address": null, "latitude": null, "longitude": null, "attributes": [],
  "children_count": 3, "placements_count": 1, "parameter_placements_count": 0,
  "outside_rules": [], "archived_at": null
}
```

Move impact (`GET entities/{entity}/move-impact`, `data`). PR 1 returns `entities` only;
the device, site, time zone and application counts join in PR 2:

```json
{
  "entities": 14, "points": 230, "devices": 20,
  "devices_changing_site": 20, "devices_changing_timezone": 0,
  "applications": [{ "uuid": "…", "name": "Twin viewer", "gains": 0, "loses": 20 }]
}
```

## Placements — PR 2

| Method and path | Permission | Notes |
| --- | --- | --- |
| `PUT devices/{device}/placement` | `Entity.manage` | `{entity_uuid, leaf_names?: {parameter_uuid: leaf}}`; ends the current placement and starts this one; returns the placement (`200`); a clash is `422` on `leaf_names` listing every clashing name |
| `DELETE devices/{device}/placement` | `Entity.manage` | ends it (`unplaced`) |
| `GET devices/{device}/placements` | `Entity.view` | history, newest first: entity (path today), start, end, end reason, who |
| `GET entities/{entity}/devices?branch=0|1&page=` | `Entity.view` | devices placed at the entity, or anywhere in its branch (coverage with memberships in PR 5) |

The device view gains `entity` (`{uuid, name, path}` or null) and `path`. The device
create and update requests accept `entity_uuid` beside `site_uuid` (one of them, `422`
when both); either places the device (needs `Entity.manage` as well as
`Device.manage`, except for `site_uuid`, which keeps today's `Device.manage`).

## Parameter placements and points — PR 4

| Method and path | Permission | Notes |
| --- | --- | --- |
| `PUT devices/{device}/parameters/{parameter}/placement` | `Entity.manage` | `{entity_uuid, leaf_name?}`; returns the parameter placement (`200`) |
| `DELETE devices/{device}/parameters/{parameter}/placement` | `Entity.manage` | |
| `GET entities/{entity}/points?branch=0|1&page=` | `Entity.view` | 50 a page (R17) |

Point view:

```json
{
  "leaf_name": "OilTemperature",
  "path": "North/EastgateSS/Feeder12/Transformer05/OilTemperature",
  "relative_path": "Transformer05/OilTemperature",
  "device": { "uuid": "…", "name": "TX05 monitor" },
  "parameter": { "uuid": "…", "key": "oil_temp", "unit": "°C" },
  "via": "placement",
  "state": "placed",
  "latest": { "value": 61.5, "quality": "good", "observed_at": "…", "received_at": "…" }
}
```

`via`: `placement` or `parameter_placement`. `state`: `placed`, `name_clash` (**Not
placed: name clash**), `not_in_configuration`. `latest` is null when unknown, never zero
(and for structured values, which the device page shows). The response is
`{data, meta: {current_page, last_page, per_page, total}}`. The device detail gains
`parameter_placements: [{parameter_uuid, key, leaf_name, path}]`.

## Memberships and filters — PR 5

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET entities/{entity}/memberships` | `Entity.view` | as member and as group, with history |
| `POST entities/{entity}/memberships` | `Entity.manage` | `{group_uuid}`; ends a current membership in a group of the same type |
| `DELETE entities/{entity}/memberships/{group}` | `Entity.manage` | |

`GET devices` and `GET alerts` accept `entity_uuid` (coverage, FR-016) beside
`site_uuid`.

## History — PR 7

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET entities/{entity}/history?page=` | `Entity.view` | changes, placements and memberships, newest first |
| `GET entities/{entity}/branch-at?time=&page=` | `Entity.view` | devices and points in the branch at that time (R12) |

## Site compatibility (unchanged shapes)

See [site-compatibility.md](site-compatibility.md).
