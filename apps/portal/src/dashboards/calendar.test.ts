import { describe, expect, it } from "vitest"
import { addBuckets, bucketStart, bucketStarts, effectiveBucket, periodWindow } from "./calendar"

const iso = (ms: number) => new Date(ms).toISOString()
const at = (value: string) => Date.parse(value)

describe("zoned calendar buckets", () => {
  it("starts days at local midnight in the device's zone", () => {
    // 03:00 UTC on 10 Oct is still 9 Oct in Vancouver (UTC−7).
    expect(iso(bucketStart(at("2026-10-10T03:00:00Z"), "1d", "America/Vancouver"))).toBe("2026-10-09T07:00:00.000Z")
    expect(iso(bucketStart(at("2026-10-10T03:00:00Z"), "1d", "America/Toronto"))).toBe("2026-10-09T04:00:00.000Z")
  })

  it("keeps half-hour zones on their local hour", () => {
    // St John's is UTC−2:30 in October, so its hours start at :30 UTC.
    expect(iso(bucketStart(at("2026-10-10T12:10:00Z"), "1h", "America/St_Johns"))).toBe("2026-10-10T11:30:00.000Z")
    expect(iso(bucketStart(at("2026-10-10T12:10:00Z"), "15m", "America/St_Johns"))).toBe("2026-10-10T12:00:00.000Z")
  })

  it("starts weeks on Monday and months on the 1st", () => {
    // Saturday 10 Oct 2026; the week began Monday 5 Oct.
    expect(iso(bucketStart(at("2026-10-10T12:00:00Z"), "1w", "UTC"))).toBe("2026-10-05T00:00:00.000Z")
    expect(iso(bucketStart(at("2026-10-10T12:00:00Z"), "1mo", "America/Regina"))).toBe("2026-10-01T06:00:00.000Z")
  })

  it("steps days across a daylight-saving change by the calendar, not 24 hours", () => {
    // Toronto falls back on 1 Nov 2026: that day is 25 hours long.
    const day = bucketStart(at("2026-11-01T12:00:00Z"), "1d", "America/Toronto")
    const next = addBuckets(day, "1d", 1, "America/Toronto")
    expect(iso(day)).toBe("2026-11-01T04:00:00.000Z")
    expect(iso(next)).toBe("2026-11-02T05:00:00.000Z")
    expect(bucketStarts(day, next, "1h", "America/Toronto")).toHaveLength(25)
  })

  it("builds calendar periods that end with the period, not now", () => {
    const now = at("2026-10-10T15:00:00Z")
    const today = periodWindow("today", now, "America/Vancouver")
    expect([iso(today.from), iso(today.to), today.bucket]).toEqual(["2026-10-10T07:00:00.000Z", "2026-10-11T07:00:00.000Z", "1h"])
    const year = periodWindow("12mo", now, "UTC")
    expect([iso(year.from), iso(year.to), year.bucket]).toEqual(["2025-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "1mo"])
    expect(bucketStarts(year.from, year.to, year.bucket, "UTC")).toHaveLength(12)
    expect(bucketStarts(periodWindow("7d", now, "UTC").from, periodWindow("7d", now, "UTC").to, "1d", "UTC")).toHaveLength(7)
  })

  it("chooses readable bar sizes and coarsens settings that would draw too many bars", () => {
    expect(effectiveBucket("auto", 24 * 3600_000)).toEqual({ bucket: "1h", coarsened: false })
    expect(effectiveBucket("auto", 30 * 86400_000)).toEqual({ bucket: "1d", coarsened: false })
    expect(effectiveBucket("15m", 30 * 86400_000)).toEqual({ bucket: "1d", coarsened: true })
    expect(effectiveBucket("1w", 30 * 86400_000)).toEqual({ bucket: "1w", coarsened: false })
  })
})
