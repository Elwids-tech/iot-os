import { describe, expect, it } from "vitest"
import { formatAge, formatDateTime, formatNumber } from "./format"

describe("format", () => {
  const now = Date.parse("2026-09-26T12:00:00Z")
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  it("formats ages at each unit boundary", () => {
    expect(formatAge(ago(4), now)).toBe("4 s")
    expect(formatAge(ago(59), now)).toBe("59 s")
    expect(formatAge(ago(60), now)).toBe("1 min")
    expect(formatAge(ago(19 * 60 + 30), now)).toBe("19 min")
    expect(formatAge(ago(2 * 3600 + 5), now)).toBe("2 h")
    expect(formatAge(ago(3 * 86400 + 5), now)).toBe("3 d")
    expect(formatAge(ago(-30), now)).toBe("0 s")
    expect(formatAge("not a date", now)).toBe("")
  })

  it("uses the given precision", () => {
    expect(formatNumber(21.5, 2)).toBe((21.5).toLocaleString(undefined, { minimumFractionDigits: 2 }))
    expect(formatNumber(3, 0)).toBe("3")
    expect(formatNumber(1.23456)).toBe((1.235).toLocaleString())
    expect(formatNumber(Number.NaN)).toBe("")
  })

  it("formats UTC date times with 24 h time", () => {
    expect(formatDateTime("2026-09-26T17:20:54Z", "utc")).toContain("17:20:54")
    expect(formatDateTime("2026-09-26T17:20:54Z", "utc")).toContain("2026")
    expect(formatDateTime("nope")).toBe("")
  })
})
