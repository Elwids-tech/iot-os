export type WorkflowAlert = {
  uuid: string;
  workflow_uuid: string;
  workflow_name: string;
  operation_uuid: string;
  device_uuid: string;
  /** Null when the device record is gone. */
  device_name: string | null;
  episode: number;
  condition: "active" | "cleared";
  activated_at: string | null;
  cleared_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
  acknowledged_by_name: string | null;
  assignee: { id: number; name: string } | null;
  assigned_at: string | null;
  execution_stopped_reason: string | null;
};
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
/** GET alerts?group=source: one row per workflow and device, counted over the filtered alerts. */
export type WorkflowAlertSource = {
  workflow_uuid: string;
  device_uuid: string;
  occurrences: number;
  unacknowledged: number;
  active: number;
  first_activated_at: string | null;
  last_activated_at: string | null;
  latest: WorkflowAlert;
};
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
  workflow: { uuid: string; name: string };
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
};
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
