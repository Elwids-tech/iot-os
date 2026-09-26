import { lazy, Suspense } from "react"
import type { DashboardView, DashboardWidget } from "@iot-os/api-client"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusPanel } from "./StatusPanel"
import { ControlsPanel } from "./ControlsPanel"

import { LocationPanel, AlertsPanel } from "./WorkflowPanels"
const TimeSeriesPanel = lazy(() => import("./TimeSeriesPanel"))
const StateHistoryPanel = lazy(() => import("./StateHistoryPanel"))
const ColorHistoryPanel = lazy(() => import("./ColorHistoryPanel"))

export const widgetRegistry = {
  location: {label: "Location", mode: "latest", description: "Paired location, geofence outline and workflow condition.", editor: "workflow-panel", version: 2, renderer: LocationPanel},
  alerts: {label: "Alerts", mode: "latest", description: "Active conditions, acknowledgements and recent workflow episodes.", editor: "workflow-panel", version: 2, renderer: AlertsPanel},
  controls: {
    label: "Controls",
    mode: "latest",
    description: "Set writable device parameters and follow reported state.",
    editor: "parameter-panel",
    version: 2,
    renderer: ControlsPanel,
  },
  status: {
    label: "Status",
    mode: "latest",
    description:
      "Latest values, receipt timestamps, and per-parameter threshold bands.",
    editor: "parameter-panel",
    version: 2,
    renderer: StatusPanel,
  },
  timeseries: {
    label: "Time series",
    mode: "range",
    description:
      "Explore numeric measurements over time, with multiple same-unit series.",
    editor: "parameter-panel",
    version: 2,
    renderer: TimeSeriesPanel,
  },
  state_history: {
    label: "State history",
    mode: "range",
    description:
      "Compare time spent in boolean or enum states and inspect state changes.",
    editor: "parameter-panel",
    version: 2,
    renderer: StateHistoryPanel,
  },
  color_history: {
    label: "Colour history",
    mode: "range",
    description:
      "Inspect reported colour values as an actual-colour chronological strip.",
    editor: "parameter-panel",
    version: 2,
    renderer: ColorHistoryPanel,
  },
} as const

export type PanelProps = {
  preview?: boolean
  org: string
  widget: DashboardWidget
  view: DashboardView
  window: { from: string; to: string }
  onZoom?: (from: string, to: string) => void
  simulation?: { source: string; value: number }
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
