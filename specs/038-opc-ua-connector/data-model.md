# Data Model: OPC UA Connector and Building Simulator

Laravel owns every record here. Names are the working names for the migrations.

## `adapter_connections` (new)

One saved link to one server.

| Field | Type | Notes |
| --- | --- | --- |
| `uuid` | uuid | Public identifier |
| `organization_id` | fk | Scope; every query filters on it |
| `protocol` | string | `opcua` (the only value now) |
| `name` | string 1–120 | Unique in the organization |
| `endpoint_url` | string | `opc.tcp://host:port[/path]`; host checked by the address guard |
| `runs_at` | string | `platform` or `agent` |
| `adapter_agent_id` | fk, null | Set when `runs_at` is `agent` |
| `security_policy` | string | `None`, `Basic256Sha256`, `Aes128_Sha256_RsaOaep`, `Aes256_Sha256_RsaPss` |
| `security_mode` | string | `None`, `Sign`, `SignAndEncrypt` |
| `unencrypted_confirmed_by` | user_id, null | Who confirmed the warning (FR-015) |
| `identity` | string | `anonymous`, `username`, `certificate` |
| `secrets` | encrypted json | Password, or user certificate and key; the platform certificate's key. Hidden from every response |
| `client_certificate` | text | The platform's certificate (downloadable), with `client_certificate_expires_at` |
| `server_certificate` | json, null | Accepted certificate: subject, SHA-256 fingerprint, validity, accepted by (`user_id`) and when |
| `pending_server_certificate` | json, null | A certificate awaiting review (first use, or changed) |
| `state` | string | `draft`, `awaiting_trust`, `connected`, `unreachable`, `stopped`, `paused` |
| `status` | json | Since when, reason, security in use, points read and bad, values last hour, clock difference, server limits, last ten problems |
| `refused_points` | json | Equipment, reading, reason, first and last seen |
| timestamps | | |

Rules:

- At most `adapters.opcua.max_connections` per organization (10).
- A second connection with the same endpoint, security and identity is refused.
- A connection used by a device adapter cannot be deleted.
- `state` moves to `stopped` with reason `server_certificate_changed` when the pinned
  fingerprint no longer matches; only accepting the pending certificate resumes it.

## `device_adapters` (changed)

| Field | Type | Notes |
| --- | --- | --- |
| `adapter_connection_id` | fk, null | Required when `source.type` is `opcua` |

`source` for `opcua` holds `{type: "opcua", rhythm_seconds}`. The point map lives in
the draft and in each revision's `definition.point_map`. `fixtures` and decoder code
are empty for this source type.

## `device_adapter_revisions` (unchanged shape)

`definition` gains `point_map` ([contract](contracts/point-map.md)) and a snapshot of
the connection's non-secret settings; `secret_snapshot` gains the connection's
secrets. `test_result` holds the review check: per equipment and reading, the value,
status and any problem.

## `adapter_tenants` (changed)

| Field | Type | Notes |
| --- | --- | --- |
| `private_ranges` | json | CIDRs the organization's connections may reach. Staff-only. Refused when a range covers loopback, link-local, metadata or platform networks |

## `adapter_agents` (new, PR 7)

| Field | Type | Notes |
| --- | --- | --- |
| `uuid`, `organization_id`, `name` | | |
| `enrolment_code_hash`, `enrolment_expires_at` | | Single use, 24 hours |
| `enrolled_at`, `revoked_at` | timestamps | |
| `version`, `last_seen_at` | | Reported by the agent |
| `buffer` | json | Readings waiting, oldest reading, dropped count |

State: `pending` → `enrolled` → `revoked`. An expired pending agent can be given a new
code.

## `adapter_hierarchy_proposals` (new, PR 8)

| Field | Type | Notes |
| --- | --- | --- |
| `uuid`, `organization_id`, `device_adapter_id` | | |
| `tag_split` | json, null | For flat servers: how a tag name splits into levels |
| `items` | json | Proposed entities (name, path name, suggested type, parent, or an existing entity's UUID) and placements (device UUID, proposed entity), each with a state: `proposed`, `edited`, `dropped`, `applied`, `refused` (with the rule) |
| `applied_by` | user_id, null | With `applied_at` |

Nothing in spec 009's tables refers to this table or to a node address (FR-062).

## Discovery (unchanged tables)

Each equipment is an adapter candidate as today. Its `source_device_id` is the
equipment's path of names; its display name is the node's display name, extended with
parent names until it is unique in the data source.

## Reading quality (runtime contract)

`good` | `uncertain` (new: value kept) | `invalid` (no value; diagnostic carries the
reason). `timestamp_source`: `source` | `server` (new) | `receipt`.

## Limits

| Limit | Default | Where |
| --- | --- | --- |
| Collected points per organization | 10,000 | `adapters.opcua.max_points`, checked at save and deploy |
| Connections per organization | 10 | `adapters.opcua.max_connections` |
| Fastest sampling | 1 s | Point map validation |
| Reporting rhythm | 5 min (1 min – 1 h) | `source.rhythm_seconds` |
| Branch scan | 20,000 nodes | Connector library |
| Browse page | 200 nodes | Connector library |
| Batch activation | 200 sources | API |
| Agent buffer | 24 h | Agent |
