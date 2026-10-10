export type DashboardBand = { label: string; color: string };
export type DashboardThreshold = DashboardBand & { value: number };
export type DashboardSource = {
  device_uuid: string;
  parameter_uuid: string;
  device_name?: string;
  label: string;
  unit: string | null;
  data_type: string;
  format?: string | null;
  display_widget?: string | null;
  precision: number | null;
  color: string;
  base: DashboardBand;
  thresholds: DashboardThreshold[];
};
export type StatusWidgetSource = DashboardSource;
export type DashboardControlColumns = "auto" | 1 | 2 | 3 | 4;
export type StatusWidgetConfig = {
  sources: DashboardSource[];
  workflow_uuid?: string;
  location_device_uuids?: string[];
  geofence_uuid?: string;
  show_trails?: boolean;
  show_labels?: boolean;
  trail_window?: import("./geospatial").TrailWindow;
  columns?: DashboardControlColumns;
  /** Gauge scale; required for gauge panels, min < max. */
  min?: number;
  max?: number;
  /** Text panel body, plain text up to 4000 characters; rendered as text, never HTML. */
  text?: string;
  /** Device health panel devices, up to 50; device_name is set by the server. */
  devices?: { device_uuid: string; device_name?: string }[];
  /** Consumption bars: "auto" picks a size from the range. Calendar periods choose their own. */
  bucket?: ConsumptionBucket;
  /** Consumption window: the dashboard range, or a calendar period in each device's time zone. */
  period?: ConsumptionPeriod;
};
export type ConsumptionBucket = "auto" | "15m" | "1h" | "1d" | "1w" | "1mo";
export type ConsumptionPeriod = "dashboard" | "today" | "7d" | "month" | "12mo";
export type DashboardWidget = {
  id: string;
  schema_version: 2;
  type:
    | "status"
    | "timeseries"
    | "controls"
    | "state_history"
    | "color_history"
    | "location"
    | "alerts"
    | "gauge"
    | "table"
    | "text"
    | "device_health"
    | "consumption";
  title: string;
  description: string;
  config: StatusWidgetConfig;
};
export type DashboardRange =
  | { mode: "relative"; preset: "15m" | "1h" | "6h" | "24h" | "7d" | "30d" }
  | { mode: "absolute"; from: string; to: string };
export type DashboardView = {
  range: DashboardRange;
  timezone: "browser" | "utc";
  refresh: 0 | 5 | 10 | 30 | 60;
};
export type DashboardLayout = Partial<
  Record<
    string,
    ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>
  >
>;
export type Dashboard = {
  uuid: string;
  name: string;
  widgets: DashboardWidget[];
  layouts: DashboardLayout;
  defaults: DashboardView;
  revision: number;
  /** Up to 10 tags, 1 to 32 characters each. */
  tags: string[];
  folder: string | null;
  /** Per-user preference; toggled with starDashboard. */
  starred: boolean;
  /** Per-user; recorded by the server when the dashboard is opened. */
  last_viewed_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};
/** tags and folder are optional on update; omitted values keep what is stored. */
export type DashboardInput = Pick<
  Dashboard,
  "name" | "widgets" | "layouts" | "defaults"
> &
  Partial<Pick<Dashboard, "tags" | "folder">>;
export type DashboardRevisionSummary = {
  revision: number;
  name: string;
  widget_count: number;
  updated_by_name: string | null;
  created_at: string;
};
export type DashboardRevision = DashboardRevisionSummary &
  Pick<Dashboard, "widgets" | "layouts" | "defaults" | "tags" | "folder">;

export interface WorkflowLocationOverview {
  workflow_uuid: string;
  workflow_name: string;
  deployment_status: string;
  operation_uuid: string | null;
  snapshot: null | {
    evaluated_at: string;
    device_uuid: string;
    configuration_uuid: string;
    max_age_seconds: number;
    geometry: { type: string; coordinates: number[][][] };
    fix: null | {
      status: string;
      reason: string;
      event_id: string;
      observed_at: string | null;
      received_at: string | null;
      historical: boolean;
      live_eligible: boolean;
      timestamp_source: string;
      point: {
        latitude: number;
        longitude: number;
        accuracy_metres: number | null;
      } | null;
    };
    execution: {
      enabled: boolean;
      stopped_reason: string | null;
      updated_at: string;
      consumer_healthy: boolean;
      state: {
        last_event_id: string;
        condition: string;
        active: boolean;
        expires_at: string | null;
        evaluated_at: string;
      };
    };
  };
}
export interface WorkflowAlertOverview {
  workflow_uuid: string;
  workflow_name: string;
  checked_at: string;
  active: number;
  unacknowledged_active: number;
  total: number;
  recent: {
    uuid: string;
    episode: number;
    activated_at: string;
    cleared_at: string | null;
    acknowledged_at: string | null;
  }[];
}
