import type { NotificationEvent, WorkflowAlert } from "@iot-os/api-client";
import { formatAge } from "@iot-os/ui/lib/format";

/** Workflow name plus the device, unless the name already carries it (geofence workflows embed the device). */
export function alertTitle(alert: Pick<WorkflowAlert, "workflow_name" | "device_name">) {
  const device = alert.device_name?.trim();
  return device && !alert.workflow_name.toLowerCase().includes(device.toLowerCase())
    ? `${alert.workflow_name} — ${device}`
    : alert.workflow_name;
}

/** "Active for 5 d" or "Cleared after 4 min"; the bare condition when a time is missing. */
export function alertDuration(
  alert: Pick<WorkflowAlert, "activated_at" | "cleared_at">,
  now = Date.now(),
) {
  if (!alert.cleared_at)
    return alert.activated_at ? `Active for ${formatAge(alert.activated_at, now)}` : "Active";
  return alert.activated_at
    ? `Cleared after ${formatAge(alert.activated_at, Date.parse(alert.cleared_at))}`
    : "Cleared";
}

export type AlertCondition = "active" | "cleared" | "all";
/** The list shows active alerts unless the URL asks for cleared or all. */
export function conditionOf(params: URLSearchParams): AlertCondition {
  const value = params.get("condition");
  return value === "cleared" || value === "all" ? value : "active";
}

/** Alerts API filters for the page URL: the condition default applied and "assignee=me" resolved to the signed-in user. */
export function alertQuery(params: URLSearchParams, me?: number) {
  const query = new URLSearchParams(params);
  query.delete("view");
  const condition = conditionOf(params);
  if (condition === "all") query.delete("condition");
  else query.set("condition", condition);
  query.delete("assignee");
  if (params.get("assignee") === "me" && me !== undefined) query.set("assignee", String(me));
  return query;
}

/** One key per workflow and device, as grouped by the alerts API. */
export const sourceKey = (alert: Pick<WorkflowAlert, "workflow_uuid" | "device_uuid">) =>
  `${alert.workflow_uuid}|${alert.device_uuid}`;

/** Event log vocabulary matches alerts: an event needs attention while Active, otherwise it is Cleared. */
export function eventState(event: Pick<NotificationEvent, "status" | "active">) {
  return event.status === "firing" && event.active ? "Active" : "Cleared";
}

/** Notification center links used tab=preferences and status=resolved; carry their filters into the event log. */
export function legacyNotificationPath(org: string, params: URLSearchParams) {
  const tab = params.get("tab") === "preferences" ? "preferences" : "events";
  const query = new URLSearchParams(params);
  query.delete("tab");
  if (query.get("status") === "resolved") query.set("status", "cleared");
  if (tab === "preferences") for (const key of ["source", "severity", "status", "search", "page"]) query.delete(key);
  return `/organizations/${encodeURIComponent(org)}/alerts/${tab}${query.size ? `?${query}` : ""}`;
}
