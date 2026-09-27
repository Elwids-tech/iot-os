/** Short age of a timestamp: "4 s", "19 min", "2 h", "3 d". Future times read as "0 s". */
export function formatAge(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ""
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86400)} d`
}

/** Locale number with exactly `precision` decimals when given (profile display.precision), up to 3 otherwise. */
export function formatNumber(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return ""
  return value.toLocaleString(undefined, {
    minimumFractionDigits: precision ?? 0,
    maximumFractionDigits: precision ?? 3,
  })
}

/** Date and 24 h time without the zone name; show the zone once per page instead. */
export function formatDateTime(
  iso: string,
  timezone: "browser" | "utc" = "browser",
): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ""
  return new Date(time).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: timezone === "utc" ? "UTC" : undefined,
  })
}
