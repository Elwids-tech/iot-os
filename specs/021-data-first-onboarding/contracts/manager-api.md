# Adapter Manager API (private, changed)

Requests use the bearer `IOT_ADAPTER_MANAGER_TOKEN` and JSON, and run one at a time
per tenant, as today.

## `POST /capture` (new)

```json
{
  "tenant": { "uuid": "…", "listen_port": 19001, "runtime_token": "…", "ingress_admin_password": "…" },
  "adapter": { "uuid": "…" },
  "source": { "type": "platform", "topics": ["sensors/+/telemetry"] },
  "secrets": {},
  "until": "2026-10-28T10:42:00Z",
  "exclude_topics": ["meters/+/telemetry"]
}
```

- **Tab**: it writes or replaces `capture-<uuid>`, a source node in `capture` mode
  plus a reporter, through the Node-RED admin API.
- **Tenant broker** (`platform`):
  - It provisions `capture-<uuid>` with subscribe-only rights. Those rights cover
    `source.topics`, or `#` when there are none, and never `iot-os/` or `$` topics.
  - Messages on `spBv1.0/` topics are reported like any other. Laravel labels them
    `sparkplug_detected` and offers the native path.
  - `exclude_topics` holds the filters of the tenant's other deployed adapters. The
    node drops matching messages.
  - A message outside `source.topics` while subscribed to `#` is reported with
    `off_filter: true`.
- **Vendor broker** (`vendor`): the source URL and credentials go into the flow's
  encrypted credentials, with client id `capture-<uuid>` and a clean session.
- **Other types**: webhook and poll sources return 422, `not_applicable`. They capture
  through the receiver's `sampling` state and through Fetch now.
- **Response**: `{capturing: true, until}`.
- **Expiry**: the node stops itself at `until`. The manager removes expired capture
  tabs whenever it writes that tenant's flows.

## `POST /capture/stop` (new)

The body is `{tenant, adapter}`. It removes the tab and the `capture-<uuid>`
identity. It is idempotent.

## `POST /deploy` (changed)

- The request removes any `capture-<uuid>` tab in the same flows write.
- `capture_until` (optional) makes the deployed source node copy raw input to its
  reporter until then. This is how Manage drafts capture.
- On the first deploy of a `platform` source, the hardware credentials provisioned
  in Setup are narrowed from their setup rights to the source's filters.

## `POST /credential` (changed)

`scope: "setup" | "filters"`.

- `setup` grants the hardware credential publish rights on `#`, at a lower priority
  than these deny entries:
  - `iot-os/#` and `$`-prefixed topics;
  - every filter in `deny_topics`, which holds the filters of the tenant's other
    deployed adapters.

  Sparkplug B topics stay allowed, so a Sparkplug device is recognised (FR-024).
- `filters` is today's behaviour.

Laravel sends `setup` with `deny_topics` while the adapter has no applied revision.

## `POST /setup-acl` (new)

The body is `{tenant, adapter, deny_topics}`. It replaces the deny entries on every
setup credential of that adapter, and is idempotent.

Laravel calls it for each never-applied adapter of the tenant whenever another
adapter in the organization deploys, pauses, is deleted or changes its filters. It
also calls `/capture` again for each active lease, so `exclude_topics` stays
current.

## `GET /broker-activity?tenant=<uuid>&usernames=a,b` (new)

```json
{ "clients": [ { "username": "device-…", "connected": false, "last_connected_at": "…", "last_disconnected_at": "…", "last_refused_at": "…", "refused_reason": "not_authorised", "address": "192.0.2.10" } ],
  "unattributed_refusals": [ { "at": "…", "address": "192.0.2.10" } ] }
```

- The manager follows each tenant broker container's log through the Docker API
  (`connection_messages true` is added to the tenant `mosquitto.conf`).
- It keeps, per username, the last 20 connection events in memory.
- After a manager restart, the history is empty until new events arrive, and the
  response says `since` (principle VI).
