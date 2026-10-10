/** Tenant-safe summary of the shared device runtime (GET runtime-status). */
export type RuntimeStatus = {
  state: "operational" | "degraded" | "unavailable"
  live_data: "available" | "unavailable"
  automations: "running" | "delayed" | "paused" | "unknown"
  automation_fault: "checkpoint_continuity" | "start_failed" | null
  since: string | null
  checked_at: string
}

/** What needs attention across the organization (GET overview). */
export type OrganizationOverview = {
  devices: Record<"active" | "online" | "offline" | "unknown" | "registered" | "deactivated" | "silent", number>
  alerts: {
    active: number
    active_unacknowledged: number
    unacknowledged: number
    last_24_hours: number
    latest_active: { uuid: string; workflow_name: string | null; device_name: string | null; activated_at: string | null; acknowledged: boolean }[]
  }
  automations: Partial<Record<"inactive" | "pending" | "applied" | "failed" | "suspended", number>>
  discovery: { pending: number }
  commands: {
    uncertain: number
    recent: { uuid: string; device_name: string | null; status: string; created_at: string | null }[]
  }
}
