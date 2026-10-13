# Device adapters

Adapters connect off-the-shelf MQTT devices that publish their manufacturer's own
JSON (or bytes) instead of Sparkplug B. A tenant writes a small JavaScript decoder;
the platform runs it in a sandbox and republishes the result as Sparkplug B, so
the rest of the pipeline is the normal [device path](devices.md). The isolation
model is [ADR-010](../adr/ADR-010-per-tenant-adapter-runtimes.md).

Code: Laravel [`Domain/DeviceAdapters`](../../apps/api/app/Domain/DeviceAdapters);
manager and runtime [`services/adapters`](../../services/adapters); portal
[`src/adapters`](../../apps/portal/src/adapters). Simulators:
[`vendor_water_meter.py`, `vendor_env_sensor.py`](../dev/simulators-and-fixtures.md#vendor-mqtt-simulators-adapter-path).

Adapters are off unless `IOT_ADAPTERS_ENABLED=true` (the adapter Compose overlay
sets it); when off, the routes return 404 and the menu item is hidden. They appear
under **Build → Device adapters** for users with `Device.manage`.

## How it fits together

![Tenant-isolated ingress brokers and Node-RED runtimes](diagrams/device-integration-01-tenant-isolation.png)

([Mermaid source](diagrams/device-integration-01-tenant-isolation.mmd))

- Each organization gets its own **Mosquitto ingress broker** (TLS, one public
  port per tenant) and **Node-RED runtime** (no public port, editor disabled),
  created by `adapter-manager`. Devices keep their fixed manufacturer topics
  without colliding with other tenants.
- A device either publishes to the tenant ingress broker using a downloaded
  connection kit, or the adapter subscribes to a reachable **vendor broker** with
  credentials the customer supplies.
- The generated flow runs the decoder, then a platform-owned **managed Sparkplug
  B publisher** that owns births, deaths, aliases, sequence and `bdSeq`, and
  publishes to the platform broker as group `adapters-<organization uuid>`,
  edge node `adapter-<adapter uuid>`.
- Laravel owns adapters, revisions, fixtures, credentials and discovery. It calls
  the manager's private API from the `device-adapters` queue
  (`adapter-worker`); the runtime reports back to `POST /api/internal/adapters/events`
  with a per-tenant token.

## User flow

![Device adapter onboarding journey](diagrams/device-integration-02-onboarding.png)

([Mermaid source](diagrams/device-integration-02-onboarding.mmd))

1. Create an adapter: pick a published profile and name the reusable device-type
   adapter.
2. Choose the source: the tenant broker, or a vendor broker URL with credentials,
   CA and topic filters (passwords never go in the URL).
3. Write the decoder, or attach the manufacturer's documentation and ask the
   adapter assistant for a draft. Assistant changes are proposals you apply to the
   draft; the assistant cannot deploy.
4. Save fixtures (valid, malformed and partial samples with expected values) and
   test the exact revision. Only a revision that passed its test can be deployed.
5. **Deploy**. Applied status changes when the tenant runtime acknowledges the
   revision. Broker and publisher connectivity are reported separately. Pause and
   rollback to a previously tested revision are available.
6. For devices that can be pointed at a broker, create a hardware credential and
   download its kit (`device-config.json`, `ca.crt`, `quickstart.md`). Credentials
   can be rotated and revoked.
7. Review a discovered serial number, create or link an inactive virtual device,
   and activate it. Unknown serials and retained messages stay previews; nothing
   is stored as production telemetry until a device is activated.

Stored observations and committed events keep `installation_uuid`,
`adapter_revision_uuid` and the manufacturer serial next to the stable device
UUID, so replacing hardware later can keep the device's history.

## Decoder contract

```js
function decode(input, helpers) {
  const p = input.payload;
  return {
    sourceDeviceId: p.serial,
    metrics: [
      { name: "flow_rate", value: p.flow_ml_min / 1000, unit: "L/min" },
      { name: "total_volume", value: p.total_ml / 1000, unit: "L" }
    ]
  };
}
```

![Water-meter payload decoding](diagrams/device-integration-03-water-meter.png)

([Mermaid source](diagrams/device-integration-03-water-meter.mmd))

- `input` has `payload` (parsed JSON or null), `bytes`, `payloadBase64`, `topic`,
  `receivedAt`, `retained` and `qos`. `helpers` provides `uint16BE` and `uint32BE`.
- Output: `sourceDeviceId` and `metrics`, plus optional `observedAt` (ISO
  timestamp) and `messageId` (bounded deduplication key). Units must match the
  pinned profile, so device mappings use `conversion_mode: none`.
- Metric values can be numbers, safe integers, booleans or strings.
- Sandbox ([`lib/decoder.cjs`](../../services/adapters/lib/decoder.cjs),
  [`lib/decoder-worker.cjs`](../../services/adapters/lib/decoder-worker.cjs)):
  QuickJS with a fresh context per message, 100 ms execution budget, 16 MiB
  memory, 500 ms worker deadline once QuickJS has loaded (5 s to start the
  worker), 1 MiB raw input, 64,000-character decoder. No host APIs, filesystem,
  network, secrets, modules, async or persistent state.
- Invalid messages produce diagnostics. Partial messages update only the metrics
  they carry. Missing values are never replaced with zero, and a decreasing
  monotonic counter needs review.

## Running locally

Adapters need the Devices stack plus [`compose.adapters.yml`](../../deploy/compose/compose.adapters.yml)
and a private env file (keep it under `.local/`) with:

| Variable | Purpose |
| --- | --- |
| `IOT_ADAPTER_MANAGER_TOKEN` | Bearer token between API and manager; at least 32 random bytes |
| `IOT_ADAPTER_HOST_STATE_DIR` | Absolute private host directory for tenant state (mounted as `/state`) |
| `IOT_ADAPTER_DOCKER_NETWORK` | Network tenant containers join (default `iot-os-dev_internal`) |
| `IOT_ADAPTER_PUBLIC_HOST`, `IOT_ADAPTER_BIND_ADDRESS` | Hostname in kits and the interface tenant brokers bind to (`localhost` / `127.0.0.1` for simulators) |
| `IOT_ADAPTER_PORT_BASE`, `IOT_ADAPTER_PORT_LIMIT` | Tenant broker port range (default 19000–19999) |

Build `adapter-runtime-image` before starting `adapter-manager` and
`adapter-worker`, and include the adapter env file every time you rebuild the API
family ([gotchas](../dev/gotchas.md#local-stack)).

Tests: `npm test --prefix services/adapters` (sandbox and flows). The integration
test (`npm run test:integration`) needs Node-RED 4.1.13 installed into
`.local/adapter-tests` and Mosquitto on `PATH` (`MOSQUITTO_BIN` to override); it
starts temporary brokers and Node-RED processes, checks both source paths and
tenant isolation, and feeds captured packets through the Go Sparkplug parser.

## Operations

In a release, adapters require the Mosquitto broker profile and pinned
`ADAPTER_MANAGER_IMAGE` and `ADAPTER_RUNTIME_IMAGE`. Tenant broker data,
encrypted flows, sequence state, certificates and keys live under
`${STATE_DIR}/device-adapters/<tenant uuid>`; backups stop the manager, worker and
tenant containers and restart only those that were running
([release](../ops/release.md)).

- Open and firewall the tenant port range before connecting real hardware.
- Tenant certificates last one year; renewal is manual.
- Tenant containers are recreated from the configured image on the next deploy if
  its digest changed.
- Known risks (Docker socket on the manager, tenant containers on the platform
  network) are in [ADR-010](../adr/ADR-010-per-tenant-adapter-runtimes.md).

## API and permissions

Under `/api/v1/organizations/{organization}/device-adapters`
([routes](../../apps/api/app/Domain/DeviceAdapters/routes.php)): list, create,
read and update adapters; `test`, `connection-test`, `deploy`; `candidates` and
`candidates/{c}/activate`; `credentials` with `kit`, `rotate` and `revoke`;
assistant `proposals` and `decision`. Reads need `Device.view`, changes need
`Device.manage`, and broker sources and hardware credentials also need
`Device.manage-connections`.

Not built yet: vendor command encoding (downlink), local-only brokers behind
customer firewalls, and the guided hardware replacement flow with counter
continuity ([roadmap](../roadmap.md#next)).
