# Contract: Public API additions

All routes sit under `/api/v1/organizations/{organization}`, resolve the organization
and membership first, and need `Device.manage`. Additive only. User references are
`user_id`. Secrets are write-only everywhere.

## Connections

| Method and path | Purpose |
| --- | --- |
| `GET adapter-connections` | List with state, security label, points read and bad |
| `POST adapter-connections` | Create a draft: `name`, `protocol: "opcua"`, `endpoint_url`, `runs_at`, `agent` |
| `GET adapter-connections/{connection}` | One connection with status, limits and refused points |
| `PUT adapter-connections/{connection}` | Change name, address, security, sign-in (secrets write-only) |
| `DELETE adapter-connections/{connection}` | `409` while a data source uses it |
| `POST adapter-connections/{connection}/endpoints` | Ask the server what it offers: security choices ranked, sign-in methods, the server certificate |
| `POST adapter-connections/{connection}/server-certificate/accept` | Body: the fingerprint being accepted. `409` when it is not the pending one |
| `GET adapter-connections/{connection}/client-certificate` | Download the platform's certificate (DER and PEM) |
| `POST adapter-connections/{connection}/test` | Connect and sign in once: `connected`, or one failure reason with its fix |
| `POST adapter-connections/{connection}/pause`, `/resume` | |

Failure reasons (`reason`): `unreachable`, `address_not_allowed`, `no_shared_security`,
`server_certificate_changed`, `client_certificate_untrusted`, `sign_in_refused`,
`server_busy`, `clock_difference`, `timeout`. Each response carries `message` and
`fix`.

## Browsing (read only, throttled 60 a minute per connection)

| Method and path | Purpose |
| --- | --- |
| `GET adapter-connections/{connection}/nodes?parent=&cursor=` | Children of a node, 200 a page: id, namespace URI, name, kind (folder, object, point), declared type, has children |
| `POST adapter-connections/{connection}/nodes/read` | Up to 200 points: value, data type, unit, range, state labels, status, quality, source time, storable or the reason not |
| `POST adapter-connections/{connection}/nodes/search` | Name search within a branch, stopping at 20,000 nodes with `truncated: true` |
| `POST adapter-connections/{connection}/nodes/similar` | From one equipment and its ticked points: similar equipment by declared type, matching names or a name pattern, each with the readings it lacks |

## Point maps on a data source

A device adapter's source is `{type: "opcua", connection_uuid, point_map}`
([contract](point-map.md)) in `POST`/`PUT device-adapters`, with an empty `code` and no
`fixtures`. The map is part of the draft and of each revision's content hash; each
revision also keeps the connection's settings and, encrypted, its secrets. Point map
errors are field errors under `source.point_map`, naming the reading or equipment.

| Method and path | Purpose |
| --- | --- |
| `POST adapter-connections/{connection}/point-map/suggest` | From ticked points (before any data source exists): suggested keys, names, units, data types and ranges with the reporting defaults; points the platform cannot store are listed under `refused` |
| `POST device-adapters/point-map/device-type` | A new device type with exactly the map's readings, published at once (needs DeviceProfile.create and publish) |
| `POST device-adapters/{adapter}/test` | For this source type runs the review check: per equipment and reading a value, status and problem; totals of devices, readings, points and expected rows a day; limit result |
| `POST device-adapters/{adapter}/deploy` | Unchanged; refused unless the exact revision passed its check (and, until PR 5, refused for this source type) |
| `POST device-adapters/{adapter}/candidates/activate` | Batch: up to 200 candidate UUIDs; answers `202` with an operation, then a result per source |

## Agents (PR 7)

`GET/POST adapter-agents`, `POST adapter-agents/{agent}/enrolment-code` (shown once),
`POST adapter-agents/{agent}/revoke`, `DELETE adapter-agents/{agent}` (`409` while a
connection runs on it).

## Hierarchy proposals (PR 8; `404` when the entities feature is absent)

`POST device-adapters/{adapter}/hierarchy-proposal` (optional `tag_split`),
`GET …/hierarchy-proposal`, `PUT …/hierarchy-proposal/items` (edit, drop, use
existing), `POST …/hierarchy-proposal/apply` (needs the hierarchy's manage
permission; answers per item `applied` or `refused` with the rule).

## Assistant tools (scope `onboarding`)

`opcua_browse` (children or search), `opcua_read` (up to 50 points),
`propose_point_map` (a proposal the person applies to the draft). None accepts a
certificate, reads a secret, deploys or activates.
