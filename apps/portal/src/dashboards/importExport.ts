import type {
  Dashboard,
  DashboardInput,
  DashboardLayout,
  DashboardSource,
  DashboardView,
  DashboardWidget,
  StatusWidgetConfig,
} from "@iot-os/api-client"
import { DEFAULT_VIEW, fileName, saveFile } from "./model"

/** The portable part of a dashboard; ids, revision and per-user fields stay behind. */
export function definition(dashboard: Dashboard): DashboardInput {
  const { name, widgets, layouts, defaults, tags, folder } = dashboard
  return { name, widgets, layouts, defaults, tags, folder }
}

export function downloadJson(name: string, data: unknown) {
  saveFile(`${fileName(name)}.json`, JSON.stringify(data, null, 2), "application/json")
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const FILE_TOO_LARGE = "Choose a file of 2 MB or less."
const MAX_DASHBOARDS = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^#[0-9a-f]{6}$/i
const TYPES = [
  "status",
  "timeseries",
  "controls",
  "state_history",
  "color_history",
  "location",
  "alerts",
  "gauge",
  "table",
  "text",
  "device_health",
] as const
// Config keys per panel type, as the server accepts them.
const CONFIG_KEYS: Partial<Record<DashboardWidget["type"], string[]>> = {
  location: ["sources", "workflow_uuid", "location_device_uuids", "geofence_uuid", "show_trails", "show_labels", "trail_window"],
  gauge: ["sources", "min", "max"],
  table: ["sources"],
  text: ["sources", "text"],
  device_health: ["sources", "devices"],
}
const BREAKPOINTS = ["lg", "md", "sm", "xs", "xxs"] as const
// Read-only fields an API response carries; accepted and dropped.
const SERVER_KEYS = [
  "uuid",
  "revision",
  "starred",
  "last_viewed_at",
  "created_by",
  "created_by_name",
  "updated_by_name",
  "created_at",
  "updated_at",
]

class ShapeError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message)
  }
}
function fail(path: string, message: string): never {
  throw new ShapeError(path, message)
}
function object(value: unknown, path: string, keys: readonly string[]) {
  if (!isObject(value)) fail(path, "must be an object.")
  // Only known keys pass, so __proto__, constructor and prototype stop the import at every level.
  const unknown = Object.keys(value).find((key) => !keys.includes(key))
  if (unknown !== undefined) fail(path, `has an unknown key "${unknown.slice(0, 40)}".`)
  return value
}
function list(value: unknown, path: string, max: number, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(path, `must be a list of ${min ? `${min} to ${max}` : `up to ${max}`} items.`)
  return value
}
function text(value: unknown, path: string, max: number, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max)
    fail(path, `must be text of ${min ? `1 to ${max}` : `up to ${max}`} characters.`)
  return value
}
const optionalText = (value: unknown, path: string, max: number) =>
  value === undefined || value === null ? null : text(value, path, max, 0)
function number(value: unknown, path: string, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    fail(path, Number.isFinite(min) ? `must be a number from ${min} to ${max}.` : "must be a number.")
  return value
}
function whole(value: unknown, path: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    fail(path, `must be a whole number from ${min} to ${max}.`)
  return value
}
function oneOf<T extends string | number>(value: unknown, path: string, options: readonly T[]): T {
  const match = options.find((option) => option === value)
  if (match === undefined) fail(path, `must be one of ${options.join(", ")}.`)
  return match
}
function pattern(value: unknown, path: string, test: RegExp, what: string) {
  if (typeof value !== "string" || !test.test(value)) fail(path, `must be ${what}.`)
  return value
}

function readBand(value: unknown, path: string) {
  const band = object(value, path, ["label", "color"])
  return {
    label: text(band.label, `${path}.label`, 80),
    color: pattern(band.color, `${path}.color`, HEX, "a colour like #2563eb"),
  }
}

// device_name keys are allowed but not sent; the server sets them from the device.
function readSource(value: unknown, path: string): DashboardSource {
  const s = object(value, path, [
    "device_uuid",
    "parameter_uuid",
    "device_name",
    "label",
    "unit",
    "data_type",
    "format",
    "display_widget",
    "precision",
    "color",
    "base",
    "thresholds",
  ])
  return {
    device_uuid: pattern(s.device_uuid, `${path}.device_uuid`, UUID, "a UUID"),
    parameter_uuid: pattern(s.parameter_uuid, `${path}.parameter_uuid`, UUID, "a UUID"),
    label: optionalText(s.label, `${path}.label`, 120) ?? "",
    unit: optionalText(s.unit, `${path}.unit`, 100),
    data_type: text(s.data_type, `${path}.data_type`, 32),
    format: optionalText(s.format, `${path}.format`, 100),
    display_widget: optionalText(s.display_widget, `${path}.display_widget`, 100),
    precision:
      s.precision === undefined || s.precision === null
        ? null
        : whole(s.precision, `${path}.precision`, 0, 10),
    color: pattern(s.color, `${path}.color`, HEX, "a colour like #2563eb"),
    base: readBand(s.base, `${path}.base`),
    thresholds: list(s.thresholds, `${path}.thresholds`, 100).map((item, i) => {
      const at = `${path}.thresholds.${i}`
      const rule = object(item, at, ["value", "label", "color"])
      return { value: number(rule.value, `${at}.value`), ...readBand({ label: rule.label, color: rule.color }, at) }
    }),
  }
}

function readWidget(value: unknown, path: string): DashboardWidget {
  const w = object(value, path, ["id", "schema_version", "type", "title", "description", "config"])
  const type = oneOf(w.type, `${path}.type`, TYPES)
  oneOf(w.schema_version, `${path}.schema_version`, [2])
  const at = `${path}.config`
  const c = object(w.config, at, CONFIG_KEYS[type] ?? ["sources", "columns", "workflow_uuid"])
  const config: StatusWidgetConfig = {
    sources: list(c.sources, `${at}.sources`, 100).map((s, i) => readSource(s, `${at}.sources.${i}`)),
  }
  if (c.workflow_uuid !== undefined)
    config.workflow_uuid = pattern(c.workflow_uuid, `${at}.workflow_uuid`, UUID, "a UUID")
  if (c.columns !== undefined) config.columns = oneOf(c.columns, `${at}.columns`, ["auto", 1, 2, 3, 4] as const)
  if (type === "location") {
    if (c.location_device_uuids !== undefined) {
      config.location_device_uuids = list(c.location_device_uuids, `${at}.location_device_uuids`, 100).map((id, i) => pattern(id, `${at}.location_device_uuids.${i}`, UUID, "a UUID"))
      if (new Set(config.location_device_uuids).size !== config.location_device_uuids.length) fail(`${at}.location_device_uuids`, "must contain distinct devices.")
    }
    if (c.geofence_uuid !== undefined) config.geofence_uuid = pattern(c.geofence_uuid, `${at}.geofence_uuid`, UUID, "a UUID")
    if (c.trail_window !== undefined) config.trail_window = oneOf(c.trail_window, `${at}.trail_window`, ["1h", "6h", "24h", "7d"] as const)
    for (const key of ["show_trails", "show_labels"] as const) {
      if (c[key] !== undefined) {
        if (typeof c[key] !== "boolean") fail(`${at}.${key}`, "must be a boolean.")
        config[key] = c[key]
      }
    }
  }
  if (type === "gauge") {
    config.min = number(c.min, `${at}.min`)
    config.max = number(c.max, `${at}.max`)
    if (config.min >= config.max) fail(`${at}.max`, "must be greater than min.")
  }
  if (type === "text") config.text = text(c.text, `${at}.text`, 4000)
  if (type === "device_health")
    config.devices = list(c.devices, `${at}.devices`, 50, 1).map((item, i) => {
      const device = object(item, `${at}.devices.${i}`, ["device_uuid", "device_name"])
      return { device_uuid: pattern(device.device_uuid, `${at}.devices.${i}.device_uuid`, UUID, "a UUID") }
    })
  return {
    id: text(w.id, `${path}.id`, 100),
    schema_version: 2,
    type,
    title: text(w.title, `${path}.title`, 120),
    description: optionalText(w.description, `${path}.description`, 1000) ?? "",
    config,
  }
}

function readLayouts(value: unknown): DashboardLayout {
  const raw = object(value ?? {}, "layouts", BREAKPOINTS)
  const layouts: DashboardLayout = {}
  for (const key of BREAKPOINTS) {
    if (raw[key] === undefined) continue
    layouts[key] = list(raw[key], `layouts.${key}`, 100).map((item, i) => {
      const at = `layouts.${key}.${i}`
      const l = object(item, at, ["i", "x", "y", "w", "h"])
      return {
        i: text(l.i, `${at}.i`, 100),
        x: whole(l.x, `${at}.x`, 0, 12),
        y: whole(l.y, `${at}.y`, 0, 100000),
        w: whole(l.w, `${at}.w`, 1, 12),
        h: whole(l.h, `${at}.h`, 1, 100),
      }
    })
  }
  return layouts
}

function readDefaults(value: unknown): DashboardView {
  const d = object(value, "defaults", ["range", "timezone", "refresh"])
  const r = object(d.range, "defaults.range", ["mode", "preset", "from", "to"])
  const date = (v: unknown, path: string) => {
    const value = text(v, path, 40)
    if (!Number.isFinite(Date.parse(value))) fail(path, "must be a date and time.")
    return value
  }
  return {
    range:
      oneOf(r.mode, "defaults.range.mode", ["relative", "absolute"]) === "relative"
        ? {
            mode: "relative",
            preset: oneOf(r.preset, "defaults.range.preset", ["15m", "1h", "6h", "24h", "7d", "30d"] as const),
          }
        : {
            mode: "absolute",
            from: date(r.from, "defaults.range.from"),
            to: date(r.to, "defaults.range.to"),
          },
    timezone: oneOf(d.timezone, "defaults.timezone", ["browser", "utc"] as const),
    refresh: oneOf(d.refresh, "defaults.refresh", [0, 5, 10, 30, 60] as const),
  }
}

/** Rebuilds a dashboard from known keys only; nothing from the file is passed through unchecked. */
function readDashboard(value: unknown): DashboardInput {
  const d = object(value, "dashboard", ["name", "widgets", "layouts", "defaults", "tags", "folder", ...SERVER_KEYS])
  return {
    name: text(d.name, "name", 120).trim(),
    widgets: list(d.widgets, "widgets", 100).map((w, i) => readWidget(w, `widgets.${i}`)),
    layouts: readLayouts(d.layouts),
    defaults: d.defaults === undefined ? DEFAULT_VIEW : readDefaults(d.defaults),
    tags:
      d.tags === undefined
        ? []
        : list(d.tags, "tags", 10).map((tag, i) => text(tag, `tags.${i}`, 32).trim()),
    folder: optionalText(d.folder, "folder", 60)?.trim() || null,
  }
}

/**
 * Validates one exported dashboard or a list of them against the shapes the
 * server accepts (types, allowed keys, basic ranges). Device and parameter
 * ownership and layout coverage are left for the server.
 */
export function parseDefinitions(
  text: string,
): { definitions: DashboardInput[]; errors: string[] } {
  const failed = (message: string) => ({ definitions: [], errors: [message] })
  if (text.length > MAX_IMPORT_BYTES) return failed(FILE_TOO_LARGE)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return failed("The file is not valid JSON.")
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  if (!items.length) return failed("The file has no dashboards.")
  if (items.length > MAX_DASHBOARDS)
    return failed(`The file has more than ${MAX_DASHBOARDS} dashboards.`)
  const errors: string[] = []
  const definitions: DashboardInput[] = []
  items.forEach((item, index) => {
    try {
      definitions.push(readDashboard(item))
    } catch (error) {
      if (!(error instanceof ShapeError)) throw error
      const widgets = isObject(item) && Array.isArray(item.widgets) ? item.widgets : undefined
      errors.push(
        `${items.length > 1 ? `Dashboard ${index + 1}: ` : ""}${fieldLabel(error.path, widgets)} ${error.message}`,
      )
    }
  })
  return { definitions: errors.length ? [] : definitions, errors }
}

/** "widgets.1.config.sources.0.device_uuid" → "Panel 2 (Title) · config.sources.0.device_uuid" */
export function fieldLabel(field: string, widgets?: readonly unknown[]) {
  const match = /^widgets\.(\d+)\.?(.*)$/.exec(field)
  if (!match) return field
  const widget = widgets?.[Number(match[1])]
  const title =
    isObject(widget) && typeof widget.title === "string" ? widget.title.slice(0, 60) : ""
  return `Panel ${Number(match[1]) + 1}${title ? ` (${title})` : ""}${match[2] ? ` · ${match[2]}` : ""}`
}
