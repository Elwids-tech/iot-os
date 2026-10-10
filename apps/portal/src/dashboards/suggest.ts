import type {
  DashboardSource,
  DashboardWidget,
  DeviceDetail,
  DeviceProfileParameter,
} from "@iot-os/api-client"
import { writableParameters } from "../controls/model"
import { isColorParameter } from "../history/model"
import { appliedParameters, COLORS, NEUTRAL, PANEL_LABELS, newWidget } from "./model"
import { displayRange, visualizationHint } from "./profileDisplay"

export type PanelType = DashboardWidget["type"]

/** A device parameter considered for a panel. */
export type Candidate = {
  device: { uuid: string; name: string }
  parameter: DeviceProfileParameter
  /** Mapped for commands in the applied configuration. */
  writable: boolean
}

export type Suggestion = { type: PanelType; reason: string }

/** Panel types that show device parameters, in gallery order. */
export const PARAMETER_PANELS: PanelType[] = [
  "status",
  "gauge",
  "timeseries",
  "table",
  "controls",
  "state_history",
  "color_history",
]
/** Panel types configured without device parameters. */
export const OTHER_PANELS: PanelType[] = ["device_health", "location", "alerts", "text"]

const numeric = (p: DeviceProfileParameter) => p.data_type === "number" || p.data_type === "integer"
const stateful = (p: DeviceProfileParameter) => p.data_type === "boolean" || p.data_type === "enum"
const unitOf = (p: DeviceProfileParameter) => p.unit ?? ""

const HINTS: Record<string, PanelType> = {
  stat: "status",
  state: "status",
  gauge: "gauge",
  meter: "gauge",
  timeseries: "timeseries",
  consumption: "timeseries",
  state_timeline: "state_history",
  table: "table",
  color: "color_history",
  control: "controls",
}

/** Why a panel type cannot show these parameters, or null when it can. */
export function incompatibility(type: PanelType, candidates: Candidate[]): string | null {
  if (OTHER_PANELS.includes(type)) return "Configured without device parameters."
  if (!candidates.length) return null
  const parameters = candidates.map((c) => c.parameter)
  switch (type) {
    case "gauge":
      if (!parameters.every(numeric)) return "Needs numeric parameters."
      return parameters.length > 4 ? "Shows up to 4 parameters." : null
    case "timeseries":
      if (!parameters.every(numeric)) return "Needs numeric parameters."
      return new Set(parameters.map(unitOf)).size > 1 ? "Needs parameters with one unit." : null
    case "state_history":
      return parameters.every(stateful) ? null : "Needs boolean or enum parameters."
    case "color_history":
      return parameters.every(isColorParameter) ? null : "Needs colour parameters."
    case "controls":
      return candidates.every((c) => c.writable) ? null : "Needs writable parameters."
    default:
      return null
  }
}

/**
 * Panel types for these parameters, best first. Deterministic: the profile's
 * own hint wins for a single parameter, then rules by data type, kind, unit
 * and display range.
 */
export function suggestPanels(candidates: Candidate[]): Suggestion[] {
  if (!candidates.length) return []
  const parameters = candidates.map((c) => c.parameter)
  const ranked: Suggestion[] = []
  const add = (type: PanelType, reason: string) => {
    if (!ranked.some((s) => s.type === type) && !incompatibility(type, candidates))
      ranked.push({ type, reason })
  }
  const single = parameters.length === 1 ? parameters[0] : null
  const hint = single ? HINTS[visualizationHint(single) ?? ""] : undefined
  if (hint) add(hint, "Suggested by the device profile.")
  if (candidates.every((c) => c.writable))
    add("controls", single ? "Writable, so it can be changed from the dashboard." : "All writable, so they can be changed from the dashboard.")
  if (parameters.every(isColorParameter)) {
    add("status", "Shows the current colour.")
    add("color_history", "Shows colour changes over time.")
  } else if (parameters.every(stateful)) {
    add("status", single ? "Shows the current state with its label." : "Shows each current state with its label.")
    add("state_history", "Shows time spent in each state.")
  } else if (parameters.every(numeric)) {
    const ranges = parameters.map(displayRange)
    const ranged = ranges.every(Boolean)
    const oneUnit = new Set(parameters.map(unitOf)).size === 1
    const counter = parameters.every((p) => p.kind === "counter")
    if (single) {
      if (ranged && !counter) {
        const range = ranges[0]!
        add("gauge", `Profile range ${range.min}–${range.max}${single.unit ? " " + single.unit : ""}.`)
      }
      add("status", counter ? "Shows the running total now." : "Shows the current value and how fresh it is.")
      add("timeseries", "Follows the dashboard time range.")
    } else {
      if (oneUnit) add("timeseries", "One unit, so a single chart compares them.")
      add("status", "Shows each current value.")
      if (ranged && oneUnit && !counter) add("gauge", "Ranges come from the profile.")
    }
  }
  add("table", "Lists every value in rows.")
  add("status", "Shows each current value.")
  return ranked
}

/** A dashboard source for a device parameter, as the panel editor builds it. */
export function sourceFor(
  device: { uuid: string; name: string },
  parameter: DeviceProfileParameter,
  index: number,
): DashboardSource {
  return {
    device_uuid: device.uuid,
    parameter_uuid: parameter.uuid,
    device_name: device.name,
    label: parameter.label,
    unit: parameter.unit,
    data_type: parameter.data_type,
    format: parameter.format,
    display_widget: typeof parameter.display?.widget === "string" ? parameter.display.widget : null,
    precision: null,
    color: COLORS[index % COLORS.length],
    base: { ...NEUTRAL },
    thresholds: [],
  }
}

/** A new panel of this type for the candidates, with profile defaults applied. */
export function panelFor(type: PanelType, candidates: Candidate[]): DashboardWidget {
  const widget = newWidget(type)
  if (OTHER_PANELS.includes(type)) return widget
  const sources = candidates.map((c, index) => sourceFor(c.device, c.parameter, index))
  const devices = new Set(candidates.map((c) => c.device.uuid))
  const title =
    candidates.length === 1
      ? candidates[0].parameter.label
      : devices.size === 1
        ? `${candidates[0].device.name} · ${PANEL_LABELS[type]}`
        : PANEL_LABELS[type]
  const config = { ...widget.config, sources }
  if (type === "gauge") {
    const ranges = candidates.map((c) => displayRange(c.parameter)).filter((r) => r !== null)
    if (ranges.length) {
      config.min = Math.min(...ranges.map((r) => r.min))
      config.max = Math.max(...ranges.map((r) => r.max))
    }
  }
  return { ...widget, title, config }
}

/**
 * Candidates for a panel's existing sources. When a device has not loaded yet,
 * the source's saved type and unit stand in for its profile parameter.
 */
export function candidatesFor(
  sources: DashboardSource[],
  device: (uuid: string) => DeviceDetail | undefined,
): Candidate[] {
  return sources.map((source) => {
    const detail = device(source.device_uuid)
    const parameter =
      appliedParameters(detail).find((p) => p.uuid === source.parameter_uuid) ??
      ({
        uuid: source.parameter_uuid,
        key: source.parameter_uuid,
        label: source.label,
        kind: "measurement",
        data_type: source.data_type,
        unit: source.unit,
        format: source.format ?? null,
        reports_state: true,
        accepts_command: false,
        display: source.display_widget ? { widget: source.display_widget } : null,
      } as DeviceProfileParameter)
    return {
      device: { uuid: source.device_uuid, name: source.device_name ?? detail?.name ?? "" },
      parameter,
      writable: writableParameters(detail).some((p) => p.uuid === source.parameter_uuid),
    }
  })
}

