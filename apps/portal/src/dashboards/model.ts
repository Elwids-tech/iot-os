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
import { csvCell, isColorSource } from "../history/model"

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
// Saved colours must be hex. The defaults match Console's --series-1..6 and
// render through those variables, so panels follow the skin.
export const COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#9085e9",
]
const LEGACY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
]
/** A default palette colour as its skin variable; a custom colour stays as chosen. */
export function seriesColor(color: string) {
  const value = color.toLowerCase()
  const index = Math.max(COLORS.indexOf(value), LEGACY_COLORS.indexOf(value))
  return index < 0 ? color : `var(--series-${index + 1})`
}
export const NEUTRAL: DashboardBand = { label: "Current", color: "#64748b" }
/** Neutral bands read as muted text colour in every skin. */
export const bandColor = (color: string) =>
  color === NEUTRAL.color ? "var(--muted-foreground)" : color
export const PANEL_LABELS: Record<DashboardWidget["type"], string> = {
  status: "Status",
  timeseries: "Time series",
  gauge: "Gauge",
  table: "Table",
  controls: "Controls",
  device_health: "Device health",
  state_history: "State history",
  color_history: "Colour history",
  location: "GPS map",
  alerts: "Alerts",
  text: "Text",
}
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
    title: PANEL_LABELS[type],
    description: "",
    config:
      type === "controls"
        ? { sources: [], columns: "auto" }
        : type === "location"
          ? { sources: [], location_device_uuids: [], show_trails: true, show_labels: true, trail_window: "24h" }
        : type === "gauge"
          ? { sources: [], min: 0, max: 100 }
          : type === "text"
            ? { sources: [], text: "" }
            : type === "device_health"
              ? { sources: [], devices: [] }
              : { sources: [] },
  }
}
/** Profile display.precision for a source's parameter, used when the panel sets none. */
export function profilePrecision(
  device: DeviceDetail | undefined,
  parameterUuid: string,
): number | undefined {
  const precision = appliedParameters(device).find(
    (parameter) => parameter.uuid === parameterUuid,
  )?.display?.precision
  return typeof precision === "number" ? precision : undefined
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
  if (widget.type === "location")
    return widget.config.location_device_uuids?.length || widget.config.workflow_uuid ? null : "Choose at least one GPS device."
  if (widget.type === "alerts") return widget.config.workflow_uuid ? null : "Choose a workflow."
  if (widget.type === "text")
    return widget.config.text?.trim() ? null : "Enter the panel text."
  if (widget.type === "device_health") {
    const count = widget.config.devices?.length ?? 0
    return !count
      ? "Add at least one device."
      : count > 50
        ? "Add up to 50 devices."
        : null
  }
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
  if (widget.type === "gauge") {
    const { min, max } = widget.config
    if (!Number.isFinite(min) || !Number.isFinite(max) || min! >= max!)
      return "Enter a maximum greater than the minimum."
    if (widget.config.sources.length > 4)
      return "A gauge shows up to 4 parameters."
    if (widget.config.sources.some((s) => !numeric(s)))
      return "Gauges require numeric parameters."
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
/** Coloured band segments of a gauge scale, as percentages of min..max. */
export function gaugeSegments(source: DashboardSource, min: number, max: number) {
  const span = max - min
  const bands = [
    { value: -Infinity, ...source.base },
    ...[...source.thresholds].sort((a, b) => a.value - b.value),
  ]
  return bands
    .map((band, index) => {
      const from = Math.max(min, band.value)
      const to = Math.min(max, bands[index + 1]?.value ?? Infinity)
      return {
        label: band.label,
        color: band.color,
        from: ((from - min) / span) * 100,
        to: ((to - min) / span) * 100,
      }
    })
    .filter((segment) => segment.to > segment.from)
}
export function resolveRange(range: DashboardRange, now = Date.now()) {
  return range.mode === "relative"
    ? {
        from: new Date(now - PRESETS[range.preset]).toISOString(),
        to: new Date(now).toISOString(),
      }
    : { from: range.from, to: range.to }
}
/** Matches the default measurement retention, so a full year plus a month can be compared. */
export const MAX_ABSOLUTE_DAYS = 400
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
  if (end - start > MAX_ABSOLUTE_DAYS * 86_400_000)
    return `Choose a range of ${MAX_ABSOLUTE_DAYS} days or less. Available data also depends on device retention.`
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
/** Axis ticks sized to the range: time of day, weekday and time, or date. */
export function tickFormatter(span: number, timezone: DashboardView["timezone"]) {
  const format = new Intl.DateTimeFormat(undefined, {
    ...(span <= PRESETS["24h"]
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : span <= PRESETS["7d"]
        ? { weekday: "short", hour: "2-digit", hourCycle: "h23" }
        : { month: "short", day: "numeric" }),
    ...(timezone === "utc" ? { timeZone: "UTC" } : {}),
  })
  return (value: number) => format.format(value)
}
/** Min, average, max and last of the non-empty values, in time order. */
export function seriesStats(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null)
  if (!known.length) return null
  return {
    min: Math.min(...known),
    avg: known.reduce((sum, value) => sum + value, 0) / known.length,
    max: Math.max(...known),
    last: known[known.length - 1],
  }
}
export function toCsv(rows: unknown[][]) {
  return (
    rows
      .map((row) =>
        row
          .map((cell) =>
            csvCell(
              typeof cell === "object" && cell !== null
                ? JSON.stringify(cell)
                : cell,
            ),
          )
          .join(","),
      )
      .join("\r\n") + "\r\n"
  )
}
/** Save text as a file through a temporary link. */
export function saveFile(name: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement("a")
  link.href = href
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
}
export const fileName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "dashboard"
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
  placement: "available" | "bottom" = "available",
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
      if (placement === "bottom") {
        const y = Math.max(0, ...existing.map((item) => item.y + item.h))
        return [key, [...existing, { i: id, x: 0, y, w, h }]]
      }
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
