export type DashboardBand = { label: string; color: string }
export type DashboardThreshold = DashboardBand & { value: number }
export type DashboardSource = {
  device_uuid: string
  parameter_uuid: string
  device_name?: string
  label: string
  unit: string | null
  data_type: string
  precision: number | null
  color: string
  base: DashboardBand
  thresholds: DashboardThreshold[]
}
export type StatusWidgetSource = DashboardSource
export type StatusWidgetConfig = { sources: DashboardSource[] }
export type DashboardWidget = {
  id: string
  schema_version: 2
  type: "status" | "timeseries"
  title: string
  description: string
  config: StatusWidgetConfig
}
export type DashboardRange =
  | { mode: "relative"; preset: "15m" | "1h" | "6h" | "24h" | "7d" | "30d" }
  | { mode: "absolute"; from: string; to: string }
export type DashboardView = {
  range: DashboardRange
  timezone: "browser" | "utc"
  refresh: 0 | 5 | 10 | 30 | 60
}
export type DashboardLayout = Partial<
  Record<
    string,
    ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>
  >
>
export type Dashboard = {
  uuid: string
  name: string
  widgets: DashboardWidget[]
  layouts: DashboardLayout
  defaults: DashboardView
  revision: number
  created_at: string
  updated_at: string
}
export type DashboardInput = Pick<
  Dashboard,
  "name" | "widgets" | "layouts" | "defaults"
>
