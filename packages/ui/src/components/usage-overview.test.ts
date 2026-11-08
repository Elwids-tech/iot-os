import { describe, expect, it } from "vitest"

import { monthKey, usageMonths } from "./usage-overview"

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
