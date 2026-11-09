import { describe, expect, it } from "vitest"

import { monthKey, monthsSince, usageMonths } from "./usage-overview"

describe("usageMonths", () => {
  it("counts back UTC months from this one, across a year", () => {
    const months = usageMonths(new Date("2026-02-28T23:30:00-05:00"), 3)
    expect(months.map((month) => month.value)).toEqual(["2026-03", "2026-02", "2026-01"])
    expect(months[0].label).toMatch(/^This month/)
  })

  it("keys a date by its UTC month", () => {
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12")
    expect(monthKey(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01")
  })
})

describe("monthsSince", () => {
  it("counts UTC months back to the account's start, both included, and twelve without one", () => {
    const now = new Date("2027-02-10T12:00:00Z")
    expect(monthsSince("2025-11-30T23:00:00Z", now)).toBe(16)
    expect(monthsSince("2027-02-01T00:00:00Z", now)).toBe(1)
    expect(monthsSince(null, now)).toBe(12)
    expect(monthsSince("not a date", now)).toBe(12)
  })
})
