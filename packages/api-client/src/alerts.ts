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

export type NotificationRecipient = {
  id: number;
  name: string;
  email?: string;
};
export type NotificationSettings = {
  workflow_name: string;
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
