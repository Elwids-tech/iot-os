import type {
  DashboardSource,
  DeviceConfiguration,
  DeviceProfileParameter,
  HistoryRecord,
} from "@iot-os/api-client"

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const STATE_COLORS = [
  "#2563eb",
  "#9333ea",
  "#d97706",
  "#0891b2",
  "#dc2626",
  "#4f46e5",
  "#0f766e",
]

function displayWidget(value: unknown) {
  return value && typeof value === "object"
    ? String((value as Record<string, unknown>).widget ?? "")
    : ""
}

export function isColorParameter(parameter?: DeviceProfileParameter) {
  return Boolean(
    parameter?.data_type === "string" &&
      (parameter.format === "hex_color" ||
        displayWidget(parameter.display) === "color"),
  )
}

export function isColorSource(source: DashboardSource) {
  return (
    source.data_type === "string" &&
    (source.format === "hex_color" || source.display_widget === "color")
  )
}

export function validHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value)
}

export function booleanValue(value: unknown) {
  if (value === true || value === 1 || value === "1" || value === "true")
    return true
  if (value === false || value === 0 || value === "0" || value === "false")
    return false
  return null
}

export function stateLabel(value: unknown, known: boolean, dataType?: string) {
  if (!known) return "Unknown"
  if (dataType === "boolean") {
    const boolean = booleanValue(value)
    return boolean === null ? String(value) : boolean ? "On (1)" : "Off (0)"
  }
  return value === null || value === undefined ? "Unknown" : String(value)
}

export function stateColor(value: unknown, known: boolean, dataType?: string) {
  if (!known) return "#94a3b8"
  if (dataType === "boolean") return booleanValue(value) ? "#16a34a" : "#64748b"
  const label = String(value)
  let hash = 0
  for (let i = 0; i < label.length; i++)
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return STATE_COLORS[hash % STATE_COLORS.length]
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}

export function configurationMeta(
  configurations: DeviceConfiguration[],
  uuid: string,
) {
  const configuration = configurations.find((item) => item.uuid === uuid)
  return {
    configuration,
    configurationLabel: configuration
      ? `Device configuration ${configuration.revision}`
      : `Configuration ${uuid.slice(0, 8)}`,
    profileLabel: configuration?.profile_revision
      ? `Profile revision ${configuration.profile_revision}`
      : "Profile revision unavailable",
  }
}

function csvValue(value: unknown, dataType: string) {
  if (dataType === "boolean") {
    const boolean = booleanValue(value)
    if (boolean !== null) return boolean ? "1" : "0"
  }
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return value
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

/**
 * One CSV cell. Text a spreadsheet would run as a formula (=, +, -, @, tab or
 * CR first) gets a leading quote; numbers stay numeric, negatives included.
 */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value)
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(value)) text = "'" + text
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export type HistoryCsvContext = {
  deviceUuid: string
  deviceName: string
  parameterUuid: string
  parameterKey: string
  parameterLabel: string
  configurations: DeviceConfiguration[]
}

export function buildHistoryCsv(
  records: HistoryRecord[],
  context: HistoryCsvContext,
) {
  const headers = [
    "received_at",
    "observed_at",
    "event_uuid",
    "device_uuid",
    "device_name",
    "parameter_uuid",
    "parameter_key",
    "parameter_label",
    "value",
    "data_type",
    "unit",
    "quality",
    "diagnostic",
    "device_configuration_revision",
    "configuration_uuid",
    "profile_name",
    "profile_uuid",
    "profile_revision",
    "profile_artifact_uuid",
  ]
  const rows = [...records]
    .sort(
      (a, b) =>
        Date.parse(a.received_at) - Date.parse(b.received_at) ||
        a.event_uuid.localeCompare(b.event_uuid),
    )
    .map((record) => {
      const configuration = context.configurations.find(
        (item) => item.uuid === record.configuration_uuid,
      )
      return [
        record.received_at,
        record.observed_at,
        record.event_uuid,
        context.deviceUuid,
        context.deviceName,
        context.parameterUuid,
        context.parameterKey,
        context.parameterLabel,
        csvValue(record.value, record.data_type),
        record.data_type,
        record.unit,
        record.quality,
        record.diagnostic,
        configuration?.revision,
        record.configuration_uuid,
        configuration?.profile_name,
        configuration?.profile_uuid,
        configuration?.profile_revision,
        configuration?.profile_artifact_uuid,
      ]
        .map(csvCell)
        .join(",")
    })
  return [headers.join(","), ...rows].join("\r\n") + "\r\n"
}

export function historyFileName(device: string, parameter: string) {
  const safe = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  return `${safe(device) || "device"}-${safe(parameter) || "parameter"}-history.csv`
}

export type HistoryWindow = { from: string; to: string }
/** The same span as `window`, ending just after the last reading. */
export function latestDataWindow(window: HistoryWindow, lastSeen: string): HistoryWindow {
  const span = Date.parse(window.to) - Date.parse(window.from)
  const to = Date.parse(lastSeen) + 60_000
  return { from: new Date(to - span).toISOString(), to: new Date(to).toISOString() }
}

/**
 * Why a successful history request came back empty: the range is past
 * retention, the device's last data is past retention, the range starts
 * after the device was last seen (jump to its data), or nothing was recorded.
 */
export function emptyHistoryReason(
  window: HistoryWindow,
  lastSeen: string | null,
  retentionCutoff: string,
): "range-expired" | "data-expired" | "before-range" | "empty" {
  const cutoff = Date.parse(retentionCutoff),
    seen = lastSeen ? Date.parse(lastSeen) : NaN
  if (Date.parse(window.to) <= cutoff) return "range-expired"
  if (seen < Date.parse(window.from))
    return seen < cutoff ? "data-expired" : "before-range"
  return "empty"
}
