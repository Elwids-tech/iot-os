export type WorkflowAlert = {
  uuid: string;
  workflow_uuid: string;
  workflow_name: string;
  operation_uuid: string;
  device_uuid: string;
  episode: number;
  condition: "active" | "cleared";
  activated_at: string | null;
  cleared_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
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
