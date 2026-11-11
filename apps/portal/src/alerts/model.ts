import type {
  Alert,
  AlertKind,
  AlertSource,
  NotificationEvent,
  WorkflowAlert,
} from "@iot-os/api-client";
import { formatAge } from "@iot-os/ui/lib/format";
import { statusOf } from "@iot-os/ui/lib/status";
import { formatDuration, subjectId } from "../devices/model";

type Titled =
  | Pick<WorkflowAlert, "kind" | "workflow_name" | "device_name">
  | { kind: Exclude<AlertKind, "workflow">; subject: { name: string } };

/**
 * Workflow name plus the device, unless the name already carries it (geofence workflows embed
 * the device); a connectivity alert reads as its kind and subject ("Device offline — Freezer 2").
 */
export function alertTitle(alert: Titled) {
  if (alert.kind !== "workflow") return `${kindLabel(alert.kind)} — ${alert.subject.name}`;
  const device = alert.device_name?.trim();
  return device && !alert.workflow_name.toLowerCase().includes(device.toLowerCase())
    ? `${alert.workflow_name} — ${device}`
    : alert.workflow_name;
}

/** The kinds the alerts list filters on, in menu order. */
export const alertKinds: AlertKind[] = ["workflow", "device_offline", "gateway_offline", "connection_lost"];
export const kindLabel = (kind: AlertKind) => statusOf(kind, "alert_kind").label;

/** What the alert's condition reads as: a connectivity alert that monitoring ended is Stopped, not Cleared. */
export const alertCondition = (alert: Pick<Alert, "condition" | "stopped_reason">) =>
  alert.condition === "active" ? "active" : alert.stopped_reason ? "stopped" : "cleared";

/** Why a connectivity alert opened, and why it ended when monitoring stopped it. */
export function alertCause(alert: Pick<Alert, "cause" | "stopped_reason">) {
  const cause = alert.cause ? statusOf(alert.cause, "offline_cause").label : null;
  const stop = alert.stopped_reason ? statusOf(alert.stopped_reason, "offline_stop").label : null;
  return [cause, stop && `stopped: ${stop.toLowerCase()}`].filter(Boolean).join(" · ");
}

/** "15 min, automatic" or "1 h, set"; null when no threshold was in effect (still learning). */
export function thresholdText(alert: Pick<Alert, "threshold_seconds" | "threshold_automatic">) {
  if (alert.threshold_seconds === null) return null;
  return `${formatDuration(alert.threshold_seconds)}${alert.threshold_automatic ? ", automatic" : ", set"}`;
}

/** How an automatic threshold came about, in words. */
export function thresholdSource(
  alert: Pick<Alert, "threshold_automatic" | "reporting_interval_seconds" | "poll_interval_seconds">,
) {
  if (!alert.threshold_automatic) return "Set on the device or its profile";
  const reporting = alert.reporting_interval_seconds;
  const poll = alert.poll_interval_seconds;
  const from = reporting
    ? `3 × ${formatDuration(reporting)} reporting interval${poll ? ` + ${formatDuration(poll)} poll` : ""}`
    : "3 × reporting interval + poll interval";
  return `Automatic: ${from}, at least 15 min`;
}

/** "Active for 5 d" or "Cleared after 4 min"; the bare condition when a time is missing. */
export function alertDuration(
  alert: Pick<Alert, "activated_at" | "cleared_at">,
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
  // The page keeps kind=…&kind=…; the API takes a repeated kind[].
  query.delete("kind");
  for (const kind of kindsOf(params)) query.append("kind[]", kind);
  return query;
}

/** The kinds in the page URL, known values only. */
export const kindsOf = (params: URLSearchParams) =>
  params.getAll("kind").filter((kind): kind is AlertKind => alertKinds.includes(kind as AlertKind));

/**
 * One key per source, as grouped by the alerts API: a workflow and its device, or a
 * connectivity kind and its subject.
 */
export function sourceKey(item: Alert | AlertSource): string {
  const alert = "latest" in item ? item.latest : item;
  return alert.kind === "workflow"
    ? `${alert.workflow_uuid}|${alert.device_uuid}`
    : `${alert.kind}|${alert.subject.type}:${subjectId(alert.subject)}`;
}

/**
 * The alerts filters that find every occurrence of a connectivity alert's source. The API
 * filters by device, so a gateway or connection alert is found through a device it lists;
 * callers keep the alerts whose subject matches (`sameSubject`).
 */
export function subjectQuery(alert: Pick<Alert, "kind" | "device_uuid" | "devices">) {
  const device = alert.device_uuid ?? alert.devices[0]?.uuid;
  const query = new URLSearchParams();
  query.append("kind[]", alert.kind);
  if (device) query.set("device", device);
  return query;
}
export const sameSubject = (alert: Alert, other: Alert) =>
  alert.kind === other.kind &&
  (alert.kind === "workflow" || other.kind === "workflow"
    ? alert.workflow_uuid === other.workflow_uuid && alert.device_uuid === other.device_uuid
    : subjectId(alert.subject) === subjectId(other.subject) && alert.subject.type === other.subject.type);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Alert ids are UUIDs; any other path segment cannot name an alert, so there is nothing to ask the API. */
export const isAlertId = (value: string) => UUID.test(value);

/** Event log vocabulary matches alerts: an event needs attention while Active, otherwise it is Cleared. */
export function eventState(event: Pick<NotificationEvent, "status" | "active">) {
  return event.status === "firing" && event.active ? "Active" : "Cleared";
}

/**
 * Notification center links used tab=preferences and status=resolved. Preferences now live in
 * Settings → Email preferences; everything else carries its filters into the event log.
 */
export function legacyNotificationPath(org: string, params: URLSearchParams) {
  if (params.get("tab") === "preferences") return `/organizations/${encodeURIComponent(org)}/settings/email`;
  const query = new URLSearchParams(params);
  query.delete("tab");
  if (query.get("status") === "resolved") query.set("status", "cleared");
  return `/organizations/${encodeURIComponent(org)}/alerts/events${query.size ? `?${query}` : ""}`;
}
