export type NotificationSource = "workflow" | "service" | "watchdog"
export type NotificationLevel = "critical" | "warning" | "info" | "recovery"
export type NotificationPreferences = {
  revision: number
  email_enabled: boolean
  /** Support ticket emails (spec 015); on unless switched off. Older payloads omit it. */
  ticket_email?: boolean
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
  /** Active counts by severity and by type; `resolved` counts clear notices. */
  summary: Record<Exclude<NotificationLevel, "recovery">, number> & { resolved: number; sources: Record<NotificationSource, number> }
  meta: { current_page: number; last_page: number; total: number }
}

/** Push alerts (spec 033): personal settings that apply across organizations. */
export type PushLevels = Record<NotificationLevel, boolean>
export type PushDevice = {
  uuid: string
  /** For example "Safari on iPhone". */
  label: string
  created_at: string
  last_reached_at: string | null
  last_failed_at: string | null
}
export type PushSettings = {
  /** False when the deployment has no push key; hide every push control. */
  available: boolean
  /** The key browsers subscribe with (`applicationServerKey`); null when unavailable. */
  public_key: string | null
  enabled: boolean
  /** Null until push was first turned on. */
  levels: PushLevels | null
  revision: number
  organizations: { uuid: string; name: string; enabled: boolean }[]
  devices: PushDevice[]
}
export type PushSettingsInput = { revision: number; enabled: boolean; levels: PushLevels }
/** A browser's push subscription, as `PushSubscription.toJSON()` gives it, plus a label. */
export type PushDeviceRegistration = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  content_encoding?: "aes128gcm" | "aesgcm"
  label?: string
}
export type PushDeviceRegistered = { uuid: string; label: string; replaced: { label: string } | null }
export type PushSyncResult = { status: "mine" | "released" | "unknown"; uuid: string | null }
export type PushTestResult = { status: "accepted" | "gone" | "failed" }
