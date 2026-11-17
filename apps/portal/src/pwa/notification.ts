/**
 * How the service worker shows a push (spec 033, contracts/push-payload.md). Pure, so
 * Vitest renders every case of `contracts/push/v1/alert-push.v1.cases.json` through it.
 *
 * A push carries names and a link only. Anything this version does not understand shows
 * a generic notification that opens the app, so an older worker never stays silent.
 */
export type AlertPush = {
  v: 1
  kind: "activated" | "cleared" | "summary" | "test"
  organization: { uuid: string; name: string } | null
  alert: { uuid: string; severity: "critical" | "warning" | "info"; automation: string; device: string | null } | null
  occurred_at: string
  count: number | null
  url: string
}

export type ShownNotification = {
  title: string
  options: {
    body: string
    tag: string
    icon: string
    badge: string
    data: { url: string }
    renotify: false
  }
}

const ICON = "/pwa-192x192.png"
const BADGE = "/pwa-64x64.png"
const severities = { critical: "Critical", warning: "Warning", info: "Info" } as const

/** The only places a notification may open: the portal's own pages. */
export function safePath(url: unknown): string {
  return typeof url === "string" && /^\/(organizations|settings)\//.test(url) && !url.startsWith("//") ? url : "/"
}

const text = (value: unknown) => (typeof value === "string" ? value : "")
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null)

/** Hours and minutes in the phone's own zone and locale, with the date when it is not today. */
export function shortTime(at: string, now: Date, locale?: string, timeZone?: string): string {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return ""
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
  const sameDay = day(when) === day(now)
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  }).format(when)
}

const shown = (title: string, body: string, tag: string, url: string): ShownNotification => ({
  title,
  options: { body, tag, icon: ICON, badge: BADGE, data: { url: safePath(url) }, renotify: false },
})

export const fallbackNotification = (): ShownNotification => shown("New alerts", "Open the app to see them.", "unknown", "/")

export function toNotification(payload: unknown, now: Date, locale?: string, timeZone?: string): ShownNotification {
  const push = record(payload)
  if (!push || push.v !== 1) return fallbackNotification()
  const organization = record(push.organization)
  const alert = record(push.alert)
  const at = shortTime(text(push.occurred_at), now, locale, timeZone)
  const url = text(push.url)
  switch (push.kind) {
    case "activated":
    case "cleared": {
      if (!alert || !organization) return fallbackNotification()
      const severity = severities[alert.severity as keyof typeof severities] ?? "Alert"
      const cleared = push.kind === "cleared"
      const device = text(alert.device)
      const body = [device, `${cleared ? "Cleared" : "Activated"} ${at}`.trim(), text(organization.name)].filter(Boolean).join(" · ")
      return shown(`${cleared ? "Cleared" : severity} · ${text(alert.automation)}`, body, `alert-${text(alert.uuid)}`, url)
    }
    case "summary": {
      if (!organization) return fallbackNotification()
      const count = Math.max(1, Math.trunc(Number(push.count) || 1))
      return shown(
        count === 1 ? "1 more alert" : `${count} more alerts`,
        [text(organization.name), at && `since ${at}`].filter(Boolean).join(" · "),
        `summary-${text(organization.uuid)}`,
        url,
      )
    }
    case "test":
      return shown("Push is on", "This device will get your alerts.", "test", url)
    default:
      return fallbackNotification()
  }
}
