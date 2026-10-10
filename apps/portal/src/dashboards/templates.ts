import type {
  DashboardInput,
  DashboardLayout,
  DashboardSource,
  DashboardWidget,
  DeviceDetail,
  DeviceProfileParameter,
  StatusWidgetConfig,
} from "@iot-os/api-client"
import { controlSpec, writableParameters } from "../controls/model"
import { isColorSource } from "../history/model"
import {
  appendLayout,
  appliedParameters,
  COLORS,
  NEUTRAL,
  numeric,
  PANEL_LABELS,
} from "./model"

// Snapshots from the server may carry a type this build does not know.
export const panelLabel = (type: DashboardWidget["type"]) =>
  PANEL_LABELS[type] ?? type

type Pair = [DeviceDetail, DeviceProfileParameter]

/** Same source shape the panel editor creates when a parameter is added. */
function sources(pairs: Pair[]): DashboardSource[] {
  return pairs.map(([device, parameter], index) => ({
    device_uuid: device.uuid,
    parameter_uuid: parameter.uuid,
    device_name: device.name,
    label: parameter.label,
    unit: parameter.unit,
    data_type: parameter.data_type,
    format: parameter.format,
    display_widget:
      typeof parameter.display?.widget === "string"
        ? parameter.display.widget
        : null,
    precision: null,
    color: COLORS[index % COLORS.length],
    base: { ...NEUTRAL },
    thresholds: [],
  }))
}

function panel(
  id: string,
  type: DashboardWidget["type"],
  title: string,
  pairs: Pair[],
  config: Omit<StatusWidgetConfig, "sources"> = {},
): DashboardWidget {
  return {
    id,
    schema_version: 2,
    type,
    title,
    description: "",
    config: { sources: sources(pairs), ...config },
  }
}

function byKeys(devices: DeviceDetail[], keys: string[]): Pair[] {
  return devices.flatMap((device) => {
    const parameters = appliedParameters(device)
    return keys.flatMap((key): Pair[] => {
      const parameter = parameters.find((p) => p.key === key)
      return parameter ? [[device, parameter]] : []
    })
  })
}

function controllable(devices: DeviceDetail[]): Pair[] {
  return devices.flatMap((device) =>
    writableParameters(device)
      .filter((parameter) => controlSpec(parameter).kind !== "unsupported")
      .map((parameter): Pair => [device, parameter]),
  )
}

// Panels without data are dropped; device health needs devices, not sources.
const usable = (widgets: DashboardWidget[]) =>
  widgets.filter(
    (w) => w.config.sources.length || w.config.devices?.length,
  )

export type DashboardTemplate = {
  id: string
  name: string
  creates: string
  needs: string
  build: (devices: DeviceDetail[]) => DashboardWidget[]
}

const PHASES = ["voltage.l1", "voltage.l2", "voltage.l3"]
const ENERGY = ["energy.imported", "energy.exported"]
const POSITION = ["location.latitude", "location.longitude", "location.accuracy"]

export const TEMPLATES: DashboardTemplate[] = [
  {
    id: "energy",
    name: "Three-phase energy meter",
    creates: "Status and time series for phase voltage, gauge for average voltage, energy status and use per period",
    needs: "Voltage L1 to L3, average voltage, imported and exported energy",
    build: (devices) =>
      usable([
        panel("phase-status", "status", "Phase voltage", byKeys(devices, PHASES)),
        panel("phase-chart", "timeseries", "Phase voltage", byKeys(devices, PHASES)),
        panel(
          "average-gauge",
          "gauge",
          "Average voltage",
          byKeys(devices, ["voltage.average"]).slice(0, 4),
          { min: 0, max: 300 },
        ),
        panel("energy-status", "status", "Energy", byKeys(devices, ENERGY)),
        // Energy counters read as usage per period; a panel compares up to 4.
        panel("energy-usage", "consumption", "Energy use", byKeys(devices, ENERGY).slice(0, 4), {
          bucket: "auto",
          period: "dashboard",
        }),
      ]),
  },
  {
    id: "gps",
    name: "GPS tracking",
    creates: "Status for position, table of trackers, device health",
    needs: "Latitude, longitude and GPS accuracy",
    build: (devices) =>
      usable([
        panel("position", "status", "Position", byKeys(devices, POSITION)),
        panel("trackers", "table", "Trackers", byKeys(devices, POSITION)),
        healthPanel(devices, "Tracker health"),
      ]),
  },
  {
    id: "rgb",
    name: "RGB light controls",
    creates: "Controls, state history, colour history",
    needs: "Writable power, mode, brightness or colour",
    build: (devices) => {
      const states = devices.flatMap((device) =>
        appliedParameters(device)
          .filter((p) => p.kind === "state")
          .map((p): Pair => [device, p]),
      )
      return usable([
        panel("light-controls", "controls", "Light", controllable(devices), {
          columns: "auto",
        }),
        panel(
          "light-states",
          "state_history",
          "Power and mode",
          states.filter(([, p]) => ["boolean", "enum"].includes(p.data_type)),
        ),
        panel(
          "light-colour",
          "color_history",
          "Colour",
          states.filter(([device, p]) => isColorSource(sources([[device, p]])[0])),
        ),
      ])
    },
  },
  {
    id: "health",
    name: "Device health",
    creates: "Device health for the chosen devices",
    needs: "Any device",
    build: (devices) => usable([healthPanel(devices, "Device health")]),
  },
]

function healthPanel(devices: DeviceDetail[], title: string): DashboardWidget {
  return panel(`health-${title}`, "device_health", title, [], {
    devices: devices
      .slice(0, 50)
      .map((d) => ({ device_uuid: d.uuid, device_name: d.name })),
  })
}

/**
 * A status panel per parameter group, a time series per group and unit
 * (charts need one unit), consumption for counters (up to 4 per panel), and
 * one controls panel for writable parameters.
 * `groupOf` maps a parameter uuid to its profile group label.
 */
export function profilePanels(
  devices: DeviceDetail[],
  groupOf: (parameter: string) => string | undefined,
): DashboardWidget[] {
  const groups = new Map<string, Pair[]>()
  for (const device of devices)
    for (const parameter of appliedParameters(device)) {
      const group = groupOf(parameter.uuid) ?? ""
      groups.set(group, [...(groups.get(group) ?? []), [device, parameter]])
    }
  const widgets: DashboardWidget[] = []
  for (const [group, pairs] of groups) {
    widgets.push(
      panel(`status-${group}`, "status", group || "Latest values", pairs),
    )
    const units = new Map<string, Pair[]>()
    const counters = new Map<string, Pair[]>()
    for (const pair of pairs)
      if (numeric(pair[1])) {
        const byUnit = pair[1].kind === "counter" ? counters : units
        byUnit.set(pair[1].unit ?? "", [...(byUnit.get(pair[1].unit ?? "") ?? []), pair])
      }
    for (const [unit, list] of units)
      widgets.push(
        panel(
          `chart-${group}-${unit}`,
          "timeseries",
          `${group || "Trend"}${unit ? ` (${unit})` : ""}`,
          list,
        ),
      )
    for (const [unit, list] of counters)
      for (let start = 0; start < list.length; start += 4)
        widgets.push(
          panel(
            `usage-${group}-${unit}-${start}`,
            "consumption",
            `${group || "Usage"}${unit ? ` (${unit})` : ""}${list.length > 4 ? ` ${start / 4 + 1}` : ""}`,
            list.slice(start, start + 4),
            { bucket: "auto", period: "dashboard" },
          ),
        )
  }
  return usable([
    ...widgets,
    panel("controls", "controls", "Controls", controllable(devices), {
      columns: "auto",
    }),
  ])
}

/** Fresh panel ids and a desktop layout in panel order. */
export function withLayout(
  widgets: DashboardWidget[],
): Pick<DashboardInput, "widgets" | "layouts"> {
  let layouts: DashboardLayout = {}
  const placed = widgets.map((widget) => {
    const id = crypto.randomUUID()
    layouts = appendLayout(layouts, id)
    return { ...widget, id }
  })
  return { widgets: placed, layouts }
}
