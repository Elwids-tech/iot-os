# Devices v1

Implemented and verified locally on 2026-09-06. Devices now supports registration, Sparkplug discovery, reviewed configuration activation, measurements, history, and confirmed state-setting commands. Platform administration manages measurement retention. See the [accepted delivery plan](../plan/tasks/devices-v1.md).

## Ownership and scope

Laravel owns organization authorization, device records, immutable configuration, command confirmation, settings, and audits. Go owns Sparkplug sessions, measurements, calculations, Timescale storage, and transport execution. JetStream carries durable control, runtime events, and telemetry with database outbox/inbox handling.

The supported deployment is one managed **EMQX** broker and **one active runtime**. Edge Nodes are gateway/source records and may supply their own logical device as well as downstream devices. Protocol identifiers are source addresses, not a business hierarchy. The older [Sparkplug proposal](../plan/tasks/sparkplug-first-device-domain.md) is superseded where it describes NanoMQ or a different publishing workflow.

AI chat, sites/assets/UNS hierarchy, active alarms, reset/calibration and other one-off actions, multiple runtime replicas, real hardware verification, and production deployment remain outside this release.

## Repeatable local acceptance

Prerequisites: installed workspace PHP/Composer and pnpm dependencies, Docker, Go 1.27, Python 3, OpenSSL, and Playwright Chromium. Install Chromium once with `pnpm --filter @iot-os/portal exec playwright install chromium` if needed.

From the repository root:

```bash
./taskw devices:test
```

This creates a disposable database and Docker project, provisions TLS and namespace ACLs, starts both simulators and the runtime, and runs contract, storage, API, browser, and interruption checks. It does not migrate, seed, or reset the normal development database. Its containers/volumes are removed on completion; logs and screenshots remain in the printed temporary directory.

For an interactive review:

```bash
./taskw devices:serve
```

| Surface        | Isolated address      |
| -------------- | --------------------- |
| Tenant portal  | http://127.0.0.1:4176 |
| Administration | http://127.0.0.1:4177 |
| API            | http://127.0.0.1:8016 |
| MQTT over TLS  | ssl://localhost:18885 |

The harness also reserves ports 55435, 18086, 14225, and 8086 and refuses occupied ports. Direct runtime and NATS access is loopback-only for testing; the normal Docker overlay publishes neither service.

Use `shared.operator@example.test` / `password` for Acme and `super-admin@example.test` / `password` for administration in this disposable environment. These are test accounts, not existing-deployment credentials. Both simulator profiles and discovered sources are prepared automatically; a person must still register, map, review, and activate each device.

Stop the serving harness with Ctrl-C in its terminal, or SIGTERM to the PID in its private `harness.pid`, and wait for cleanup before reusing ports. Environment/process JSON files contain credentials: do not publish them with screenshots or test reports.

## Opt in on the existing development stack

The default Compose setup is preserved. Devices adds an explicit overlay to its existing EMQX service:

```bash
./taskw devices:setup
./taskw devices:config
./taskw devices:up
```

Setup creates ignored private configuration in `.local/devices/`, preserving generated secrets on repeat runs. Local certificates last 365 days. The broker mounts the public CA certificate, server certificate/key, and API-key file, but not the CA private key. The overlay enables password-authenticated MQTT over TLS, disables plaintext/WebSocket listeners, confines broker management to loopback, removes published NATS ports, and places the runtime on private networks. Listener changes occur only when this overlay is selected.

API startup runs migrations. Upgrade existing account permissions using the additive Devices seeder; do not use the demo account seeder as an upgrade:

```bash
devices_compose() {
  docker compose --env-file .env --env-file .local/devices/devices.env \
    -f deploy/compose/compose.dev.yml \
    -f deploy/compose/compose.app.yml \
    -f deploy/compose/compose.devices.yml "$@"
}
devices_compose exec -T api php artisan db:seed --class=DevicePermissionSeeder --force
```

This adds missing permissions/default grants without resetting accounts, memberships, custom roles, or other grants. Follow the separate [Profile Studio upgrade instructions](device-profile-studio.md#starting-and-upgrading) if its permissions are not installed. Only initialize demo accounts on a new, empty development database.

For native processes, configure the `DEVICE_*` settings in `apps/api/.env.example`; API/runtime must share `DEVICE_RUNTIME_TOKEN`. Runtime also needs `DEVICE_CONTROL_URL`, `DEVICE_DATABASE_URL`, `DEVICE_MQTT_CA_FILE`, and `NATS_URL`. Browsers communicate only with Laravel. Internal HTTP/messaging endpoints belong on trusted private interfaces.

### Gateway access and simulators

In **Gateways**, create a connection, apply its broker access, then register an Edge Node and apply gateway access. Connections receive non-overlapping organization namespaces; gateways receive scoped credentials. Provisioning retries reuse saved records. Registration/provisioning do not imply a live connection.

Credentials are excluded from public APIs and profile artifacts. An operator with server access can export a gateway's private configuration to a new file:

```bash
devices_compose exec -T api php artisan devices:export-gateway GATEWAY_UUID \
  --output=/tmp/gateway.json --broker=ssl://localhost:8883 \
  --ca=/absolute/path/on/gateway/ca.crt
devices_compose cp api:/tmp/gateway.json .local/devices/gateway.json
```

Use the hostname, port, and CA path reachable by the gateway. Export refuses an existing output file. Install its private configuration and the public CA certificate using the operator's normal gateway installation process.

To run the examples on a demo-seeded development stack instead of the disposable harness:

```bash
devices_compose exec -T api php artisan devices:prepare-simulator \
  --organization=acme-manufacturing --output=/tmp/devices-simulator.json \
  --broker=ssl://localhost:8883 --ca="$PWD/.local/devices/certs/ca.crt"
devices_compose cp api:/tmp/devices-simulator.json .local/devices/simulator.json
python3 -m venv .local/devices/python
.local/devices/python/bin/pip install -r tooling/simulators/requirements.txt
.local/devices/python/bin/python tooling/simulators/sparkplug_simulator.py \
  --config .local/devices/simulator.json --state-file .local/devices/simulator-state
```

Preparation is restricted to local/testing environments and adds examples without replacing existing profiles/accounts. The meter emits calculation inputs; the light reports periodically and after commands. A state file makes repeat runs reproducible. Adjust port 8883 if customized.

## Onboarding and configuration

1. Register a device with a name and organization-unique code, or onboard a discovered source. Serial number and description are optional.
2. Select its source, profile, and exact published revision. An empty downstream identifier represents the Edge Node's own measurements.
3. Map parameters by metric name. Matching names or direct transport-binding locators can supply suggestions copied into the device draft. Codecs/transforms are not silently translated.
4. Validate the saved draft against current samples and resolve missing metrics, incompatible types, constraints, and unsupported calculations.
5. Review and activate. An immutable snapshot becomes applied only after runtime acknowledgement.

Snapshots pin artifact UUID/hash, parameter UUIDs, source selection, and inbound/outbound mappings. Drafts use optimistic revisions. Publishing a profile does not activate or upgrade devices. Explicit upgrades and rollback use artifacts/previous configurations of the same profile; historical publications remain usable.

Lifecycle, connection presence, requested/applied configuration, and quality are independent. Failed upgrades retain the previous applied snapshot. Incompatible rebirth latches review-required status and blocks affected controls until reviewed activation succeeds. Compatible alias changes refresh the session without rewriting approved mappings.

Deactivation requires runtime acknowledgement before an applied device can be archived. Archiving preserves configuration/command history and releases source reservation. A source can belong to at most one non-archived device.

## Measurements and history

Details provide **Overview**, **Measurements**, **History**, **Configuration**, and **Commands**. Visible device queries poll every five seconds; pending commands poll every second. Forms preserve unsaved edits across polling, failed requests, session recovery, and explicit conflict resolution.

Runtime uses the official [Tahu protobuf](../contracts/sparkplug/sparkplug_b.proto), pinned by commit/checksum/generator versions in [upstream.json](../contracts/sparkplug/upstream.json). It handles Host STATE, birth/death, aliases, sequence wraparound/duplicates, missing birth, and bounded rebirth. Requests suppressed by the 30-second rebirth limit remain queued for retry.

The restricted PHP/Go expression evaluators share [18 parity cases](../contracts/devices/v1/expressions.fixture.json). Invalid readings produce diagnostics, preserve the last valid value, and expose invalid current quality separately. Restored cache is not a current session; staleness also follows published reporting hints.

Supported values include scalar numbers, booleans, strings, and supported date values. Arbitrary Sparkplug datasets/templates and custom codecs are not implemented. Non-finite numbers, malformed value fields, and 64-bit integers outside JavaScript's exact integer range produce diagnostics.

Timescale stores deduplicated history and durable latest state. History uses trusted receipt time, defaults to 24 hours, and respects retention. Numeric aggregation returns average/minimum/maximum/count, preserves gaps, and separates configuration/unit changes. Nonnumeric readings remain individual timestamped rows. Queries accept 10–1000 target points; a hard 2000-point response bound, including gaps, returns a shorter-range error instead of silently truncating.

## Confirmed commands

Controls require a writable state parameter and compatible outbound mapping. Prepare a value, inspect the target, and explicitly confirm. Preparation/confirmation recheck permission, constraints, applied configuration, and live compatible session; dispatch checks session and deadline again.

One request may be outstanding per parameter. Idempotency keys prevent duplicate preparation. Confirmation starts a 30-second deadline. Audits include actor, confirmation, value, configuration, and outcome: prepared/pending, sent, observed target, already at target, failure, timeout, cancellation, or uncertain delivery.

Only a subsequent valid live observation in the confirmed session matching the target completes a dispatched command. Cached/historical readings and broker acknowledgement cannot complete it. A fresh matching value reports **Already at target** without dispatch. Uncertain sends and claimed commands after restart are never automatically resent. Inspect state and prepare a new request explicitly if appropriate. Laravel allows ten seconds after the execution deadline for the runtime's durable outcome before falling back to uncertain delivery when that result is unavailable.

## Retention and cleanup

Retention resolves **organization override → saved platform default → 90 days**. Platform administrators with the dedicated permission can save positive whole days up to 36500 or clear a setting to inherit. The UI shows effective days/source, protects edits, handles revision conflicts, and requires reduction confirmation with the deletion cutoff. Settings/audits survive restarts. Increasing retention cannot restore deleted measurements.

Cleanup runs after startup and every 24 hours using each organization's receipt-time cutoff. Each organization pass is limited to 30 seconds and 50 batches of 10000 rows per history/diagnostics table. It never drops shared Timescale chunks. Backlog reports **pending**; errors report **failed**. Both retry after one minute. One organization's failure does not prevent the others from being processed. Administration exposes latest outcomes and unresolved failures. Configuration, command audits, and durable latest state are outside history cleanup.

## APIs and permissions

Organization routes use `/api/v1/organizations/{organizationUuid}`, UUID resources, validated pagination/search, and capability-driven operations.

| Resource                                              | Operations                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `devices`                                             | List/register, read/edit, archive                                  |
| `devices/{device}/configuration`                      | Save separate configuration draft                                  |
| `devices/{device}/mapping-suggestions`                | Compatible direct binding defaults filtered to the pinned artifact |
| `devices/{device}/validate`, `activate`, `deactivate` | Sample validation and acknowledged deployment, including rollback  |
| `devices/{device}/measurements/latest`, `history`     | Authorized latest and bounded historical queries                   |
| `devices/{device}/commands`                           | List/status/prepare; command confirmation and cancellation         |
| `sparkplug-connections`                               | List/register, apply broker access                                 |
| `gateways`                                            | List/register, retry gateway access                                |
| `discovery-candidates`                                | List/read and approve/reject a specific birth revision             |

Administration retention GET/PUT routes are `/api/v1/admin/settings/telemetry-retention` and `/api/v1/admin/organizations/{organizationUuid}/settings/telemetry-retention`. The shared [TypeScript resources](../packages/api-client/src/devices.ts) expose statuses, diagnostics, mappings, revision information, and effective retention.

Viewing, management, connection management, activation, and commands have separate organization grants. Built-in organization administrators get all five; moderators/members get viewing. Retention has a dedicated platform permission. Knowing another organization's UUID never bypasses access checks.

## Recovery and limits

- **Runtime restart:** durable configuration/latest state loads before subscription; control requires fresh compatible birth. Claimed commands become uncertain without replay. Activations/events reconcile durably.
- **Broker interruption:** source presence becomes unavailable and controls block. TLS reconnect, Host presence, and rebirth restore a current session.
- **Messaging interruption:** readiness exposes failure; outbox/inbox and durable consumers resume without duplicate observation storage or dispatch.
- **Database interruption:** bounded connection/query timeouts expose failure. Recovery restores durable state and retries recorded cleanup failures.
- **Provisioning failure:** repair broker reachability/management settings, then reapply connection or gateway access.
- **Single instance:** a startup advisory lock rejects a second runtime. This is not distributed fencing/HA; database restart loses that lock. Operations must maintain one runtime instance.

JetStream streams have size limits and seven-day retention. Exhausted capacity/backlog requires operator attention; arbitrarily long outages are not guaranteed lossless for MQTT telemetry. This is tested simulator interoperability, not formal Sparkplug conformance certification. Production backup/restore, load/sizing, certificate rotation, hardware behavior, HA, and production deployment need separate verification.

## Verification on 2026-09-06

Each isolated stage passes before dependent checks run.

| Check                                      | Result                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Laravel regression                         | 76 tests, 723 assertions passed, including existing profile/admin behavior                                                                                                                                      |
| Profile authoring units                    | 8 tests passed                                                                                                                                                                                                  |
| Existing Profile Studio browser regression | 8 Chromium tests passed                                                                                                                                                                                         |
| Go protocol/expression/storage             | Race-enabled suite passed against disposable Timescale; Go vet passed                                                                                                                                           |
| Executable contracts                       | Four schema fixtures, profile hash, 30-second deadline, and protobuf checksum passed                                                                                                                            |
| Devices API                                | Seven integration checkpoints passed                                                                                                                                                                            |
| Devices browser                            | Discovery/registration/mapping/activation, charts, commands, session recovery, desktop/mobile, light/dark, keyboard/automated accessibility checks passed                                                       |
| Retention                                  | Defaults/overrides/reduction/inheritance browser flow; tenant-isolated cleanup/backlog and recovery tests passed                                                                                                |
| Interruptions                              | Nine checkpoints passed: TLS/ACL/auth boundaries, publication isolation, upgrade/rollback, timeout, uncertain dispatch without replay, broker/JetStream/database recovery, and post-recovery command completion |
| Frontend/client                            | Portal/admin/client typechecks and production builds passed                                                                                                                                                     |
| Compose overlay                            | Merged configuration validated without starting/changing the normal development stack                                                                                                                           |

Devices evidence: `/var/folders/p5/q0rpbzqs0mbbthcm37pq1p2m0000gn/T/iot-devices-v1-1FNzbF`. Studio evidence: `/var/folders/p5/q0rpbzqs0mbbthcm37pq1p2m0000gn/T/iot-studio-e2e-Wxka2w`. Temporary evidence may later be removed by the OS. Screenshots were inspected; the mobile device tab row was corrected and rechecked.

The initial runtime Docker image build hit a registry timeout. On 2026-09-07, the same image built successfully and the Devices overlay started on the existing local stack for the [D1 simulator](d1-simulator.md). Compose validation, native-runtime acceptance, and the subsequent container startup passed. The portal build reports its existing main-chunk size warning; history charts are loaded separately. No production or hardware result is implied.


## Confirmed device lifecycle

The Overview lifecycle action follows the last runtime-confirmed state. Both directions require confirmation. A `202` accepts an operation; it does not establish activation or deactivation. The button stays disabled until its matching acknowledgement arrives. Pending operations refresh every second while visible, stable devices every five seconds, and focus/reconnect triggers reconciliation. A lost response is recovered using the client operation UUID. After 60 seconds, “Confirmation delayed” keeps the action locked; a request not found by the API can be retried using the same UUID.

`POST /api/v1/organizations/{organization}/devices/{device}/lifecycle` takes `operation_uuid`, `target_state` (`active` or `inactive`), and `expected_generation`. It returns the operation and current device detail. `GET .../operations/{operation_uuid}` recovers its status. Identical requests are idempotent; conflicting or concurrent transitions are rejected. Activation permission is required; operation reads require device viewing permission.

Reactivation uses `last_applied_configuration_uuid`, the last confirmed immutable snapshot, without applying draft edits or creating a revision. Pure lifecycle transitions do not change the draft revision or discard unsaved forms. An offline or incompatible source rejects activation with a diagnostic while preserving the retained snapshot and confirmed inactive state. New configuration application and rollback remain separately reviewed configuration operations.

Deactivation acceptance blocks new command preparation/confirmation. When processed, the runtime closes ingestion and dispatch gates, cancels unsent work, and marks potentially sent work uncertain. It retains gateway discovery, history, and audit records. Latest readings are labelled inactive; after reactivation or runtime restart, retained readings stay stale until fresh telemetry arrives. No outstanding command is replayed on reactivation.

Every device has a durable generation and at most one unresolved operation. Runtime processing, dispatch, and acknowledgement publication share a per-device fence. State and replayable outcomes commit before in-memory cache updates; the publisher cannot emit success until those updates finish. Startup restores durable generations and inactive markers before accepting work or publishing outcomes. Older API snapshots cannot reinstall an inactive device; telemetry and command work from older generations are discarded. Legacy acknowledgements remain correlated by generation and configuration during migration.

The additive migration backfills the retained snapshot from the applied reference or successful acknowledgement plus matching activation-generation evidence. It never assumes the newest configuration worked. Missing historical evidence requires configuration review. Existing pending transitions receive operation records.

The isolated browser suite includes confirmation cancellation, both toggles without page reload, unsaved edits, lost responses, temporary status failures, retained snapshot reuse after draft changes, delayed confirmation and idempotent retry, plus desktop/light and mobile/dark accessibility checks. Runtime tests cover generation fencing, inactive restart recovery, queued command cancellation, and stale recovery snapshots. Production and real-hardware verification remain separate.

Local lifecycle verification on 2026-09-07: all 81 PHP tests (827 assertions), workspace typechecks, the Go race suite, and the isolated Devices integration/browser/interruption suite passed. After the final API adjustment, the 17 Devices API tests passed (253 assertions). API, runtime, portal, and administration containers were rebuilt and recreated. The D1 simulator then passed deactivate → confirmed inactive → runtime restart → activate without reloading the verification page: source connectivity stayed online, the stored measurement count did not increase while inactive (including after restart), configuration revision 8 and the saved draft were retained, unsaved form text survived, and fresh measurements resumed. D1 was left active.
