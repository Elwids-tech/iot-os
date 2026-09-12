import { lazy, Suspense } from "react"
import type { DashboardView, DashboardWidget } from "@iot-os/api-client"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusPanel } from "./StatusPanel"

const TimeSeriesPanel = lazy(() => import("./TimeSeriesPanel"))
export const widgetRegistry = {
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
} as const

export type PanelProps = {
  org: string
  widget: DashboardWidget
  view: DashboardView
  window: { from: string; to: string }
  refreshToken: number
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
