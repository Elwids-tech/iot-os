import type {
  DashboardBand,
  DashboardLayout,
  DashboardRange,
  DashboardSource,
  DashboardView,
  DashboardWidget,
  DeviceDetail,
  Measurement,
} from "@iot-os/api-client"
import { configurationProfile } from "@iot-os/api-client"
import { isColorSource } from "../history/model"

export const DEFAULT_VIEW: DashboardView = {
  range: { mode: "relative", preset: "6h" },
  timezone: "browser",
  refresh: 5,
}
export const PRESETS = {
  "15m": 900000,
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
} as const
export const PRESET_LABELS = {
  "15m": "Last 15 minutes",
  "1h": "Last 1 hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
}
export const COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
]
export const NEUTRAL: DashboardBand = { label: "Current", color: "#64748b" }
export const numeric = (source: Pick<DashboardSource, "data_type">) =>
  ["number", "integer"].includes(source.data_type)
export const sourceKey = (
  s: Pick<DashboardSource, "device_uuid" | "parameter_uuid">,
) => `${s.device_uuid}:${s.parameter_uuid}`
export const dashboardPath = (org: string, id?: string) =>
  `/organizations/${encodeURIComponent(org)}/dashboards${id ? "/" + encodeURIComponent(id) : ""}`
export function newWidget(type: DashboardWidget["type"]): DashboardWidget {
  return {
    id: crypto.randomUUID(),
    schema_version: 2,
    type,
    title:
      type === "location" ? "Location" : type === "alerts" ? "Alerts" : type === "status"
        ? "Status"
        : type === "controls"
          ? "Controls"
          : type === "timeseries"
            ? "Time series"
            : type === "state_history"
              ? "State history"
              : "Colour history",
    description: "",
    config:
      type === "controls"
        ? { sources: [], columns: "auto" }
        : type === "location"
          ? { sources: [], location_device_uuids: [], show_trails: true, show_labels: true, trail_window: "24h" }
          : { sources: [] },
  }
}
export function appliedParameters(device?: DeviceDetail) {
  const id =
    device?.applied_configuration_uuid ??
    device?.last_applied_configuration_uuid
  const configuration = device?.configurations.find((c) => c.uuid === id)
  return configuration ? configurationProfile(configuration).parameters : []
}
export function thresholdError(source: DashboardSource): string | null {
  if (!source.base.label.trim()) return "Give the Base band a label."
  if (source.thresholds.some((t) => !Number.isFinite(t.value)))
    return "Every boundary must be a finite number."
  if (
    new Set(source.thresholds.map((t) => t.value)).size !==
    source.thresholds.length
  )
    return "Threshold boundaries must be unique."
  if (source.thresholds.some((t) => !t.label.trim()))
    return "Give every threshold a label."
  return null
}
export function widgetError(widget: DashboardWidget): string | null {
  if (!widget.title.trim()) return "Enter a panel title."
  if (widget.type === "location") return widget.config.location_device_uuids?.length || widget.config.workflow_uuid ? null : "Choose at least one GPS device."
  if (widget.type === "alerts") return widget.config.workflow_uuid ? null : "Choose a workflow."
  if (!widget.config.sources.length) return "Add at least one parameter."
  for (const source of widget.config.sources) {
    if (
      source.precision !== null &&
      (!Number.isInteger(source.precision) ||
        source.precision < 0 ||
        source.precision > 10)
    )
      return "Precision must be a whole number from 0 to 10."
    const error = thresholdError(source)
    if (error) return `${source.label}: ${error}`
  }
  if (widget.type === "timeseries") {
    if (widget.config.sources.some((s) => !numeric(s)))
      return "Time series requires numeric parameters."
    if (new Set(widget.config.sources.map((s) => s.unit ?? "")).size > 1)
      return "Use parameters with the same unit, or add a separate chart."
  }
  if (
    widget.type === "state_history" &&
    widget.config.sources.some(
      (source) => !["boolean", "enum"].includes(source.data_type),
    )
  )
    return "State history requires boolean or enum parameters."
  if (
    widget.type === "color_history" &&
    widget.config.sources.some((source) => !isColorSource(source))
  )
    return "Colour history requires parameters configured as colour controls."
  return null
}
export function bandFor(
  source: DashboardSource,
  reading?: Measurement,
): DashboardBand {
  if (!reading) return { ...NEUTRAL, label: "No reading" }
  if (reading.quality !== "good") return { ...NEUTRAL, label: reading.quality }
  if (reading.value === null || reading.value === undefined)
    return { ...NEUTRAL, label: "No reading" }
  if (typeof reading.value !== "number") return NEUTRAL
  const value = reading.value
  return (
    [...source.thresholds]
      .sort((a, b) => a.value - b.value)
      .filter((t) => value >= t.value)
      .at(-1) ?? source.base
  )
}
export function resolveRange(range: DashboardRange, now = Date.now()) {
  return range.mode === "relative"
    ? {
        from: new Date(now - PRESETS[range.preset]).toISOString(),
        to: new Date(now).toISOString(),
      }
    : { from: range.from, to: range.to }
}
export function absoluteError(
  from: string,
  to: string,
  now = Date.now(),
): string | null {
  const start = Date.parse(from),
    end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return "Enter valid From and To dates and times."
  if (end <= start) return "To must be after From."
  if (end > now) return "To cannot be in the future."
  if (end - start > PRESETS["30d"] * 3)
    return "Choose a range of 90 days or less. Available data also depends on device retention."
  return null
}
export function readView(
  params: URLSearchParams,
  defaults: DashboardView,
): DashboardView {
  let range = defaults.range
  const from = params.get("from"),
    to = params.get("to"),
    preset = params.get("range")
  if (preset && preset in PRESETS)
    range = { mode: "relative", preset: preset as keyof typeof PRESETS }
  else if (from && to && !absoluteError(from, to))
    range = {
      mode: "absolute",
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    }
  const timezone = params.get("timezone"),
    refresh = Number(params.get("refresh"))
  return {
    range,
    timezone:
      timezone === "utc" || timezone === "browser"
        ? timezone
        : defaults.timezone,
    refresh:
      params.has("refresh") && [0, 5, 10, 30, 60].includes(refresh)
        ? (refresh as DashboardView["refresh"])
        : defaults.refresh,
  }
}
export function writeView(params: URLSearchParams, view: DashboardView) {
  const next = new URLSearchParams(params)
  for (const key of ["range", "from", "to"]) next.delete(key)
  if (view.range.mode === "relative") next.set("range", view.range.preset)
  else {
    next.set("from", view.range.from)
    next.set("to", view.range.to)
  }
  next.set("timezone", view.timezone)
  next.set("refresh", String(view.refresh))
  return next
}
export function dateInput(iso: string, timezone: DashboardView["timezone"]) {
  const d = new Date(iso)
  return new Date(
    d.getTime() - (timezone === "browser" ? d.getTimezoneOffset() * 60000 : 0),
  )
    .toISOString()
    .slice(0, 19)
}
export function inputDate(value: string, timezone: DashboardView["timezone"]) {
  const date = new Date(value + (timezone === "utc" ? "Z" : ""))
  // Reject nonexistent local times during the spring DST transition.
  return Number.isFinite(date.getTime()) &&
    dateInput(date.toISOString(), timezone).slice(0, value.length) === value
    ? date.toISOString()
    : ""
}
export function timeLabel(value: string, timezone: DashboardView["timezone"]) {
  return new Date(value).toLocaleString(undefined, {
    ...(timezone === "utc" ? { timeZone: "UTC" } : {}),
    timeZoneName: "short",
  })
}
export function cleanLayouts(layouts: DashboardLayout): DashboardLayout {
  return Object.fromEntries(
    Object.entries(layouts).map(([key, items]) => [
      key,
      (items ?? []).map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
    ]),
  )
}

/** Scale missing desktop layouts; never replace an explicitly saved breakpoint. */
export function responsiveLayouts(layouts: DashboardLayout): DashboardLayout {
  const result = cleanLayouts(layouts)
  const columns: Record<string, number> = {
    lg: 12,
    md: 10,
    sm: 6,
    xs: 1,
    xxs: 1,
  }
  const primary = result.lg ? "lg" : Object.keys(result)[0]
  const original = result[primary] ?? []
  const originalCols = columns[primary] ?? 12
  for (const [key, cols] of Object.entries(columns)) {
    if (result[key]) continue
    let row = 0
    result[key] = [...original]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item) => {
        if (cols === 1) {
          const value = { ...item, x: 0, y: row, w: 1 }
          row += item.h
          return value
        }
        const width = Math.max(1, Math.floor((item.w * cols) / originalCols))
        return {
          ...item,
          w: width,
          x: Math.min(cols - width, Math.floor((item.x * cols) / originalCols)),
        }
      })
  }
  return result
}
export function appendLayout(
  layouts: DashboardLayout,
  id: string,
): DashboardLayout {
  const entries = Object.keys(layouts).length
    ? Object.entries(layouts)
    : [["lg", []] as const]
  return Object.fromEntries(
    entries.map(([key, items]) => {
      const existing = items ?? []
      const cols =
        ({ lg: 12, md: 10, sm: 6, xs: 1, xxs: 1 } as Record<string, number>)[
          key
        ] ?? 12
      const w = Math.max(1, Math.floor(cols / 2)),
        h = 6
      const rows = [
        ...new Set([0, ...existing.map((item) => item.y + item.h)]),
      ].sort((a, b) => a - b)
      for (const y of rows)
        for (let x = 0; x <= cols - w; x++) {
          if (
            !existing.some(
              (item) =>
                x < item.x + item.w &&
                x + w > item.x &&
                y < item.y + item.h &&
                y + h > item.y,
            )
          ) {
            return [key, [...existing, { i: id, x, y, w, h }]]
          }
        }
      return [key, existing]
    }),
  )
}
