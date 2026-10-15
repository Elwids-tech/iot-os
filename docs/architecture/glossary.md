# Glossary

Terms as the code uses them. Model paths are under
[`apps/api/app/Domain`](../../apps/api/app/Domain) unless noted; Go paths are
under [`services/runtime/internal`](../../services/runtime/internal).

## Tenancy and access

**Organization.** The tenant. Every tenant resource belongs to one. Has a time
zone (used when a site has none) and an optional **permission ceiling**
(`permissions_restricted` plus `organization_permission`): roles in the
organization can hold only permissions inside it. `Shared/Models/Organization.php`

**User.** A person's account, identified by **integer id** (there is no user
UUID, [ADR-013](../adr/ADR-013-integer-user-ids.md)). Belongs to many
organizations. `is_super_admin` bypasses authorization checks; super administrators
grant and remove it in admin.
`Shared/Models/User.php`

**Role.** An organization-scoped bundle of permissions. Built-in roles are
Organization Admin (always equals the ceiling), Moderator and Member; custom roles
can be added. `Authorization/Models/Role.php`, `Authorization/Enums/OrganizationRoleName.php`

**Platform role.** A role outside any tenant. Only `platform-administrator`
exists; it grants the `PlatformAdministration.*` permissions used by the admin
app. `Authorization/Models/PlatformRole.php`

**Permission.** Named `Resource.action`, for example `Device.view`,
`Device.command`, `DeviceProfile.publish`, `Workflow.activate`,
`Dashboard.create`, `Role.update`. Defined as enums under each domain's
`Permissions/` directory ([access](../features/access.md)).

**Invitation.** An emailed, expiring invite to join an organization with given
roles. `Administration/Models/OrganizationInvitation.php`

## Devices and sources

**Site.** A physical location with an IANA time zone, optional address and
coordinates. A device belongs to at most one site. Sites decide where daily and
monthly totals start; they are not an access boundary. `Devices/Models/Site.php`

**Broker connection** (`SparkplugConnection`, API `sparkplug-connections`). One
Sparkplug group (`group_id`, globally unique) with a Primary Host ID and host
credentials on the broker. Broker ACLs scope it to `spBv1.0/<group_id>/…`.
`Devices/Models/SparkplugConnection.php`

**Gateway** (`SparkplugGateway`, API `gateways`). One Sparkplug **Edge Node**
inside a connection, with its own scoped MQTT credentials. "Edge Node" is the
protocol term; the UI uses it only for the identifier field. A directly onboarded
device is its own edge node. `Devices/Models/SparkplugGateway.php`

**Discovered source** (`DiscoveryCandidate`). A source seen in a birth
certificate: a gateway plus a `source_device_id` (empty means the edge node's own
NBIRTH metrics, otherwise a DBIRTH device id). Carries the announced metrics and a
`birth_revision` that changes when metric names or types change. A source can be
reserved by at most one non-archived device. `Devices/Models/DiscoveryCandidate.php`

**Device.** The platform's (virtual) device record, identified by UUID and an
organization-unique `code`. It is bound to a source and a profile revision by its
configuration, so history, dashboards and automations survive changes to the
physical source.
- `lifecycle`: `registered` → `active` ⇄ `deactivated` → `archived`.
- `presence`: `unseen`, `online`, `offline`, or `unknown` (computed when the
  runtime heartbeat is older than 20 s).
- `deployment_status`: `idle`, `pending`, `applied`, `failed`, `inactive`.
- Tags (up to 20) and attributes (up to 30).
`Devices/Models/Device.php`

**Device profile.** The editable description of a device type: parameters,
groups, calculations and alarm suggestions. `status`: `draft`, `published`,
`archived`. Editing a published profile creates pending changes, never a change
to a published revision. `DeviceProfiles/Models/DeviceProfile.php`

**Profile revision** (artifact, `DeviceProfileArtifact`). An immutable, compiled
publication of a profile (`device-profile.v2`, hashed). Devices pin an exact
revision. `DeviceProfiles/Models/DeviceProfileArtifact.php`

**Parameter** (`ProfileParameter`). One data point of a profile, with a stable
UUID and a `key` that is fixed (and never reused) once published.
- `kind`: `state`, `measurement`, `counter`, `event`, `derived`.
- `data_type`: `boolean`, `integer`, `number`, `enum`, `string`, `timestamp`, `bytes`.
- `reports_state`: the device reports it, so it must be mapped.
- `accepts_command`: it is writable.
- Optional validation, staleness hint, counter settings, incoming conversion and
  display hints.
`DeviceProfiles/Models/ProfileParameter.php`

**Calculation.** A restricted arithmetic expression that produces a `derived`
parameter from other parameters, evaluated by the runtime after conversion.
`DeviceProfiles/Models/ProfileCalculation.php`

**Alarm template.** A suggestion stored with a profile. It never raises an alert
by itself. `DeviceProfiles/Models/ProfileAlarmTemplate.php`

**Transport binding.** A profile-level protocol mapping record
(`TransportBinding`, `BindingParameterMapping`). It is stored and validated but
not compiled into artifacts and not used by the runtime; mappings live in device
configurations. `DeviceProfiles/Models/TransportBinding.php`

**Mapping.** In a device configuration, the link from a source metric to a
profile parameter (inbound), and optionally from a writable parameter to an
outbound command metric. Each inbound mapping has a `conversion_mode`:
`profile`, `custom` or `none`.

**Configuration draft.** The device's editable mapping document (`devices.draft`,
versioned by `draft_revision`). Saving a draft changes nothing on the runtime.

**Configuration** (`DeviceConfiguration`). An immutable snapshot created on
activation or rollback (`device-configuration.v2`): pinned profile revision and
hash, source, birth revision and mappings.
`Devices/Models/DeviceConfiguration.php`

**Desired / applied configuration.** Pointers on the device:
`desired_configuration_uuid` is what Laravel asked for;
`applied_configuration_uuid` is set only when the runtime confirms
`device.applied.v1` for the current generation; `last_applied_configuration_uuid`
survives deactivation and is used to resume. Workflows (`desired_deployment_uuid`
/ `applied_deployment_uuid`), adapters (`desired_revision_uuid` /
`applied_revision_uuid`) and geofence assignments follow the same pattern.

**Generation.** A counter bumped by every lifecycle request
(`devices.deployment_generation`, `automation_workflows.deployment_generation`).
Outbox messages, acknowledgements, commands and telemetry carry it; a message
from an older generation is ignored on both sides.

**Operation** (`DeviceOperation`). One activation, rollback, resume or
deactivation request, keyed by a client-supplied `operation_uuid` so retries are
idempotent. A device has at most one pending operation.
`Devices/Models/DeviceOperation.php`

**Command** (`DeviceCommand`). An audited request to set one writable parameter.
Statuses: `prepared` → `pending` (confirmed, 30 s deadline) or
`already_at_target` → `sent` → `observed` | `failed` | `timed_out` | `uncertain`
| `cancelled`. Only a fresh matching reading makes it `observed`.
`Devices/Models/DeviceCommand.php`

**Onboarding** (`DeviceOnboarding`). The guided "Add device" setup: `direct`
(the device gets its own connection and gateway) or `gateway` (downstream of an
existing gateway). `Devices/Models/DeviceOnboarding.php`

**Reading quality.** Stored as `good` (an observation) or `invalid` (a
diagnostic). `stale` and `inactive` are derived when latest values are read.

**Timestamp source.** Provenance of a reading's observed time: `source`,
`receipt`, `corrected_future` (source clock more than five minutes ahead) or
`derived`. Missing means legacy, unknown provenance.

**Committed telemetry event.** `telemetry.committed.v1`, written in the same
transaction as the stored readings and relayed to `iot.committed.telemetry.v1`.
Automations evaluate it ([events](../reference/events.md)).

**Retention.** How long telemetry history is kept: organization override, else
platform default, else 400 days. `Devices/Models/TelemetryRetentionSetting.php`

## Sparkplug

**Birth / death.** NBIRTH and DBIRTH announce an edge node's or device's metrics,
types and aliases and start a session; NDEATH and DDEATH end it. Data
(NDATA/DDATA) is accepted only within a session with the expected sequence.
See [Sparkplug reference](../reference/sparkplug.md).

**Rebirth.** A runtime request (NCMD `Node Control/Rebirth`) for fresh births when
the session is unknown or inconsistent.

**Primary Host / STATE.** The runtime publishes its online state on
`spBv1.0/STATE/<host_id>` so edge nodes know when to send births.

## Adapters

**Device adapter.** A tenant-authored, versioned decoder that turns a vendor
device's MQTT payloads into profile metrics, published as Sparkplug B by a managed
publisher. `DeviceAdapters/Models/DeviceAdapter.php`

**Adapter revision.** An immutable saved version of the decoder, source and
fixtures. Only a revision that passed its fixture test can be deployed.
`DeviceAdapters/Models/AdapterRevision.php`

**Adapter tenant.** An organization's adapter runtime: its ingress broker port,
CA and runtime token. `DeviceAdapters/Models/AdapterTenant.php`

**Adapter candidate / installation.** A candidate is a physical vendor device
seen by an adapter (by manufacturer serial). An installation links a virtual
device to a candidate for a period, keeping provenance when hardware changes.
`DeviceAdapters/Models/AdapterCandidate.php`, `DeviceInstallation.php`

## Automation and alerts

**Workflow.** An automation definition (`Automation/Models/Workflow.php`), in one
of two schemas:
- **Workflow v1** (`automation-workflow.v1`): the fixed four-node geofence chain,
  compiled to `geofence-rule.v1`. Created by geofences. Legacy.
- **Workflow v2 / DAG** (`automation-workflow.v2`): a typed graph of versioned
  nodes (sources, logic, windows, joins, actions), authored in the visual editor.
  Opt-in per organization.

**Deployment.** An immutable activation (or disable) snapshot of a workflow
revision, with its generation and, for DAGs, exact-value **command grants**
approved by a user with `Device.command`. `stopped_reason`: `superseded`,
`disabled`, `binding_changed`. `Automation/Models/Deployment.php`

**Scenario.** A saved, timed test case for a v2 workflow, run in simulation with
expected outputs and actions. `Automation/Models/Scenario.php`

**Evaluation / intent.** An evaluation is one runtime step of a DAG on a committed
event or timer, recorded in the execution timeline. An intent is an action an
evaluation requests (`action.command.v1`, `action.alert.v1`, `action.event.v1`),
sent to Laravel as `automation.intent.v1` and re-authorized by
`automation-worker` before it runs.

**Transition.** A geofence rule's `activated` / `cleared` change (sustained
outside / back inside), or a membership `entered` / `exited` change. IDs are
deterministic, so replays do not duplicate.

**Alert / episode.** One `automation_alerts` row per deployment episode: active
from activation until cleared. Acknowledgement and assignment are separate from
the condition; acknowledging never clears it. `Automation/Models/Alert.php`

**Alert delivery.** One email per alert, recipient and type (activated or
cleared), with retry history. `Automation/Models/AlertDelivery.php`

**Notification event.** An entry in the event log: workflow transitions, service
monitoring alerts and watchdog failures. `Notifications/Models/NotificationEvent.php`

## Location

**Location binding.** Which applied configuration parameters are a device's
latitude, longitude and optional accuracy, with freshness and clock-skew limits
(`location-binding.v1`). `Geospatial/Models/LocationBinding.php`

**Location fix.** One committed event resolved through a binding into a valid or
unknown point (`location-fix.v1`). Coordinates from different events are never
combined.

**Geofence / assignment.** A geofence is a named polygon. An assignment links a
geofence to a device's location binding and is executed as its own v1 workflow.
`Geospatial/Models/Geofence.php`, `GeofenceAssignment.php`

## Dashboards

**Dashboard.** An organization's named board of panels with layout, viewing
defaults, tags, folder and revision history. Access is `organization` or
`restricted`. `Dashboards/Models/Dashboard.php`

**Panel** (widget). One visualization on a dashboard (`schema_version: 2`), with a
type such as `timeseries`, `status`, `gauge`, `consumption`, `controls` or
`location`, and its sources ([dashboards](../features/dashboards.md)).

**Share.** Grants a role or a user `view` or `edit` on a restricted dashboard.
`Dashboards/Models/DashboardShare.php`

## Integrations

**Application.** A machine client owned by an organization, with explicit
abilities (`devices:read`, `alerts:read`, `events:read`, `telemetry:read`,
`locations:read`, `geofences:read`, `geofences:manage`, `geofences:activate`) and
1–100 granted devices. It has one active token at a time and cannot sign in to the
portal. `Integrations/Models/IntegrationApplication.php`

**Grant revision.** Bumped when an application's grants change; invalidates event
cursors and disables its webhook.

**Integration event.** An `integration-event.v1` envelope in the organization's
ordered journal (alert and geofence lifecycle, automation triggers), read through
the pull feed or delivered by webhook ([events](../reference/events.md#integration-events)).

**Webhook.** One signed HTTPS receiver per application for integration events.
`Integrations/Models/Webhook.php`

## Assistant

**Conversation.** A private assistant thread with one fixed target and a `scope`:
`profile`, `automation`, `adapter` or `help`. `Assistant/Models/AssistantConversation.php`

**Run.** One assistant request, with reserved and recorded cost.
`Assistant/Models/AssistantRun.php`

**Proposal.** A change set the assistant prepared, held with its base revision and
content hash until a person reviews and applies it.
`Assistant/Models/AssistantProposal.php`
