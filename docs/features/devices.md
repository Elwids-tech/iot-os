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

Firmware for a gateway comes from its **Firmware** dialog, on the gateway's page and in
the gateway list's row menu; it replaced **Get credentials**. The dialog picks the
gateway's node profile, up to 8 device types (`IOTOS_MAX_DEVICE_TYPES`) and a target:

- **Preselected**: the choices saved on the gateway (`firmware_selection`, the same for
  everyone who opens it). With nothing saved, the node is the organization's published
  `gateway-health` profile, otherwise the SDK's default health metrics, and the device
  types are the profiles of the devices already behind the gateway.
- **Download starter**: a credential-free [firmware starter](embedded-sdk.md#firmware-starters),
  for anyone who may view profiles.
- **Download settings** (`POST gateways/{gateway}/connection-settings`) and **Download
  full kit** (`POST gateways/{gateway}/firmware-kit`): only with
  `Device.manage-connections`. A starter or kit downloaded by such a person saves the
  choices on the gateway.

The dialog confirms downloads in place rather than in a toast. The portal shows no server
commands; an operator with server access can still export a gateway's private
configuration:

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
   ID, or choose [**The gateway itself**](#the-gateway-itself)), pick a published
   profile and name the device.
2. For a direct device, download the connection kit ZIP (`device-config.json`,
   `ca.crt`, `quickstart.md`) or copy the settings. **I’m writing the firmware**
   reveals a target picker, **Download starter** (a credential-free starter for the
   device's profile, for anyone at this step) and **Download firmware kit** (the starter
   with this device's settings, with `Device.manage-connections`). A device behind a
   gateway gets no kit: the gateway already holds the connection, and its credentials
   leave the platform only in the gateway's own firmware settings.
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

For firmware written against the SDK, a direct device's **Device actions** menu has a
**Firmware** group for people with `Device.manage-connections`: **Download settings**
(the `config/` files to unpack into a [starter](embedded-sdk.md#firmware-starters), plus
the three kit files) and **Download firmware kit** (a starter for the device's profile
and a chosen target, with the settings in place). Both provision first when needed, are
private and not cacheable, and are recorded as `device.connection-settings.downloaded`
and `device.firmware-kit.downloaded`.

Without the wizard: register a device (name and organization-unique code), then
on its **Configuration** tab pick the source, profile and exact published
revision, map parameters, validate and activate.

### The gateway itself

A gateway's own metrics, from its NBIRTH and NDATA, are a discovered source with no
device ID ([spec 026](../../specs/026-embedded-gateway-sdk/spec.md), User Story 6). They
are onboarded as a device like any other source: from Discovery, or in the wizard by
choosing an existing gateway and **The gateway itself** instead of a device ID.
`POST device-onboardings` then carries `"source": "node"` in place of
`source_device_id` (exactly one of the two in gateway mode) and stores the setup with
`source_device_id = ''`. The usual rule applies: one setup per gateway and source, so
a gateway's own metrics are onboarded once. Step 2 lists the gateway's identifiers and
the metrics its node birth must carry instead of a connection kit.

The wizard suggests the organization's **gateway health profile** (code
`gateway-health`, category `gateways`), or offers **Create gateway health profile** to
people with `DeviceProfile.create` and `DeviceProfile.publish`.
`POST device-profiles/gateway-health` creates and publishes it once per organization
from the SDK's [health metrics](embedded-sdk.md#gateway-health) (`uptime` and
`reconnects` as counters that start a new segment on a reboot, `connection_type` as an
enum of `ethernet`, `wifi`, `cellular` and `other`, and every metric stale after 180 s,
three health intervals) and records `device_profile.gateway_health.created`. It returns
201 when it created the profile and 200 with the existing one, edited or not, otherwise.

### Bulk onboarding

Many sources of one type behind one gateway are onboarded in one action
([spec 026](../../specs/026-embedded-gateway-sdk/spec.md), User Story 5). People
choose the sources; nothing is onboarded automatically.

1. In **Connect → Discovery**, filter by the gateway. With `Device.manage` and
   `Device.activate`, rows can be selected. **Select all N matching** loads every
   source matching the filter and search, so the selection spans pages. Sources
   that already have a device, are being set up, are ignored, come through an
   adapter, or are the gateway's own source cannot be selected.
2. **Onboard selected** opens a dialog: a published profile, a name pattern
   (`{device_id}` is required; `{gateway}` and `{n}`, the source's place in the
   sorted selection, are optional) with a preview, and a match summary that flags
   sources whose birth lacks a metric the profile needs. A run takes at most 500
   sources; split larger selections.
3. The run panel on the Discovery page polls the run. Each source becomes a device
   with a generated name, the code `<edge node id>-<device id>` (lowercased, with a
   numeric suffix on a clash), the profile's suggested mappings and an activation
   request. Items read **active** only once the runtime acknowledges their device.
   **Retry failed** re-queues the failed items; skipped sources do not match the
   profile and need their own setup.

Mappings come from the profile's direct Sparkplug bindings when the birth has
their metric, else from the birth metric named like the parameter's key or label
([`MappingSuggestions`](../../apps/api/app/Domain/Devices/Services/MappingSuggestions.php)).
A source missing a metric, or announcing a type the parameter cannot take, is
skipped with the reason (`missing metric flow_rate`, `datatype String for number
parameter level`) and the rest continue. An item whose source already has a device
is skipped as `already onboarded`, so repeating a run never creates a second device.

The run (`device_bulk_onboardings`, one `device_bulk_onboarding_items` row per
source) is keyed by the client's `operation_uuid` and a hash of the request: the
same request returns the same run, a different one is 409. The
[`OnboardDiscoveredSources`](../../apps/api/app/Domain/Devices/Jobs/OnboardDiscoveredSources.php)
job works through it on the `default` database queue, 50 items per job, claiming
each item under a row lock. Each item does what a single setup does, in one
transaction: a gateway-mode setup (`device.onboarding.started` with
`bulk_run_uuid`), a draft, the compile checks and the activation request. The run
then rolls up to `succeeded`, `partial_failure` or `failed`, and the activity log
records `device.bulk_onboarding.started`, `.retried` and `.finished`. An activation
against a live birth asks for no rebirth, and one whose gateway is still announcing
its device waits for that birth. The others share the runtime's per-gateway rebirth
throttle (one request per 30 s), so a run causes a few rebirths at most, not one per
device.

### Configuration and activation

- The **draft** holds source, profile revision and mappings. It is versioned
  (`draft_revision`); conflicting saves return 409 and keep your edits.
- **Validate** checks the saved draft against current samples: missing metrics,
  type mismatches, constraints, unsupported calculations.
- **Activate** creates an immutable configuration snapshot (pinned profile
  revision and hash, parameter UUIDs, source, mappings) and asks the runtime to
  apply it. It becomes **applied** only on runtime acknowledgement.
- The runtime checks the configuration against the source's live birth, and the
  source's current values become the first readings. A device that announces its own
  births must be online. When its gateway is online but has not announced it yet,
  as a gateway that paces its births does for up to half a minute after a rebirth,
  the activation waits up to 90 s for the device's birth. A source fed by a
  [device adapter](adapters.md) is announced by the platform's adapter, so when it
  has not announced itself since the adapter restarted, the runtime checks the
  source's last stored birth instead. The configuration then applies with presence
  unknown until the device reports, which can be a day for a polled tracker
  ([ADR-027](../adr/ADR-027-adapter-fed-activation-and-applied-generation.md)).
- A refused activation keeps the previous applied snapshot and its **applied
  generation**. `deployment_generation` counts requests, and `applied_generation`
  is the request that applied the current snapshot. Automations bind to the applied
  one, so a refusal leaves them running
  ([automation](automation.md#when-a-binding-no-longer-holds)).
- Publishing a profile never upgrades devices. Upgrades and rollback are explicit
  configuration operations using revisions of the same profile.
- A birth that no longer matches the applied configuration (a mapped metric is
  missing or its datatype changed) sets **review required**: commands are refused
  and automations bound to the device stop with `device_review_required`
  ([automation](automation.md#when-a-binding-no-longer-holds)). Review follows the
  source's current birth: the next birth that matches the configuration again
  clears it, as does a new activation
  ([ADR-025](../adr/ADR-025-review-follows-current-birth.md)). Compatible alias
  changes refresh the session without touching approved mappings.
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
  Observation chunks are compressed after two days.
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
server (`sort=name|code|last_seen|created`, `-` for descending). Clicking a device
code copies it in full, and the button beside a name copies the name. **Quick edit**
in a row's ⋯ menu changes the name, description and tags without leaving the list.

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
| `device-onboardings`, `devices/{d}/onboarding`, `.../connection-kit` | Guided setup (including a gateway's own source), provisioning, kit download |
| `devices/{d}/connection-settings`, `devices/{d}/firmware-kit`, `gateways/{g}/connection-settings`, `gateways/{g}/firmware-kit` | Firmware settings and full kits (spec 027) |
| `devices/{d}/configuration`, `mapping-suggestions`, `validate` | Draft, suggestions, validation |
| `devices/{d}/activate`, `deactivate`, `lifecycle`, `operations/{op}` | Acknowledged configuration and lifecycle operations |
| `devices/{d}/measurements/latest`, `history`, `records`, `state-history`, `increase` | Latest values, aggregated and raw history, state timelines, counter consumption |
| `devices/{d}/commands`, `commands/send`, `commands/{c}/confirm`, `cancel` | Command log and sending |
| `sparkplug-connections`, `gateways`, `discovery-candidates` | Sources and discovery review |
| `gateways/{g}/bulk-onboardings`, `bulk-onboardings/{run}`, `.../retry` | Bulk onboarding runs |
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
| `Device.manage-connections` | Broker connections, gateways, connection kits, firmware settings and kits | Admin |
| `Device.activate` | Activate, deactivate, roll back, suspend during capture; bulk onboarding also needs `Device.manage` | Admin |
| `Device.command` | Send commands | Admin |

Knowing another organization's UUID never bypasses these checks.

## Failure behaviour

- **Runtime restart**: durable configuration and latest state load before
  subscribing; control needs a fresh compatible birth; claimed commands become
  uncertain without replay.
- **Broker interruption**: presence becomes unavailable and controls block; TLS
  reconnect, Host STATE and rebirth restore the session.
- **Edge node out of step** (sequence gap, unknown alias or metric, datatype
  change, data before a birth): only that edge node and its devices, or only the
  one device that sent data before its DBIRTH, become unknown until a rebirth.
  Other gateways and devices on the same broker connection keep their presence.
- **NATS interruption**: readiness fails; outboxes and durable consumers resume
  without duplicate storage or dispatch. JetStream keeps seven days within byte
  limits; exhausted capacity needs an operator ([monitoring](../ops/monitoring.md)).
- **Database interruption**: bounded timeouts surface the failure; recovery
  restores durable state and retries cleanup.
- **Provisioning failure**: fix broker reachability, then reapply connection or
  gateway access.

Simulator interoperability is tested; formal Sparkplug conformance and real
hardware behaviour are not ([simulators](../dev/simulators-and-fixtures.md)).
