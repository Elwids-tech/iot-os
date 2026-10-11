# Devices

Registering devices, connecting them over Sparkplug B, activating a configuration,
reading measurements and history, and sending confirmed commands. Profiles are in
[device profiles](device-profiles.md); vendor MQTT devices in [adapters](adapters.md).

Code: Laravel [`Domain/Devices`](../../apps/api/app/Domain/Devices), runtime
[`internal/app`](../../services/runtime/internal/app),
[`internal/devices`](../../services/runtime/internal/devices),
[`internal/sparkplug`](../../services/runtime/internal/sparkplug),
[`internal/storage`](../../services/runtime/internal/storage); portal
[`src/devices`](../../apps/portal/src/devices). In-product help:
[`resources/help/devices.md`](../../apps/api/resources/help/devices.md) and related
articles.

## Ownership

Laravel owns device records, sources, configuration drafts and immutable
snapshots, command authorization and audit, sites and retention settings. The
runtime owns Sparkplug sessions, mapping, conversions, calculations, validation,
storage in TimescaleDB, latest values and command transport. They exchange work
through outboxes over internal HTTP
([ADR-014](../adr/ADR-014-control-plane-data-plane-http-integration.md)).

One broker and **one runtime instance** are supported; a Postgres advisory lock
rejects a second runtime. That is not distributed fencing: a database restart
drops the lock, so operations must keep a single instance.

## Sources: connections, gateways, discovery

In **Connect → Connections**, create a broker connection and apply its broker
access; in **Fleet → Gateways**, register gateways (Sparkplug edge nodes) and
apply their access. Each gateway has its own page with credentials, technical
details and its devices. A connection is
one Sparkplug group with its own namespace; each gateway gets scoped credentials.
Laravel provisions them through the broker's admin API
([`BrokerProvisioner`](../../apps/api/app/Domain/Devices/Services/BrokerProvisioner.php)).
Provisioning retries reuse saved records; registration does not imply a live
connection. Credentials never appear in public APIs or profile artifacts.

When a gateway connects, its NBIRTH and DBIRTH certificates create **discovered
sources** with the announced metrics, listed under **Connect → Discovery**, where
they can be onboarded or rejected. A source's `birth_revision` changes when
metric names or types change. A source can belong to at most one non-archived
device.

An operator with server access can export a gateway's private configuration:

```sh
php artisan devices:export-gateway <gateway-uuid> --output=/tmp/gateway.json \
  --broker=ssl://<host>:8883 --ca=/path/on/gateway/ca.crt
```

The export refuses to overwrite an existing file.

## Onboarding a Sparkplug device

**Devices → Add device** (or **Connect a device** from a published profile) is the
guided path:

1. Choose **direct** (the device publishes as its own edge node and gets its own
   connection and gateway) or an **existing gateway** (set its downstream device
   ID), pick a published profile and name the device.
2. For a direct device, download the connection kit ZIP (`device-config.json`,
   `ca.crt`, `quickstart.md`) or copy the settings. Shared gateway credentials are
   never exported.
3. Start the publisher. The wizard waits for the birth and suggests mappings from
   announced metrics to profile parameters. Samples at this stage are previews.
4. Review validation and activate. The setup completes only after runtime
   acknowledgement and good-quality stored readings for every reported parameter.

**Save and exit** keeps the setup; resume it from the device's **Connectivity**
tab. Kits are private and not cacheable. Direct devices authenticate with
username and password over verified TLS; the CA in the kit verifies the broker
and is not a client certificate. Set `DEVICE_MQTT_PUBLIC_URL` to an `ssl://`
host covered by the broker certificate (`localhost` only works for a simulator
on the same machine) and `DEVICE_MQTT_CA_FILE` to the public CA path.

Without the wizard: register a device (name and organization-unique code), then
on its **Configuration** tab pick the source, profile and exact published
revision, map parameters, validate and activate.

### Configuration and activation

- The **draft** holds source, profile revision and mappings. It is versioned
  (`draft_revision`); conflicting saves return 409 and keep your edits.
- **Validate** checks the saved draft against current samples: missing metrics,
  type mismatches, constraints, unsupported calculations.
- **Activate** creates an immutable configuration snapshot (pinned profile
  revision and hash, parameter UUIDs, source, mappings) and asks the runtime to
  apply it. It becomes **applied** only on runtime acknowledgement; a failure
  keeps the previous applied snapshot.
- Publishing a profile never upgrades devices. Upgrades and rollback are explicit
  configuration operations using revisions of the same profile.
- An incompatible rebirth latches **review required** and blocks affected
  controls until a reviewed activation succeeds. Compatible alias changes refresh
  the session without touching approved mappings.
- Each inbound mapping has a `conversion_mode`: `profile` (use the parameter's
  incoming conversion), `custom` (override it) or `none`. Activation stores the
  resolved settings in the snapshot, so rollback reproduces them
  ([conversions](device-profiles.md#incoming-conversions-and-calculations)).

### Lifecycle

The Overview tab's lifecycle switch follows the last runtime-confirmed state.
Both directions need confirmation, and the button stays locked until the matching
acknowledgement arrives.

`POST devices/{device}/lifecycle` takes `operation_uuid`, `target_state`
(`active` or `inactive`) and `expected_generation`; `GET
devices/{device}/operations/{operation_uuid}` recovers a lost response. Identical
retries are idempotent; conflicting or concurrent transitions are rejected.
Reactivation reuses `last_applied_configuration_uuid` without applying draft edits.
Deactivation blocks new commands; when processed, the runtime closes ingestion and
dispatch, cancels unsent work and marks possibly-sent work uncertain. Nothing is
replayed on reactivation. Deactivated devices can be archived, which keeps
history and releases the source.

## Measurements and history

The device page has **Overview**, **Data** (measurements and history),
**Control** (controls and command log), **Configuration** and **Connectivity**.
Visible device queries poll every five seconds; pending commands every second.

The runtime decodes Sparkplug with the official Tahu protobuf (pinned in
[`contracts/sparkplug`](../../contracts/sparkplug)) and handles STATE, births and
deaths, aliases, sequence wrap and duplicates, missing births and bounded rebirth
requests ([Sparkplug reference](../reference/sparkplug.md)).

- **Quality.** Invalid readings (bad value, type change, failed conversion,
  validation or calculation input) are stored as diagnostics. They keep the last
  valid value visible and expose invalid current quality separately. Retained
  values from a restored cache are not a current session; staleness also follows
  the profile's reporting hints.
- **Values.** Scalars, booleans, strings and dates. Arbitrary Sparkplug datasets,
  templates and custom codecs are not supported. 64-bit integers outside
  JavaScript's safe range produce diagnostics.
- **Storage.** TimescaleDB keeps deduplicated history and durable latest state. A
  re-sent sample with the same source timestamp and value is stored once.
  Observation chunks are compressed after seven days.
- **Time basis.** The portal's history endpoint always asks the runtime for
  observed time with configuration revisions of the same type and unit merged, so
  a backlog uploaded after an outage appears when it was measured. The runtime's
  default, used by the integration API, is receipt time with one series per
  configuration.
- **Queries.** History defaults to 24 hours and respects retention. Numeric
  aggregation returns average, minimum, maximum and count and preserves gaps.
  Queries accept 10–1000 target points; more than 2000 resulting points returns an
  error rather than truncating.
- After a new configuration is activated, a parameter without a new value shows
  the previous configuration's value marked stale, while type and unit match.

### Counters

A monotonic counter that goes down never invalidates readings: it starts a new
segment (`counter_event: reset`) or, when `counter_config.rollover_at` is set and
the jump fits, wraps (`counter_event: rollover`). `reset_behavior: diagnose` also
adds a review diagnostic.

`GET devices/{device}/measurements/increase` returns consumption per `15m`, `1h`,
`1d`, `1w`, `1mo` or `1y`, with days and months starting in the device's reporting
time zone (site, else organization, else UTC). Increases are computed in observed
order; a delta across a unit change is not counted; `partial` marks buckets that
extend past the range. Calculations in a buffered batch use only that batch's
inputs.

## Sites, tags and attributes

**Locations → Sites** holds named sites with an IANA time zone and optional address
and coordinates. A device belongs to at most one site. The organization time zone
(Settings → General) applies to devices without a site; otherwise UTC. Daily,
monthly and shift totals use that zone so every viewer sees the same totals;
timestamps still display in the viewer's zone. Deleting a site keeps its devices.
Sites are not an access boundary.

Devices carry up to 20 tags (unique, case-insensitive) and 30 attributes (keys
start with a lowercase letter; values are text up to 255 characters, numbers or
booleans). The device list filters by site, tag and profile and sorts on the
server (`sort=name|code|last_seen|created`, `-` for descending).

## Commands and controls

A parameter is controllable when it has `reports_state` and `accepts_command` and
its mapping has an outbound command metric. Two ways to send:

- **Controls** (device Control tab and dashboard Controls panels) render a control
  from the parameter's type and `display.widget`: switch, choices, slider, number,
  text or colour. A switch or choice sends immediately; numeric and text inputs
  commit on Enter or blur; sliders on release. `POST devices/{device}/commands/send`
  prepares and confirms in one audited step.
- **Prepare and confirm** (`POST devices/{device}/commands`, then `/confirm`) shows
  the target before sending.

Rules for both:

- One outstanding request per parameter. Idempotency keys prevent duplicates.
- Confirmation rechecks permission, constraints, applied configuration and a live
  compatible session; dispatch checks session and deadline again. Offline, stale,
  incompatible or unauthorized controls cannot send, and offline commands are not
  queued.
- Confirmation starts a 30-second deadline. Only a later valid live reading in the
  same session that matches the target makes a command **observed**. A fresh
  matching value reports **already at target** without sending. Broker
  acknowledgement never completes a command.
- Uncertain sends, and commands claimed when the runtime restarts, are **never
  resent**. Laravel waits ten seconds past the deadline for the runtime's outcome
  before marking delivery uncertain.
- Audit records actor, value, configuration and outcome.

Dashboard previews and edit mode never send commands. Command permission is
separate from dashboard permission.

## Telemetry viewer

**Tools → Telemetry viewer** captures raw traffic from one gateway (optionally one
device) for 1, 5 or 10 minutes. It needs device view and manage permissions
because captures can include unassigned sources.

- **Live stream**: decoded Sparkplug metrics and original bytes per packet, with
  filters and pause.
- **Processing stages**: received values, mappings, conversion output, validation,
  derived readings and persistence result for the same sample.
- **AI troubleshoot**: sends one selected sample's decoded values and processing
  evidence (never wire bytes) to the assistant; suggestions open the configuration
  editor, and saving and activation stay manual.
- **Suspension**: a user with activation permission can stop one device's new
  packets reaching production storage during a capture. Suspended samples are not
  replayed; expiry, resume, stop or a runtime restart releases it.

Captures are runtime memory only: 32 sessions globally, 4 per organization, 200
messages per session, 64 KiB per sample, at most 10 minutes. Export JSON to keep a
snapshot. A clustered runtime would need capture routing.

## Retention

Retention resolves organization override, else the saved platform default, else
**400 days**. Platform administrators with `PlatformAdministration.manage-retention`
change it in admin (**Settings → Retention**); reductions require confirmation of
the deletion cutoff. Cleanup runs at startup and every 24 hours per organization
by receipt time, in bounded batches that work on compressed chunks, and reports
pending or failed passes in admin. Configuration, command audit and latest state
are not part of history cleanup. Increasing retention cannot restore deleted data.

## API

Organization routes are under `/api/v1/organizations/{organization}`
([`Devices/routes/api.php`](../../apps/api/app/Domain/Devices/routes/api.php)):

| Resource | Operations |
| --- | --- |
| `devices` | List (filters, `sort`), register, read, edit, archive |
| `device-onboardings`, `devices/{d}/onboarding`, `.../connection-kit` | Guided setup, provisioning, kit download |
| `devices/{d}/configuration`, `mapping-suggestions`, `validate` | Draft, suggestions, validation |
| `devices/{d}/activate`, `deactivate`, `lifecycle`, `operations/{op}` | Acknowledged configuration and lifecycle operations |
| `devices/{d}/measurements/latest`, `history`, `records`, `state-history`, `increase` | Latest values, aggregated and raw history, state timelines, counter consumption |
| `devices/{d}/commands`, `commands/send`, `commands/{c}/confirm`, `cancel` | Command log and sending |
| `sparkplug-connections`, `gateways`, `discovery-candidates` | Sources and discovery review |
| `sites`, `settings/timezone` | Sites and organization time zone |
| `telemetry-captures` | Telemetry viewer |
| `runtime-status` | Runtime and automation readiness for the portal |

Admin: `GET/PUT /api/v1/admin/settings/telemetry-retention` and
`/api/v1/admin/organizations/{organization}/settings/telemetry-retention`.

## Permissions

| Permission | Allows | Built-in roles |
| --- | --- | --- |
| `Device.view` | Read devices, measurements, sources | Admin, Moderator, Member |
| `Device.manage` | Register, edit, map, validate | Admin |
| `Device.manage-connections` | Broker connections, gateways, connection kits | Admin |
| `Device.activate` | Activate, deactivate, roll back, suspend during capture | Admin |
| `Device.command` | Send commands | Admin |

Knowing another organization's UUID never bypasses these checks.

## Failure behaviour

- **Runtime restart**: durable configuration and latest state load before
  subscribing; control needs a fresh compatible birth; claimed commands become
  uncertain without replay.
- **Broker interruption**: presence becomes unavailable and controls block; TLS
  reconnect, Host STATE and rebirth restore the session.
- **NATS interruption**: readiness fails; outboxes and durable consumers resume
  without duplicate storage or dispatch. JetStream keeps seven days within byte
  limits; exhausted capacity needs an operator ([monitoring](../ops/monitoring.md)).
- **Database interruption**: bounded timeouts surface the failure; recovery
  restores durable state and retries cleanup.
- **Provisioning failure**: fix broker reachability, then reapply connection or
  gateway access.

Simulator interoperability is tested; formal Sparkplug conformance and real
hardware behaviour are not ([simulators](../dev/simulators-and-fixtures.md)).
