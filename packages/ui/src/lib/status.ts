import type { StatusTone } from "@iot-os/ui/components/status-mark"

export type Status = { tone: StatusTone; label: string }

/**
 * The product's status vocabulary: one raw value reads the same on every page.
 * Add new values here instead of a local map. "pending" is always info, and a
 * mark carries one concept; freshness belongs in its own Freshness column.
 */
const vocabulary: Record<string, Status> = {
  // Presence
  online: { tone: "good", label: "Online" },
  offline: { tone: "critical", label: "Offline" },
  unseen: { tone: "muted", label: "Not seen yet" },
  unknown: { tone: "muted", label: "Connection unknown" },
  // Lifecycle
  registered: { tone: "muted", label: "Registered" },
  active: { tone: "good", label: "Active" },
  deactivated: { tone: "muted", label: "Deactivated" },
  archived: { tone: "muted", label: "Archived" },
  // Configuration and deployment
  idle: { tone: "muted", label: "Not configured" },
  pending: { tone: "info", label: "Pending" },
  applied: { tone: "good", label: "Applied" },
  suspended: { tone: "warning", label: "Suspended" },
  failed: { tone: "critical", label: "Failed" },
  inactive: { tone: "muted", label: "Inactive" },
  ready: { tone: "good", label: "Ready" },
  provisioning: { tone: "muted", label: "Not provisioned" },
  succeeded: { tone: "good", label: "Succeeded" },
  answered: { tone: "good", label: "Answered" },
  refused: { tone: "warning", label: "Refused" },
  unavailable: { tone: "warning", label: "Unavailable" },
  // Adapter runtimes
  queued: { tone: "info", label: "Queued" },
  running: { tone: "good", label: "Running" },
  activated: { tone: "good", label: "Activated" },
  // Reading quality
  good: { tone: "good", label: "Good" },
  stale: { tone: "warning", label: "Stale" },
  invalid: { tone: "critical", label: "Invalid" },
  // Ingest
  stored: { tone: "good", label: "Stored" },
  decoded: { tone: "muted", label: "Decoded" },
  storage_retry: { tone: "warning", label: "Storage retry" },
  handoff_failed: { tone: "critical", label: "Handoff failed" },
  discarded: { tone: "muted", label: "Discarded" },
  duplicate: { tone: "muted", label: "Duplicate" },
  // Discovery
  approved: { tone: "good", label: "Approved" },
  rejected: { tone: "muted", label: "Ignored" },
  // Invitations
  accepted: { tone: "good", label: "Accepted" },
  revoked: { tone: "muted", label: "Revoked" },
  // Commands
  prepared: { tone: "muted", label: "Prepared" },
  sent: { tone: "commanded", label: "Sent" },
  observed: { tone: "good", label: "Confirmed" },
  already_at_target: { tone: "good", label: "Already set" },
  timed_out: { tone: "critical", label: "Timed out" },
  uncertain: { tone: "warning", label: "Uncertain" },
  expired: { tone: "muted", label: "Expired" },
  cancelled: { tone: "muted", label: "Cancelled" },
}

/** Where the same raw value means something else. */
const domains = {
  /** Automation deployments: an applied revision is what users call active. */
  automation: { applied: { tone: "good", label: "Active" } },
  /** Notification and webhook deliveries: sent is the finished state. */
  delivery: {
    sent: { tone: "good", label: "Sent" },
    delivered: { tone: "good", label: "Delivered" },
  },
  /** Support tickets (spec 015): open work is info, waiting on the reporter is a warning. */
  ticket: {
    new: { tone: "info", label: "New" },
    in_review: { tone: "info", label: "In review" },
    needs_info: { tone: "warning", label: "Needs information" },
    planned: { tone: "muted", label: "Planned" },
    in_progress: { tone: "info", label: "In progress" },
    resolved: { tone: "good", label: "Resolved" },
    declined: { tone: "muted", label: "Declined" },
  },
  /** Device adapter sources (spec 020): whether vendor data is arriving. */
  source: {
    connected: { tone: "good", label: "Connected" },
    disconnected: { tone: "critical", label: "Disconnected" },
    receiving: { tone: "good", label: "Receiving" },
    no_deliveries: { tone: "muted", label: "No deliveries yet" },
    rejecting: { tone: "warning", label: "Rejecting" },
    idle: { tone: "muted", label: "Idle" },
    polling: { tone: "good", label: "Polling" },
    retrying: { tone: "warning", label: "Retrying" },
    stopped: { tone: "critical", label: "Stopped" },
    not_deployed: { tone: "muted", label: "Not deployed" },
  },
  /** Adapter setup checklist steps. */
  checklist: {
    done: { tone: "good", label: "Done" },
    waiting: { tone: "info", label: "Waiting" },
    attention: { tone: "warning", label: "Needs attention" },
    todo: { tone: "muted", label: "Not started" },
  },
  /** Adapter poll runs. */
  poll_run: {
    ok: { tone: "good", label: "OK" },
    empty: { tone: "muted", label: "No new records" },
    partial: { tone: "warning", label: "Partial" },
    retrying: { tone: "warning", label: "Retrying" },
    stopped: { tone: "critical", label: "Stopped" },
  },
  /** Adapter deliveries: their kind and outcome. */
  ingest: {
    sample: { tone: "info", label: "Sample" },
    preview: { tone: "muted", label: "Device preview" },
    rejected: { tone: "warning", label: "Rejected" },
    failed: { tone: "critical", label: "Failed" },
    accepted: { tone: "good", label: "Accepted" },
    unauthenticated: { tone: "critical", label: "Unauthenticated" },
    stale_signature: { tone: "critical", label: "Stale or replayed signature" },
    too_large: { tone: "warning", label: "Too large" },
    rate_limited: { tone: "warning", label: "Rate limited" },
    paused: { tone: "muted", label: "Paused" },
    broker_unavailable: { tone: "warning", label: "Broker unavailable" },
    bad_request: { tone: "warning", label: "Bad request" },
    decoded: { tone: "good", label: "Decoded" },
    decode_failed: { tone: "critical", label: "Decode failed" },
    validation_failed: { tone: "critical", label: "Profile validation failed" },
    duplicate: { tone: "muted", label: "Duplicate" },
    historical: { tone: "muted", label: "Historical" },
  },
  /** Adapter webhook secrets. */
  secret: {
    active: { tone: "good", label: "Active" },
    expiring: { tone: "warning", label: "Expiring" },
    expired: { tone: "muted", label: "Expired" },
    revoked: { tone: "muted", label: "Revoked" },
  },
  /** Support ticket priority, set by the team. */
  priority: {
    low: { tone: "muted", label: "Low" },
    normal: { tone: "muted", label: "Normal" },
    high: { tone: "warning", label: "High" },
    urgent: { tone: "critical", label: "Urgent" },
  },
} satisfies Record<string, Record<string, Status>>

export type StatusDomain = keyof typeof domains

/** Every shared value, for the design system gallery. */
export const statusVocabulary: Readonly<Record<string, Status>> = vocabulary

/** "storage_retry" → "Storage retry". */
export const humanize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ")

/** Tone and label for a raw status value; unknown values read as muted, humanized text. */
export function statusOf(
  value: string | null | undefined,
  domain?: StatusDomain,
): Status {
  const key = (value ?? "").trim().toLowerCase()
  const scoped: Record<string, Status> | undefined = domain && domains[domain]
  return (
    scoped?.[key] ??
    vocabulary[key] ?? { tone: "muted", label: key ? humanize(key) : "Unknown" }
  )
}
