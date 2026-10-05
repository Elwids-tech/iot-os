export type NotificationSource = "workflow" | "service" | "watchdog"
export type NotificationLevel = "critical" | "warning" | "info" | "recovery"
export type NotificationPreferences = {
  revision: number
  email_enabled: boolean
  operations_access: boolean
  grid: Record<NotificationSource, Record<NotificationLevel, boolean>>
}
export type NotificationEvent = {
  uuid: string
  source: NotificationSource
  severity: Exclude<NotificationLevel, "recovery">
  status: "firing" | "resolved"
  active: boolean
  title: string
  summary: string
  service: string | null
  environment: string | null
  link: string | null
  labels: Record<string, string> | null
  occurred_at: string
  last_seen_at: string
  occurrences: number
}
export type NotificationEventsPage = {
  data: NotificationEvent[]
  summary: Record<Exclude<NotificationLevel, "recovery">, number> & { resolved: number }
  meta: { current_page: number; last_page: number; total: number }
}
