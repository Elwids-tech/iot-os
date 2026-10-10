import type { ConsumptionPeriod, CounterBucket } from "@iot-os/api-client"
import { addBuckets, bucketLabel, bucketStart, bucketStarts, bucketTitle, calendarKey } from "./calendar"
import type { ConsumptionData } from "./panelData"

export type ConsumptionValue = { value: number; partial: boolean; resets: number; samples: number }

export type ConsumptionModel = {
  bucket: CounterBucket
  categories: { key: string; label: string; title: string; start: number; end: number }[]
  /** Per source, in source order; null when that source has not loaded. */
  series: (null | {
    values: (ConsumptionValue | null)[]
    total: number
    resets: number
    unit: string | null
    timezone: string
  })[]
  zones: string[]
  coarsened: boolean
  hasData: boolean
}

const subDay = (bucket: CounterBucket) => bucket === "15m" || bucket === "1h"

/**
 * Lines up each source's buckets on one axis. Hours align by instant; days,
 * weeks and months align by calendar date in each device's zone, so "Oct 9"
 * means Oct 9 at every site. Buckets without readings stay empty, not zero.
 */
export function consumptionModel(
  results: (ConsumptionData | undefined)[],
  { period, viewerZone }: { period: ConsumptionPeriod; viewerZone: string },
): ConsumptionModel | null {
  const loaded = results.filter((r): r is ConsumptionData => Boolean(r))
  if (!loaded.length) return null
  const bucket = loaded[0].bucket
  const hourly = subDay(bucket)
  const span = Math.max(...loaded.map((r) => r.to)) - Math.min(...loaded.map((r) => r.from))
  const withDate = hourly && span > 86_400_000
  // Hourly bars in the dashboard range read in the viewer's zone; calendar periods in the site's.
  const labelZone = (zone: string) => (hourly && period === "dashboard" ? viewerZone : zone)
  const keyOf = (start: number, zone: string) => (hourly ? String(start) : calendarKey(start, bucket, zone))

  const categories = new Map<string, ConsumptionModel["categories"][number]>()
  for (const result of loaded) {
    const zone = result.increase.timezone
    for (const start of bucketStarts(result.from, result.to, bucket, zone)) {
      const key = keyOf(start, zone)
      const existing = categories.get(key)
      if (!existing || start < existing.start)
        categories.set(key, {
          key,
          label: bucketLabel(start, bucket, labelZone(zone), withDate),
          title: bucketTitle(start, bucket, labelZone(zone)),
          start,
          end: addBuckets(start, bucket, 1, zone),
        })
    }
  }
  const ordered = [...categories.values()].sort((a, b) => a.start - b.start)
  const index = new Map(ordered.map((category, i) => [category.key, i]))

  let hasData = false
  const series = results.map((result) => {
    if (!result) return null
    const zone = result.increase.timezone
    const values: (ConsumptionValue | null)[] = ordered.map(() => null)
    let total = 0
    let resets = 0
    for (const point of result.increase.points) {
      const at = index.get(keyOf(bucketStart(Date.parse(point.at), bucket, zone), zone))
      if (at === undefined) continue
      values[at] = { value: point.increase, partial: point.partial, resets: point.resets, samples: point.samples }
      total += point.increase
      resets += point.resets
      hasData = true
    }
    return { values, total, resets, unit: result.increase.unit, timezone: zone }
  })
  return {
    bucket,
    categories: ordered,
    series,
    zones: [...new Set(loaded.map((r) => r.increase.timezone))],
    coarsened: loaded.some((r) => r.coarsened),
    hasData,
  }
}

/** How the panel explains where its days start, or null when it doesn't matter. */
export function zoneNote(model: ConsumptionModel, period: ConsumptionPeriod, viewerZone: string): string | null {
  const name = (zone: string) => zone.replace(/_/g, " ")
  if (model.zones.length > 1) return "Days start at midnight in each device's site time zone."
  const zone = model.zones[0]
  if (!subDay(model.bucket)) return `Days start at midnight, ${name(zone)} time.`
  return period !== "dashboard" && zone !== viewerZone ? `Hours in ${name(zone)} time.` : null
}
