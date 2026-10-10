import { lazy, Suspense } from "react"
import type { DashboardView, DashboardWidget } from "@iot-os/api-client"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusPanel } from "./StatusPanel"
import { ControlsPanel } from "./ControlsPanel"
import { LocationPanel, AlertsPanel } from "./WorkflowPanels"
import {
  DeviceHealthPanel,
  GaugePanel,
  TablePanel,
  TextPanel,
} from "./ReadoutPanels"
import { PANEL_LABELS } from "./model"
const TimeSeriesPanel = lazy(() => import("./TimeSeriesPanel"))
const StateHistoryPanel = lazy(() => import("./StateHistoryPanel"))
const ColorHistoryPanel = lazy(() => import("./ColorHistoryPanel"))
const ConsumptionPanel = lazy(() => import("./ConsumptionPanel"))

/**
 * mode: "latest" panels ignore the time range; "range" panels follow it.
 * editor: "parameter-panel" picks device parameters; the others have their own settings.
 * group: section in the Add panel picker.
 */
export const widgetRegistry = {
  status: {
    label: PANEL_LABELS.status,
    group: "Live values",
    mode: "latest",
    description: "Latest values with threshold bands and age.",
    editor: "parameter-panel",
    version: 2,
    renderer: StatusPanel,
  },
  gauge: {
    label: PANEL_LABELS.gauge,
    group: "Live values",
    mode: "latest",
    description: "Up to four values on a scale with bands.",
    editor: "parameter-panel",
    version: 2,
    renderer: GaugePanel,
  },
  table: {
    label: PANEL_LABELS.table,
    group: "Live values",
    mode: "latest",
    description: "Latest values of any type in rows.",
    editor: "parameter-panel",
    version: 2,
    renderer: TablePanel,
  },
  controls: {
    label: PANEL_LABELS.controls,
    group: "Live values",
    mode: "latest",
    description: "Set writable parameters and follow reported state.",
    editor: "parameter-panel",
    version: 2,
    renderer: ControlsPanel,
  },
  device_health: {
    label: PANEL_LABELS.device_health,
    group: "Live values",
    mode: "latest",
    description: "Presence and last seen for chosen devices.",
    editor: "devices",
    version: 2,
    renderer: DeviceHealthPanel,
  },
  timeseries: {
    label: PANEL_LABELS.timeseries,
    group: "Over time",
    mode: "range",
    description: "Numeric history, several same-unit series.",
    editor: "parameter-panel",
    version: 2,
    renderer: TimeSeriesPanel,
  },
  consumption: {
    label: PANEL_LABELS.consumption,
    group: "Over time",
    mode: "range",
    description: "Counter usage per hour, day or month, with meter resets handled.",
    editor: "parameter-panel",
    version: 2,
    renderer: ConsumptionPanel,
  },
  state_history: {
    label: PANEL_LABELS.state_history,
    group: "Over time",
    mode: "range",
    description: "Time spent in boolean or enum states.",
    editor: "parameter-panel",
    version: 2,
    renderer: StateHistoryPanel,
  },
  color_history: {
    label: PANEL_LABELS.color_history,
    group: "Over time",
    mode: "range",
    description: "Reported colours as a timeline strip.",
    editor: "parameter-panel",
    version: 2,
    renderer: ColorHistoryPanel,
  },
  location: {
    label: PANEL_LABELS.location,
    group: "Workflow",
    mode: "latest",
    description: "GPS devices, movement trails and an optional geofence.",
    editor: "location-panel",
    version: 2,
    renderer: LocationPanel,
  },
  alerts: {
    label: PANEL_LABELS.alerts,
    group: "Workflow",
    mode: "latest",
    description: "Active conditions and recent episodes.",
    editor: "workflow-panel",
    version: 2,
    renderer: AlertsPanel,
  },
  text: {
    label: PANEL_LABELS.text,
    group: "Notes",
    mode: "latest",
    description: "Plain text such as a runbook step.",
    editor: "text",
    version: 2,
    renderer: TextPanel,
  },
} as const satisfies Record<DashboardWidget["type"], unknown>

export type PanelProps = {
  preview?: boolean
  org: string
  widget: DashboardWidget
  view: DashboardView
  window: { from: string; to: string }
  onZoom?: (from: string, to: string) => void
  simulation?: { source: string; value: number }
  /** Status panels: per-viewer choice from the panel menu. */
  display?: "cells" | "table"
  /** Time series: draw the previous period as ghost lines. */
  compare?: boolean
}
export function PanelBody(props: PanelProps) {
  const Renderer = widgetRegistry[props.widget.type]?.renderer
  return Renderer ? (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Renderer {...props} />
    </Suspense>
  ) : (
    <p>Unsupported panel type.</p>
  )
}
