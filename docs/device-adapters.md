# Manufacturer MQTT device adapters

The tenant portal owns authoring and review. Users and AI write a synchronous `decode(input, helpers)` function; platform nodes manage MQTT, Sparkplug B lifecycle and enrollment. Each tenant gets a separate Mosquitto ingress broker and Node-RED runtime. The native editor and Admin API have no public ports. The private runtime manager is the only component with Docker socket access.

## User flow

1. Open **Device adapters** or **Manufacturer MQTT device** from Devices.
2. Select a published profile and name the reusable device-type adapter.
3. Choose the tenant MQTT broker or supply the vendor broker's URL, credentials, CA and topic filters. Broker URLs never contain passwords. Vendor brokers must be internet-reachable in normal operation.
4. Write the JavaScript decoder or attach manufacturer documentation to its AI assistant. Review AI evidence and apply proposals to a draft; AI cannot deploy.
5. Save representative fixtures, including expected metric values and malformed samples. Test the exact revision and review the output values and units.
6. Deploy it. Applied status changes after the private runtime acknowledges the revision. Broker and publisher connectivity are reported separately.
7. For configurable devices, create a hardware credential and download its ZIP containing `device-config.json`, `ca.crt` and `quickstart.md`. Install those connection settings on the device without changing its payload. The CA verifies the broker, and is not a client certificate.
8. Review a live discovered serial, create or link an inactive virtual device, and activate it. Follow the device link to verify applied configuration and stored good-quality readings.

Unknown or retained payloads remain previews. Physical payloads cannot choose platform tenant IDs or arbitrary virtual IDs. Identity inside a tenant depends on its authorized publishers and reviewed manufacturer serials; MQTT subscribers do not receive the original publisher's username. Hardware replacement, installation end dates, counter offsets and consumption continuity are phase two.

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

`input` provides parsed `payload` or null, `bytes`, `payloadBase64`, `topic`, `receivedAt`, `retained` and `qos`. Optional output fields are `observedAt` (ISO timestamp) and `messageId` (bounded deduplication identifier). Output units match the pinned profile, so native ingress mappings use `conversion_mode: none`.

Each message uses a fresh QuickJS context with a 100 ms execution budget, 16 MiB script-memory limit and 500 ms disposable-worker deadline. The raw input limit is 1 MiB. Built-ins and `uint16BE`/`uint32BE` helpers are available. Host APIs, filesystem, networking, secrets, modules, async calls and persistent decoder state are unavailable. Numeric, safe-integer, boolean and string output metrics are supported in v1. Invalid messages produce diagnostics; partial messages preserve the accumulated birth schema.

## Local setup

Keep private values in an ignored `.local/adapter-*/` directory. Generate a manager token of at least 32 random bytes; never place it in source. Set these private Compose inputs:

- `IOT_ADAPTER_MANAGER_TOKEN`: generated manager bearer token.
- `IOT_ADAPTER_HOST_STATE_DIR`: absolute private host directory. The manager sees it at `/state`; Docker mounts the corresponding host paths into tenant containers.
- `IOT_ADAPTER_DOCKER_NETWORK`: the existing stack's internal Docker network name.
- `IOT_ADAPTER_PUBLIC_HOST` and `IOT_ADAPTER_BIND_ADDRESS`: localhost/127.0.0.1 for local simulators; reachable TLS hostname and an appropriate interface for real hardware.
- `IOT_ADAPTER_PROJECT`: Compose project identity, used to scope manager-owned containers.

Add `deploy/compose/compose.adapters.yml` after the existing app/devices overlays and include the private adapter environment file. Preserve all current volumes, broker credentials, native simulators and runtime streams. Build `adapter-runtime-image` before starting `adapter-manager` and `adapter-worker`; rebuild API, assistant worker, portal and admin for the new feature. Run database migrations through the usual application workflow. The adapter queue uses the database connection even when other development queues are synchronous.

For a disposable protocol check, install Node-RED 4.1.13 into ignored `.local/adapter-tests`, ensure Mosquitto and its password utility are on PATH, and run `npm run test:integration` from `services/adapters`. Set `MOSQUITTO_BIN` on systems where the executable differs from the macOS default. This launches temporary TLS brokers and Node-RED processes, checks both MQTT paths and tenant isolation, then passes actual captured packets through the platform Go parser. It leaves existing services and simulator state untouched.

After downloading and extracting a hardware kit, run `tooling/simulators/vendor_water_meter.py --kit /private/path/device-config.json --state-file /private/path/vendor-meter-state.json`. It publishes unchanged manufacturer JSON with a persistent total. Select an allowed concrete topic using `--topic` when your adapter uses a different filter. This simulator is separate from the native Sparkplug water meter.

## Release operations

Adapters are opt-in: `IOT_ADAPTERS_ENABLED=false` remains the default. New release manifests contain pinned manager and runtime images. `manage.py` selects `compose.adapters.yml` when enabled, requires the Mosquitto overlay and a private manager token, and keeps management services on the private network.

Tenant broker data, encrypted Node-RED flows, lifecycle sequence state, certificates and manager keys live under `${STATE_DIR}/device-adapters/<tenant_uuid>`. Scoped container labels prevent one Compose project from operating another project's tenants. Application backups stop the manager, adapter worker and their running tenant containers before copying state and restart only previously running containers. Restores preserve these private credentials and remain quarantined until reviewed.

Allocate and firewall the tenant MQTT port range before enabling public hardware access. Monitor tenant runtime capacity and certificate expiry; v1 certificates last one year and renewal is an operator task. Existing tenant containers retain their data and are recreated from the configured image on the next managed deployment if its digest changes. Deployment, backup and restore should be validated in a disposable environment before staging or production enablement.

## Acceptance boundary

Source/API/decoder/browser-fixture checks and the disposable live MQTT/Node-RED/Go test have passed. The existing Docker-served platform rebuild and actual stored-reading test remain pending Docker Desktop recovery. Staging and production have not been enabled or deployed by this implementation task.
