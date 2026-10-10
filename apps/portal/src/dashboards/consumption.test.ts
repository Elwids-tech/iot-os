import { describe, expect, it } from "vitest"
import type { CounterIncrease } from "@iot-os/api-client"
import { consumptionModel, zoneNote } from "./consumption"
import type { ConsumptionData } from "./panelData"

const data = (
  timezone: string,
  from: string,
  to: string,
  bucket: ConsumptionData["bucket"],
  points: Partial<CounterIncrease["points"][number]>[],
): ConsumptionData => ({
  from: Date.parse(from),
  to: Date.parse(to),
  bucket,
  coarsened: false,
  increase: {
    from,
    to,
    bucket,
    timezone,
    unit: "kWh",
    points: points.map((p) => ({ at: "", increase: 0, samples: 1, resets: 0, partial: false, ...p })),
  },
})

describe("consumption model", () => {
  it("keeps days without readings empty and counts totals and resets", () => {
    const model = consumptionModel(
      [
        data("UTC", "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z", "1d", [
          { at: "2026-10-07T00:00:00Z", increase: 12 },
          { at: "2026-10-09T00:00:00Z", increase: 5, resets: 1, partial: true },
        ]),
      ],
      { period: "dashboard", viewerZone: "UTC" },
    )!
    expect(model.categories.map((c) => c.key)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"])
    expect(model.series[0]!.values.map((v) => v?.value ?? null)).toEqual([12, null, 5])
    expect(model.series[0]!.total).toBe(17)
    expect(model.series[0]!.resets).toBe(1)
    expect(model.series[0]!.values[2]!.partial).toBe(true)
  })

  it("aligns days by each site's calendar date", () => {
    // Vancouver's Oct 9 starts at 07:00 UTC, Toronto's at 04:00 UTC: one bar group.
    const model = consumptionModel(
      [
        data("America/Vancouver", "2026-10-09T07:00:00Z", "2026-10-10T07:00:00Z", "1d", [{ at: "2026-10-09T07:00:00Z", increase: 3 }]),
        data("America/Toronto", "2026-10-09T04:00:00Z", "2026-10-10T04:00:00Z", "1d", [{ at: "2026-10-09T04:00:00Z", increase: 4 }]),
      ],
      { period: "today", viewerZone: "UTC" },
    )!
    expect(model.categories.map((c) => c.key)).toEqual(["2026-10-09"])
    expect(model.series.map((s) => s!.values[0]!.value)).toEqual([3, 4])
    expect(zoneNote(model, "today", "UTC")).toBe("Days start at midnight in each device's site time zone.")
  })

  it("explains the zone for days, and for hours only when a calendar period uses another zone", () => {
    const daily = consumptionModel([data("America/St_Johns", "2026-10-09T02:30:00Z", "2026-10-10T02:30:00Z", "1d", [])], { period: "dashboard", viewerZone: "UTC" })!
    expect(zoneNote(daily, "dashboard", "UTC")).toBe("Days start at midnight, America/St Johns time.")
    expect(daily.hasData).toBe(false)
    const hourly = consumptionModel([data("America/Regina", "2026-10-10T06:00:00Z", "2026-10-11T06:00:00Z", "1h", [])], { period: "today", viewerZone: "UTC" })!
    expect(hourly.categories).toHaveLength(24)
    expect(zoneNote(hourly, "today", "UTC")).toBe("Hours in America/Regina time.")
    expect(zoneNote(hourly, "dashboard", "UTC")).toBeNull()
  })
})
