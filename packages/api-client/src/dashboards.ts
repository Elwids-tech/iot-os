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
};
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
    | "alerts";
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
  created_at: string;
  updated_at: string;
};
export type DashboardInput = Pick<
  Dashboard,
  "name" | "widgets" | "layouts" | "defaults"
>;

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
