import type { AlertSubject, ConnectivityCause, ConnectivityKind } from "./alerts"

/** Stays connected: a death certificate or silence counts. Connects to report: only silence counts. */
export type ConnectionStyle = "stays_connected" | "connects_to_report"

/**
 * Where the runtime's connectivity tracker has a device (spec 018): `waiting` for its first
 * report, `learning` its reporting interval, `monitored`, `pending` (offline within the grace
 * period), `offline`, `recovering` (back within the grace period), `interrupted` by the
 * platform, or `disabled`. `inactive` when the device has no applied configuration, `unknown`
 * when the runtime could not be asked.
 */
export type ConnectivityState =
  | "waiting"
  | "learning"
  | "monitored"
  | "pending"
  | "offline"
  | "recovering"
  | "interrupted"
  | "disabled"
  | "inactive"
  | "unknown"

/** A device's offline-alert settings as they apply now. */
export type ConnectivitySettings = {
  enabled: boolean
  style: ConnectionStyle
  /** Null: automatic, from the reporting and poll intervals. */
  offline_after_seconds: number | null
  grace_seconds: number
  severity: "critical" | "warning" | "info"
  /** The adapter's poll interval; null when the device is not polled. */
  poll_interval_seconds: number | null
}

/** Where each setting comes from: the platform default, automatic, or the device adapter (style). */
export type ConnectivitySource = "default" | "automatic" | "adapter" | "profile" | "device"

/** The open connectivity alert concerning a device or gateway. */
export type OfflineAlert = {
  uuid: string
  kind: ConnectivityKind
  cause: ConnectivityCause | null
  /** When the offline condition began. */
  since: string | null
  /** A gateway alert names the gateway the device is offline behind; null if its record is gone. */
  subject: AlertSubject | null
}

/** What the runtime reports about one device's connectivity; times are receipt times. */
export type ConnectivityRuntimeState = {
  state: ConnectivityState
  monitoring_since: string | null
  last_heard_at: string | null
  last_observed_at: string | null
  /** Silence is counted from this time when it is later than the last report. */
  anchor_at: string | null
  /** Median gap between observed times; null until two gaps are known. */
  reporting_interval_seconds: number | null
  readings_counted: number | null
  poll_interval_seconds: number | null
  offline_after_seconds: number | null
  offline_after_automatic: boolean | null
  /** Its gateway's open alert covers it. */
  suppressed_by_gateway: boolean | null
  /** Why monitoring is interrupted: the platform's broker connection, or the adapter restarting. */
  interruption: "connection" | "adapter" | null
  /** Waiting, and last seen before monitoring started. */
  before_monitoring: boolean | null
}

/** GET devices/{device}/connectivity (read-only until spec 018 pull request 3). */
export type DeviceConnectivity = {
  effective: ConnectivitySettings
  inherited_from: {
    enabled: ConnectivitySource
    style: ConnectivitySource
    offline_after_seconds: ConnectivitySource
    grace_seconds: ConnectivitySource
    severity: ConnectivitySource
  }
  /** Devices fed by a device adapter always connect to report. */
  style_locked: { reason: "adapter" } | null
  state: ConnectivityRuntimeState
  alert: OfflineAlert | null
}
