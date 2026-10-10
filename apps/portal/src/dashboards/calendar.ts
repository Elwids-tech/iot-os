import type { ConsumptionBucket, ConsumptionPeriod, CounterBucket } from "@iot-os/api-client"

/**
 * Calendar arithmetic in an IANA time zone, matching the runtime's buckets:
 * days, weeks (from Monday) and months start at local midnight in the
 * device's zone; 15-minute and hourly buckets follow the local clock.
 */
type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

function parts(ms: number, timezone: string): Wall {
  let format = formatters.get(timezone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
    formatters.set(timezone, format)
  }
  const values: Record<string, string> = {}
  for (const part of format.formatToParts(new Date(ms))) values[part.type] = part.value
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday] ?? 0,
  }
}

/** Local wall clock minus UTC at this instant, in milliseconds. */
function offset(ms: number, timezone: string) {
  const wall = parts(ms, timezone)
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(ms / 1000) * 1000
}

/** The instant of a local date and time; days and months may overflow, as in Date.UTC. */
function instant(year: number, month: number, day: number, timezone: string) {
  const local = Date.UTC(year, month - 1, day)
  const guess = local - offset(local, timezone)
  // A second pass settles instants near a daylight-saving change.
  return local - offset(guess, timezone)
}

/** Start of the bucket that contains this instant. */
export function bucketStart(ms: number, bucket: CounterBucket, timezone: string): number {
  const wall = parts(ms, timezone)
  const intoMinute = wall.second * 1000 + (((ms % 1000) + 1000) % 1000)
  switch (bucket) {
    case "15m":
      return ms - (wall.minute % 15) * MINUTE - intoMinute
    case "1h":
      return ms - wall.minute * MINUTE - intoMinute
    case "1d":
      return instant(wall.year, wall.month, wall.day, timezone)
    case "1w":
      return instant(wall.year, wall.month, wall.day - wall.weekday, timezone)
    case "1mo":
      return instant(wall.year, wall.month, 1, timezone)
    default:
      return instant(wall.year, 1, 1, timezone)
  }
}

/** Moves a bucket start by whole buckets (negative to go back). */
export function addBuckets(start: number, bucket: CounterBucket, count: number, timezone: string): number {
  if (bucket === "15m") return start + count * 15 * MINUTE
  if (bucket === "1h") return start + count * HOUR
  const wall = parts(start, timezone)
  if (bucket === "1d") return instant(wall.year, wall.month, wall.day + count, timezone)
  if (bucket === "1w") return instant(wall.year, wall.month, wall.day + 7 * count, timezone)
  if (bucket === "1mo") return instant(wall.year, wall.month + count, 1, timezone)
  return instant(wall.year + count, 1, 1, timezone)
}

/** Bucket starts that cover [from, to), at most `limit`. */
export function bucketStarts(from: number, to: number, bucket: CounterBucket, timezone: string, limit = 2000) {
  const starts: number[] = []
  for (let at = bucketStart(from, bucket, timezone); at < to && starts.length < limit; at = addBuckets(at, bucket, 1, timezone))
    starts.push(at)
  return starts
}

/** Bars for a dashboard range: about 4 to 60 of them. */
export function autoBucket(span: number): CounterBucket {
  if (span <= 2 * HOUR) return "15m"
  if (span <= 2 * DAY) return "1h"
  if (span <= 62 * DAY) return "1d"
  if (span <= 180 * DAY) return "1w"
  return "1mo"
}

/** Too many bars to read; the panel falls back to automatic bars. */
export const MAX_BARS = 120

/** The bucket for a panel's setting, never more than MAX_BARS over the span. */
export function effectiveBucket(setting: ConsumptionBucket | undefined, span: number): { bucket: CounterBucket; coarsened: boolean } {
  if (!setting || setting === "auto") return { bucket: autoBucket(span), coarsened: false }
  const approximate = { "15m": 15 * MINUTE, "1h": HOUR, "1d": DAY, "1w": 7 * DAY, "1mo": 30 * DAY }[setting]
  return span / approximate > MAX_BARS ? { bucket: autoBucket(span), coarsened: true } : { bucket: setting, coarsened: false }
}

export const PERIOD_LABELS: Record<ConsumptionPeriod, string> = {
  dashboard: "Dashboard time range",
  today: "Today",
  "7d": "Last 7 days",
  month: "This month",
  "12mo": "Last 12 months",
}

/**
 * A calendar period in the device's zone. The window runs to the end of the
 * period, so the axis keeps its shape; the runtime counts only up to now.
 */
export function periodWindow(period: Exclude<ConsumptionPeriod, "dashboard">, now: number, timezone: string) {
  if (period === "today") {
    const from = bucketStart(now, "1d", timezone)
    return { from, to: addBuckets(from, "1d", 1, timezone), bucket: "1h" as const }
  }
  if (period === "7d") {
    const today = bucketStart(now, "1d", timezone)
    return { from: addBuckets(today, "1d", -6, timezone), to: addBuckets(today, "1d", 1, timezone), bucket: "1d" as const }
  }
  const month = bucketStart(now, "1mo", timezone)
  if (period === "month") return { from: month, to: addBuckets(month, "1mo", 1, timezone), bucket: "1d" as const }
  return { from: addBuckets(month, "1mo", -11, timezone), to: addBuckets(month, "1mo", 1, timezone), bucket: "1mo" as const }
}

/** Short axis label for a bucket start in the zone it was cut in. */
export function bucketLabel(start: number, bucket: CounterBucket, timezone: string, withDate = false): string {
  const options: Intl.DateTimeFormatOptions =
    bucket === "15m" || bucket === "1h"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(withDate ? { month: "short", day: "numeric" } : {}) }
      : bucket === "1d"
        ? { month: "short", day: "numeric" }
        : bucket === "1w"
          ? { month: "short", day: "numeric" }
          : bucket === "1mo"
            ? { month: "short", year: "numeric" }
            : { year: "numeric" }
  const label = new Date(start).toLocaleString(undefined, { ...options, timeZone: timezone })
  return bucket === "1w" ? `Week of ${label}` : label
}

/** Full name of a bucket for tooltips and tables, such as "Thu, Oct 9, 2026". */
export function bucketTitle(start: number, bucket: CounterBucket, timezone: string): string {
  const format = (ms: number, options: Intl.DateTimeFormatOptions) =>
    new Date(ms).toLocaleString(undefined, { ...options, timeZone: timezone })
  if (bucket === "15m" || bucket === "1h") {
    const time = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const
    const end = addBuckets(start, bucket, 1, timezone)
    return `${format(start, { weekday: "short", month: "short", day: "numeric" })}, ${format(start, time)}–${format(end, time)}`
  }
  if (bucket === "1d") return format(start, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  if (bucket === "1w") return `Week of ${format(start, { month: "short", day: "numeric", year: "numeric" })}`
  if (bucket === "1mo") return format(start, { month: "long", year: "numeric" })
  return format(start, { year: "numeric" })
}

/** A stable key for a calendar bucket in its zone: "2026-10-09" or "2026-10". */
export function calendarKey(start: number, bucket: CounterBucket, timezone: string): string {
  const date = new Date(start).toLocaleDateString("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
  return bucket === "1mo" ? date.slice(0, 7) : bucket === "1y" ? date.slice(0, 4) : date
}
