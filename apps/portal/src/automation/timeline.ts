export type EvidenceValue = { known: boolean; value: unknown; reason?: string; observed_at?: string; expires_at?: string; token?: string; window?: string }
export type TimelineStep = {
  node_id: string; node_type: string; status: string; reason: string; event_note?: string;
  inputs: Record<string, EvidenceValue>; outputs: Record<string, EvidenceValue>;
  config: Record<string, unknown>; intent_ids?: string[];
  binding?: { role: string; device_name?: string; device_uuid: string; unit?: string; parameter_label?: string };
}
export type TimelineAction = {
  id: string; node_id?: string; kind?: string; status: string; diagnostic?: string;
  binding?: string; value?: unknown; device_name?: string; device_uuid?: string; parameter_label?: string;
  requested_at?: string; accepted_at?: string; dispatch_authorized_at?: string; updated_at?: string;
  command?: { uuid: string; status: string; sent_at?: string; confirmed_at?: string; completed_at?: string; diagnostic?: string } | null;
}
export type Evaluation = {
  id: string; operation_uuid: string; at: string; trigger: string; outcome: string;
  generation: number; draft_revision: number; diagnostic?: string; node_count: number; trace_truncated: boolean;
  source?: { device_uuid: string; device_name?: string; event_id: string; configuration_uuid: string; generation: number } | null;
  intent_ids: string[]; trace?: TimelineStep[]; actions?: TimelineAction[];
}
export const outcomeLabels: Record<string, string> = { evaluated: "No action requested", triggered: "Action requested", waiting: "Waiting for evidence", suspended: "Execution suspended" }
export const stepLabels: Record<string, string> = { evaluated: "Evaluated", triggered: "Action requested", waiting: "Waiting", matched: "True", not_matched: "False", suppressed: "Suppressed" }

export function evidenceText(value: EvidenceValue): string {
  if (!value.known) return `Unknown · ${value.reason || "no usable reading"}`
  return typeof value.value === "string" ? value.value : JSON.stringify(value.value) ?? "Unknown"
}

export function actionLabel(action: TimelineAction): string {
  const status = action.command?.status
  if (status) return ({ confirmed: "Device confirmed", already_at_target: "Already at target", observed: "Target state observed", sent: "Sent · awaiting device", dispatching: "Sending", pending: "Queued for device", prepared: "Queued for device", uncertain: "Delivery uncertain", timed_out: "Delivery uncertain", failed: "Command failed", rejected: "Device rejected", cancelled: "Cancelled", expired: "Expired" } as Record<string, string>)[status] ?? status
  return ({ awaiting_dispatch: "Awaiting action worker", accepted: "Accepted for processing", dispatched: "Dispatch authorized", observed_at_target: "Target state observed", succeeded: "Completed", failed: "Failed", suppressed: "Suppressed", cancelled: "Cancelled", expired: "Expired", uncertain: "Delivery uncertain" } as Record<string, string>)[action.status] ?? action.status
}

export function actionStages(action: TimelineAction): { label: string; at: string }[] {
  const stages = [
    { label: "Action requested", at: action.requested_at },
    { label: "Accepted by action worker", at: action.accepted_at },
    { label: "Command approved", at: action.command?.confirmed_at },
    { label: "Dispatch authorized", at: action.dispatch_authorized_at },
    { label: "Sent to device", at: action.command?.sent_at },
  ].filter((stage): stage is { label: string; at: string } => Boolean(stage.at))
  if (action.command?.completed_at) stages.push({ label: actionLabel(action), at: action.command.completed_at })
  else if (!action.command && action.updated_at && !["accepted", "dispatched", "awaiting_dispatch"].includes(action.status)) stages.push({ label: actionLabel(action), at: action.updated_at })
  return stages
}
