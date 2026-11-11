/** What raised an alert: an automation, or device connectivity monitoring (spec 018). */
export type AlertKind = "workflow" | "device_offline" | "gateway_offline" | "connection_lost";
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertDevice = { uuid: string; name: string };
/** What a device connectivity alert is about. */
export type AlertSubject = { type: "device" | "gateway" | "adapter"; uuid: string; name: string };

/** Why a device connectivity alert opened (spec 018). */
export type ConnectivityCause = "death_certificate" | "missed_check_in" | "gateway_offline" | "source_disconnected";
/** Why monitoring ended an open connectivity alert; such an alert reads as cleared. */
/** `device_moved`: the platform ended it when its device moved to another organization (spec 031). */
export type ConnectivityStopReason = "device_deactivated" | "monitoring_disabled" | "definition_removed" | "device_moved";
export type ConnectivityKind = Exclude<AlertKind, "workflow">;

/** Fields every alert has. The connectivity fields are null (false, 0) on automation alerts. */
type AlertBase = {
  uuid: string;
  /** Automation alerts are always `warning`; connectivity alerts take their device's severity. */
  severity: AlertSeverity;
  episode: number;
  /** A stopped connectivity alert is `cleared` with `stopped_reason` set. */
  condition: "active" | "cleared";
  activated_at: string | null;
  cleared_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
  acknowledged_by_name: string | null;
  assignee: { id: number; name: string } | null;
  assigned_at: string | null;
  /** The devices the alert concerns, at most 100 by name; `devices_total` counts them all. */
  devices: AlertDevice[];
  devices_total: number;
  /** The subject device's site; for a gateway, the site all its listed devices share. */
  site: { uuid: string; name: string; timezone: string } | null;
  cause: ConnectivityCause | null;
  /** When the offline condition began (receipt time). */
  offline_since: string | null;
  /** When the platform last heard from the subject (receipt time). */
  last_seen_at: string | null;
  /** The observed time of the device's newest reading, as the device or vendor reported it. */
  last_observed_at: string | null;
  /** The Offline after in effect when the alert opened; null while it was still learning. */
  threshold_seconds: number | null;
  /** The threshold came from the reporting and poll intervals rather than a setting. */
  threshold_automatic: boolean | null;
  reporting_interval_seconds: number | null;
  poll_interval_seconds: number | null;
  grace_seconds: number | null;
  stopped_reason: ConnectivityStopReason | null;
  /** Opened while its subject was muted (spec 018 pull request 3). */
  muted: boolean;
  /** Opened while its subject was flapping, so nobody was notified. */
  held: boolean;
  held_count: number;
};
export type WorkflowAlert = AlertBase & {
  /** Automation alerts; device connectivity alerts are the other `AlertKind`s. */
  kind: "workflow";
  workflow_uuid: string;
  workflow_name: string;
  operation_uuid: string;
  device_uuid: string;
  /** Null when the device record is gone. */
  device_name: string | null;
  execution_stopped_reason: string | null;
  subject: null;
};
/** A device, gateway or adapter connection that went offline (spec 018). */
export type ConnectivityAlert = AlertBase & {
  kind: ConnectivityKind;
  workflow_uuid: null;
  workflow_name: null;
  operation_uuid: null;
  /** The subject device of a device alert; null for gateway and connection alerts. */
  device_uuid: string | null;
  device_name: string | null;
  execution_stopped_reason: null;
  subject: AlertSubject;
};
/** One alert episode of any kind, as GET alerts lists it. */
export type Alert = WorkflowAlert | ConnectivityAlert;
export type AlertComment = {
  uuid: string;
  body: string;
  created_by: number;
  author_name: string;
  created_at: string;
};
export type AlertDelivery = {
  uuid: string;
  recipient_id: number;
  recipient_name: string;
  type: "activated" | "cleared";
  status: string;
  attempts: number;
  retry_generation: number;
  history: { attempt: number; status: string; created_at: string }[];
  sent_at: string | null;
  diagnostic: string | null;
};
export type AlertPage<T> = {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
};
/** GET alerts?group=source: one row per source, counted over the filtered alerts. */
type AlertSourceCounts = {
  occurrences: number;
  unacknowledged: number;
  active: number;
  first_activated_at: string | null;
  last_activated_at: string | null;
};
/** A workflow on one device. */
export type WorkflowAlertSource = AlertSourceCounts & {
  kind: "workflow";
  workflow_uuid: string;
  device_uuid: string;
  latest: WorkflowAlert;
};
/** A connectivity kind and its subject (device, gateway or adapter). */
export type ConnectivityAlertSource = AlertSourceCounts & {
  kind: ConnectivityKind;
  workflow_uuid: null;
  device_uuid: string | null;
  latest: ConnectivityAlert;
};
export type AlertSource = WorkflowAlertSource | ConnectivityAlertSource;
/** Listed alerts (all must belong to the organization), or every unacknowledged alert of one source. */
export type AlertAcknowledgement =
  | { alert_uuids: string[] }
  | {
      workflow_uuid: string;
      device_uuid: string;
      condition?: "active" | "cleared";
      assignee?: number;
    };

/** One alert transition a person received as a recipient: their bell (spec 022). Names are as they were when it arrived. */
export type AlertNotification = {
  /** UUIDv7: sorts by time, so the newest id is also a cursor. */
  id: string;
  transition: "activated" | "cleared";
  occurred_at: string;
  created_at: string;
  read_at: string | null;
  /** `condition` is the alert's condition now. */
  alert: { uuid: string; episode: number; condition: "active" | "cleared" };
  kind: AlertKind;
  /** Null for automation alerts. */
  subject: AlertSubject | null;
  /** Null for device connectivity alerts. */
  workflow: { uuid: string; name: string } | null;
  /** Null when the alert has no bound device or it was not found. */
  device: { uuid: string; name: string } | null;
};
export type AlertNotificationPage = {
  data: AlertNotification[];
  meta: { current_page: number; last_page: number; total: number; unread: number };
};
/** Polled by the bell: a newer `newest_unread_activation_id` than the last one seen is a new alert. */
export type AlertNotificationSummary = {
  unread: number;
  newest_unread_activation_id: string | null;
};
/** Exactly one: chosen notifications, every one up to the newest shown, or every one for an alert. */
export type AlertNotificationReadInput = { ids: string[] } | { up_to: string } | { alert_uuid: string };

export type NotificationRecipient = {
  id: number;
  name: string;
  email?: string;
};
export type NotificationSettings = {
  workflow_name: string;
  workflow_kind: WorkflowKind;
  revision: number;
  enabled: boolean;
  notify_on_clear: boolean;
  recipient_ids: number[];
  recipients: NotificationRecipient[];
};

export type WorkflowDeploymentStatus =
  | "inactive"
  | "pending"
  | "applied"
  | "failed"
  | "suspended";
/** Fields of GET workflows and workflows/{uuid} used for activate and disable. */
export type AutomationWorkflow = {
  uuid: string;
  name: string;
  draft_revision: number;
  deployment_generation: number;
  deployment_status: WorkflowDeploymentStatus;
  applied_deployment_uuid: string | null;
  pending_operation_uuid: string | null;
  /** Set while archived: off, read-only and left out of lists unless asked for. Older APIs omit it. */
  archived_at?: string | null;
  archived_by?: import("./archive").ArchivedBy | null;
};
/** What the signed-in person may do with an organization's automations (Workflow.*). */
export type AutomationCapabilities = { view: boolean; manage: boolean; activate: boolean };
/** DAG automations (schema v2) or geofence workflows (v1). */
export type WorkflowKind = "automation" | "geofence";
/** A row of GET workflows. `kind=all` lists DAG automations next to geofence workflows. */
export type WorkflowListItem = AutomationWorkflow & { kind: WorkflowKind };
export type WorkflowDeployment = {
  uuid: string;
  generation: number;
  draft_revision: number;
  target: "active" | "inactive";
  status: "pending" | "succeeded" | "failed";
  stopped_reason: string | null;
  diagnostic: string | null;
  created_at: string;
  completed_at: string | null;
};
export type WorkflowDeploymentInput = {
  /** Reuse the same UUID when retrying the same request. */
  operation_uuid: string;
  target_state: "active" | "inactive";
  draft_revision: number;
  expected_generation: number;
};
