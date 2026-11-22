import type { AlertLimit, DashboardSource, StatusWidgetConfig } from "@iot-os/api-client"
import { formatNumber } from "@iot-os/ui/lib/format"
import { formatDuration } from "../devices/model"
import { numeric } from "./model"

/**
 * Alert limits on a time series panel (spec 037): the values at which running
 * automations raise or clear an alert on the readings the panel draws. They come from
 * the automations, never from the panel, so they cannot drift from the real rule.
 */

/** At most this many limit lines on one chart; the legend lists every limit. */
export const MAX_LIMIT_LINES = 8

/** A panel's limit: one line, covering every device that shares it. */
export type PanelLimit = Omit<AlertLimit, "device_uuid" | "parameter_uuid"> & {
  key: string
  /** The devices the limit covers, by name. */
  devices: { uuid: string; name: string }[]
  /** False when the limit is in another unit than the panel shows: listed, never drawn. */
  sameUnit: boolean
}

/** The devices to ask limits for: the panel's numeric sources, unless it turned limits off. */
export function limitDevices(config: Pick<StatusWidgetConfig, "sources" | "alert_limits">): string[] {
  if (config.alert_limits === false) return []
  return [...new Set(config.sources.filter(numeric).map((source) => source.device_uuid))]
}

/**
 * Collects the devices asked for within a moment into one request of at most `size`
 * devices, so a dashboard of many panels asks once. Each caller gets its device's rows.
 */
export function createLimitBatcher(
  request: (org: string, deviceIds: string[]) => Promise<AlertLimit[]>,
  wait = 25,
  size = 100,
) {
  type Waiter = { id: string; resolve: (rows: AlertLimit[]) => void; reject: (reason: unknown) => void }
  const pending = new Map<string, Waiter[]>()
  async function flush(org: string) {
    const waiters = pending.get(org) ?? []
    pending.delete(org)
    const ids = [...new Set(waiters.map((waiter) => waiter.id))]
    for (let start = 0; start < ids.length; start += size) {
      const chunk = new Set(ids.slice(start, start + size))
      const theirs = waiters.filter((waiter) => chunk.has(waiter.id))
      try {
        const rows = await request(org, [...chunk])
        for (const waiter of theirs) waiter.resolve(rows.filter((row) => row.device_uuid === waiter.id))
      } catch (error) {
        for (const waiter of theirs) waiter.reject(error)
      }
    }
  }
  return (org: string, id: string) =>
    new Promise<AlertLimit[]>((resolve, reject) => {
      const waiters = pending.get(org)
      if (waiters) waiters.push({ id, resolve, reject })
      else {
        pending.set(org, [{ id, resolve, reject }])
        setTimeout(() => void flush(org), wait)
      }
    })
}

/**
 * The limits on what a panel draws. A limit applies to a source of the same device and
 * parameter; limits that differ only by device become one, naming the devices they
 * cover. Highest value first.
 */
export function panelLimits(
  sources: DashboardSource[],
  rows: AlertLimit[],
  deviceName: (uuid: string) => string,
): PanelLimit[] {
  const drawn = sources.filter(numeric)
  const merged = new Map<string, PanelLimit>()
  for (const row of rows) {
    const source = drawn.find((s) => s.device_uuid === row.device_uuid && s.parameter_uuid === row.parameter_uuid)
    if (!source) continue
    const { device_uuid, parameter_uuid: _parameter, ...shared } = row
    const key = JSON.stringify([shared.workflow_uuid, shared.state, shared.role, shared.operator, shared.value, shared.unit, shared.aggregate, shared.window_seconds, shared.held_seconds, shared.combined])
    const limit = merged.get(key) ?? { ...shared, key, devices: [], sameUnit: shared.unit === (source.unit ?? "") }
    if (!limit.devices.some((device) => device.uuid === device_uuid))
      limit.devices.push({ uuid: device_uuid, name: deviceName(device_uuid) })
    merged.set(key, limit)
  }
  return [...merged.values()].sort(
    (a, b) => b.value - a.value || a.workflow_name.localeCompare(b.workflow_name) || a.key.localeCompare(b.key),
  )
}

const SIGNS = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" } as const

/** "> 25 °C", or "clears < 20 °C" for the lower value of a hysteresis. */
export function comparisonText(limit: Pick<PanelLimit, "role" | "operator" | "value" | "unit">) {
  const value = `${formatNumber(limit.value)}${limit.unit ? ` ${limit.unit}` : ""}`
  return `${limit.role === "clear" ? "clears " : ""}${SIGNS[limit.operator]} ${value}`
}

/** How the reading is treated before it is compared: "10 s average", "for 5 min", "with other conditions". */
export function treatmentText(limit: Pick<PanelLimit, "aggregate" | "window_seconds" | "held_seconds" | "combined">) {
  const parts: string[] = []
  if (limit.aggregate && limit.window_seconds) {
    const span = formatDuration(limit.window_seconds)
    parts.push(limit.aggregate === "average" ? `${span} average` : `${limit.aggregate === "min" ? "minimum" : "maximum"} over ${span}`)
  }
  if (limit.held_seconds) parts.push(`for ${formatDuration(limit.held_seconds)}`)
  if (limit.combined) parts.push("with other conditions")
  return parts.join(" · ")
}

/** Up to three names, then a count: "Pump 1, Pump 2, Pump 3 and 2 more". */
export function deviceNames(devices: PanelLimit["devices"]) {
  const names = devices.map((device) => device.name).sort((a, b) => a.localeCompare(b))
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")
}

/**
 * The label on the line: the automation, the comparison and how the reading is
 * treated. On a panel of several devices a line that belongs to one names it; a line
 * several devices share does not.
 */
export function limitLabel(limit: PanelLimit, severalDevices: boolean) {
  const device = severalDevices && limit.devices.length === 1 ? ` · ${limit.devices[0].name}` : ""
  const treatment = treatmentText(limit)
  return `${limit.workflow_name} ${comparisonText(limit)}${device}${treatment ? ` · ${treatment}` : ""}`
}

/**
 * The limits to draw: running, in the panel's unit, and at most MAX_LIMIT_LINES, those
 * nearest the range of the drawn values first. The rest are listed in the legend only.
 */
export function drawnLimits(limits: PanelLimit[], range: { min: number; max: number } | null): PanelLimit[] {
  const candidates = limits.filter((limit) => limit.state === "running" && limit.sameUnit)
  if (candidates.length <= MAX_LIMIT_LINES) return candidates
  const distance = (value: number) => (range ? Math.max(range.min - value, value - range.max, 0) : 0)
  return [...candidates]
    .sort((a, b) => distance(a.value) - distance(b.value) || a.value - b.value || a.key.localeCompare(b.key))
    .slice(0, MAX_LIMIT_LINES)
}

/**
 * Why a limit has no line, in words for the legend; null when it is drawn.
 * `extent` is the chart's value axis, once known.
 */
export function limitNote(
  limit: PanelLimit,
  drawn: PanelLimit[],
  extent: { min: number; max: number } | null,
): string | null {
  if (limit.state === "suspended") return "suspended, not checking"
  if (!limit.sameUnit) return `not drawn: in ${limit.unit || "another unit"}`
  if (!drawn.includes(limit)) return "not drawn"
  if (extent && limit.value > extent.max) return "above the chart"
  if (extent && limit.value < extent.min) return "below the chart"
  return null
}
