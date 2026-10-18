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
