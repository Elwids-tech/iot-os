import type {
  Device,
  DeviceDetail,
  LocationBinding,
  LocationBindingInput,
  Measurement,
  WorkflowAlert,
} from "@iot-os/api-client"
import type { StatusTone } from "@iot-os/ui/components/status-mark"
import { formatAge } from "@iot-os/ui/lib/format"

export type DeviceHealth = {
  key:
    | "archived"
    | "failed"
    | "updating"
    | "deactivated"
    | "unconfigured"
    | "online"
    | "quiet"
    | "offline"
    | "unseen"
    | "unknown"
  tone: StatusTone
  label: string
}
// Derived from lifecycle, presence, deployment and freshness together, not one API status.
// ui-check: allow local-status-map
const health: Record<DeviceHealth["key"], [StatusTone, string]> = {
  archived: ["muted", "Archived"],
  failed: ["critical", "Configuration failed"],
  updating: ["warning", "Updating"],
  deactivated: ["muted", "Deactivated"],
  unconfigured: ["warning", "Needs configuration"],
  online: ["good", "Online"],
  quiet: ["warning", "Online · no recent data"],
  offline: ["critical", "Offline"],
  unseen: ["muted", "Not seen yet"],
  unknown: ["muted", "Connection unknown"],
}
type HealthInput = Pick<Device, "lifecycle" | "presence" | "deployment_status"> &
  Partial<Pick<Device, "last_seen_at">>
/** How long an online device may go without data before it reads "no recent data". */
export const RECENT_DATA_MS = 3_600_000
export type Freshness = { now?: number; recentMs?: number }

/**
 * A session can stay "online" while nothing arrives. Only a known last-seen
 * time older than `recentMs` counts as quiet; a missing time stays as reported.
 */
function quiet(device: HealthInput, { now = Date.now(), recentMs = RECENT_DATA_MS }: Freshness) {
  const seen = device.last_seen_at ? Date.parse(device.last_seen_at) : NaN
  return device.presence === "online" && now - seen > recentMs
}

/** Connection alone, as the device header shows it beside lifecycle and configuration. */
export function deviceConnection(device: HealthInput, freshness: Freshness = {}): DeviceHealth {
  const key: DeviceHealth["key"] = quiet(device, freshness)
    ? "quiet"
    : ["online", "offline", "unseen"].includes(device.presence)
      ? (device.presence as DeviceHealth["key"])
      : "unknown"
  const [tone, label] = health[key]
  return { key, tone, label }
}

/**
 * One health state from lifecycle, configuration and connection. Precedence:
 * archived, failed configuration, pending configuration, deactivated, never
 * configured, then connection (online without recent data is a warning).
 * Anything unrecognised stays "Connection unknown".
 */
export function deviceHealth(device: HealthInput, freshness: Freshness = {}): DeviceHealth {
  const key: DeviceHealth["key"] | null =
    device.lifecycle === "archived"
      ? "archived"
      : device.deployment_status === "failed"
        ? "failed"
        : device.deployment_status === "pending"
          ? "updating"
          : device.lifecycle === "deactivated"
            ? "deactivated"
            : device.lifecycle === "registered"
              ? "unconfigured"
              : null
  if (!key) return deviceConnection(device, freshness)
  const [tone, label] = health[key]
  return { key, tone, label }
}

/**
 * The statuses a device list filters on (DeviceDirectory::STATUSES in the API), in
 * menu order. Lists leave "quiet" to Last seen, and Lifecycle covers archived.
 */
export const listStatuses = (
  ["online", "offline", "unseen", "unknown", "unconfigured", "updating", "failed", "deactivated"] as const
).map((key) => ({ value: key, label: health[key][1] }))

/**
 * Freshness window for one device: the slowest parameter's profile
 * `reporting.stale_after_seconds`, never shorter than RECENT_DATA_MS.
 */
export function recentDataMs(parameters: Array<{ reporting?: unknown }>) {
  const seconds = parameters.map((p) =>
    p.reporting && typeof p.reporting === "object"
      ? Number((p.reporting as Record<string, unknown>).stale_after_seconds)
      : NaN,
  )
  return Math.max(RECENT_DATA_MS, ...seconds.filter(Number.isFinite).map((s) => s * 1000))
}

const lifecycleLabels = {
  registered: "Registered",
  active: "Active",
  deactivated: "Deactivated",
  archived: "Archived",
}
const presenceLabels = {
  online: "Online",
  offline: "Offline",
  unseen: "Not seen yet",
  unknown: "Unknown",
}
const deploymentLabels = {
  idle: "Not configured",
  pending: "Update pending",
  applied: "Applied",
  failed: "Failed",
  inactive: "Off",
}
/** The lifecycle, connection and configuration behind a health state, for its tooltip. */
export function healthDetails(device: HealthInput, freshness: Freshness = {}) {
  const off = device.lifecycle === "deactivated" || device.lifecycle === "archived"
  const connection = quiet(device, freshness)
    ? "Online, no recent data"
    : (presenceLabels[device.presence] ?? "Unknown")
  return [
    ["Lifecycle", lifecycleLabels[device.lifecycle] ?? device.lifecycle],
    // The runtime reports deactivated devices offline; that is not a connection fault.
    ...(off ? [] : [["Connection", connection]]),
    ["Configuration", deploymentLabels[device.deployment_status] ?? device.deployment_status],
    ...(device.last_seen_at
      ? [["Last seen", formatAge(device.last_seen_at, freshness.now) + " ago"]]
      : []),
  ] as [string, string][]
}

const GENERATED_CODE =
  /^device-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
/** "device-<uuid>" codes the platform generated, shortened to "device-ef7b…7632"; others unchanged. */
export function shortDeviceCode(code: string) {
  const uuid = GENERATED_CODE.exec(code)?.[1]
  return uuid ? `device-${uuid.slice(0, 4)}…${uuid.slice(-4)}` : code
}

type ConfigurationInput = Pick<
  DeviceDetail,
  | "deployment_status"
  | "desired_configuration_uuid"
  | "applied_configuration_uuid"
  | "last_applied_configuration_uuid"
  | "configurations"
>
/** Plain configuration state with the revision bookkeeping kept for a tooltip. */
export function configurationSummary(device: ConfigurationInput): {
  tone: StatusTone
  label: string
  details: string[]
} {
  const revision = (uuid: string | null) =>
    uuid ? device.configurations?.find((c) => c.uuid === uuid)?.revision : undefined
  const requested = revision(device.desired_configuration_uuid),
    applied = revision(device.applied_configuration_uuid),
    working = revision(device.last_applied_configuration_uuid)
  const of = (value: number | undefined) =>
    value === undefined ? "" : ` (revision ${value})`
  const details = [
    requested !== undefined && `Requested revision ${requested}`,
    applied !== undefined && `Applied revision ${applied}`,
    working !== undefined && `Last working revision ${working}`,
  ].filter((line): line is string => Boolean(line))
  switch (device.deployment_status) {
    case "applied":
      return { tone: "good", label: "Up to date" + of(applied ?? working), details }
    case "pending":
      return {
        tone: "warning",
        label: device.desired_configuration_uuid
          ? "Update pending" + of(requested)
          : "Turning off",
        details,
      }
    case "failed":
      return {
        tone: "critical",
        label:
          "Update failed" +
          of(requested) +
          (working !== undefined ? `, still running revision ${working}` : ""),
        details,
      }
    case "inactive":
      return {
        tone: "muted",
        label: working !== undefined ? `Off (last used revision ${working})` : "Off",
        details,
      }
    default:
      return { tone: "muted", label: "Not configured", details }
  }
}

export type LocationParameters = {
  latitude: string
  longitude: string
  accuracy: string | null
}
const keyEnds = (key: string, names: string[]) =>
  names.some((name) => new RegExp(`(^|[._-])${name}$`, "i").test(key))
/**
 * Latitude and longitude parameters: the device's saved location binding,
 * else profile keys ending in latitude/longitude (e.g. location.latitude).
 */
export function locationParameters(
  binding: Pick<
    LocationBinding,
    "latitude_parameter_uuid" | "longitude_parameter_uuid" | "accuracy_parameter_uuid"
  > | null | undefined,
  parameters: Array<{ uuid: string; key: string }>,
): LocationParameters | null {
  if (binding)
    return {
      latitude: binding.latitude_parameter_uuid,
      longitude: binding.longitude_parameter_uuid,
      accuracy: binding.accuracy_parameter_uuid,
    }
  const latitude = parameters.find((p) => keyEnds(p.key, ["latitude", "lat"])),
    longitude = parameters.find((p) => keyEnds(p.key, ["longitude", "lng", "lon"]))
  if (!latitude || !longitude) return null
  return {
    latitude: latitude.uuid,
    longitude: longitude.uuid,
    accuracy: parameters.find((p) => keyEnds(p.key, ["accuracy"]))?.uuid ?? null,
  }
}

type ProfileParameter = { uuid: string; key: string; data_type: string; unit: string | null }
/** Parameters that can hold a coordinate or an accuracy: numbers only. */
export const numericParameters = <T extends ProfileParameter>(parameters: T[]) =>
  parameters.filter((p) => p.data_type === "number" || p.data_type === "integer")

/** The location binding form; numbers stay text until saved. */
export type LocationDraft = {
  latitude: string
  longitude: string
  /** Empty saves no accuracy parameter. */
  accuracy: string
  max_age_seconds: string
  max_future_skew_seconds: string
  allow_unknown_accuracy: boolean
}
/**
 * The saved binding while its coordinates are still in the applied profile,
 * else the profile's guess, with the API's freshness defaults (90 s, 5 s).
 */
export function locationDraft(
  binding: LocationBinding | null | undefined,
  parameters: ProfileParameter[],
): LocationDraft {
  const numeric = numericParameters(parameters),
    known = (uuid: string | null | undefined) => numeric.some((p) => p.uuid === uuid)
  const saved =
    binding && known(binding.latitude_parameter_uuid) && known(binding.longitude_parameter_uuid)
      ? binding
      : null
  const where = locationParameters(saved, numeric)
  return {
    latitude: where?.latitude ?? "",
    longitude: where?.longitude ?? "",
    accuracy: where?.accuracy && known(where.accuracy) ? where.accuracy : "",
    max_age_seconds: String(binding?.max_age_seconds ?? 90),
    max_future_skew_seconds: String(binding?.max_future_skew_seconds ?? 5),
    allow_unknown_accuracy: binding?.allow_unknown_accuracy ?? true,
  }
}

export type LocationProblems = Partial<
  Record<"latitude" | "longitude" | "accuracy" | "max_age_seconds" | "max_future_skew_seconds", string>
>
/**
 * Why a draft can't be saved: the API's limits, and the units the runtime needs
 * (coordinates in deg, accuracy in m), without which no position ever resolves.
 */
export function locationProblems(
  draft: LocationDraft,
  parameters: ProfileParameter[],
): LocationProblems {
  const unit = (uuid: string) => parameters.find((p) => p.uuid === uuid)?.unit
  const problems: LocationProblems = {}
  for (const field of ["latitude", "longitude"] as const) {
    if (!draft[field]) problems[field] = `Choose the ${field} parameter.`
    else if (unit(draft[field]) !== "deg")
      problems[field] = "Maps need degrees. Set this parameter's unit to deg in its profile."
  }
  if (draft.latitude && draft.longitude === draft.latitude)
    problems.longitude = "Choose a different parameter from latitude."
  if (draft.accuracy && [draft.latitude, draft.longitude].includes(draft.accuracy))
    problems.accuracy = "Choose a parameter that isn't a coordinate."
  else if (draft.accuracy && unit(draft.accuracy) !== "m")
    problems.accuracy = "Accuracy must be in metres. Set this parameter's unit to m in its profile."
  const seconds = (value: string, min: number, max: number) =>
    /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max
  if (!seconds(draft.max_age_seconds, 1, 86_400))
    problems.max_age_seconds = "Enter whole seconds from 1 to 86,400."
  if (!seconds(draft.max_future_skew_seconds, 0, 300))
    problems.max_future_skew_seconds = "Enter whole seconds from 0 to 300."
  return problems
}

export function locationBindingInput(
  draft: LocationDraft,
  configuration_uuid: string,
  revision: number,
): LocationBindingInput {
  return {
    revision,
    configuration_uuid,
    latitude_parameter_uuid: draft.latitude,
    longitude_parameter_uuid: draft.longitude,
    accuracy_parameter_uuid: draft.accuracy || null,
    max_age_seconds: Number(draft.max_age_seconds),
    max_future_skew_seconds: Number(draft.max_future_skew_seconds),
    allow_unknown_accuracy: draft.allow_unknown_accuracy,
  }
}

export type LastPosition = {
  latitude: number
  longitude: number
  accuracy: number | null
  /** The older of the two coordinates' observation times. */
  observed_at: string
  received_at: string
  stale: boolean
}
/** Last known position from latest readings; null while either coordinate is unknown. */
export function lastPosition(
  readings: Measurement[],
  parameters: LocationParameters,
): LastPosition | null {
  const find = (uuid: string | null) =>
    uuid ? readings.find((r) => r.parameter_uuid === uuid) : undefined
  const latitude = find(parameters.latitude),
    longitude = find(parameters.longitude),
    accuracy = find(parameters.accuracy)
  if (!latitude || !longitude) return null
  if ([latitude, longitude].some((r) => r.quality === "invalid" || r.value === null))
    return null
  const lat = Number(latitude.value),
    lng = Number(longitude.value)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  // 0,0 is what receivers without a fix commonly report: keep it unknown.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  const older = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b)
  const metres = Number(accuracy?.value)
  return {
    latitude: lat,
    longitude: lng,
    accuracy:
      accuracy && accuracy.value !== null && Number.isFinite(metres) ? metres : null,
    observed_at: older(latitude.observed_at, longitude.observed_at),
    received_at: older(latitude.received_at, longitude.received_at),
    stale: latitude.quality !== "good" || longitude.quality !== "good",
  }
}

export type AlertGroup = {
  workflow_uuid: string
  workflow_name: string
  count: number
  active: number
  /** Newest episode: alerts arrive newest first. */
  latest: WorkflowAlert
}
/** Episodes grouped by workflow; groups with an active episode first, then newest. */
export function groupAlerts(alerts: WorkflowAlert[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>()
  for (const alert of alerts) {
    const group = groups.get(alert.workflow_uuid)
    const active = alert.condition === "active" ? 1 : 0
    if (group) {
      group.count++
      group.active += active
    } else
      groups.set(alert.workflow_uuid, {
        workflow_uuid: alert.workflow_uuid,
        workflow_name: alert.workflow_name,
        count: 1,
        active,
        latest: alert,
      })
  }
  const time = (group: AlertGroup) =>
    Date.parse(group.latest.cleared_at ?? group.latest.activated_at ?? "") || 0
  return [...groups.values()].sort(
    (a, b) => Number(b.active > 0) - Number(a.active > 0) || time(b) - time(a),
  )
}
