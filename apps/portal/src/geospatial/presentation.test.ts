import { describe, expect, it } from "vitest"
import type { LocationMapDevice } from "@iot-os/api-client"
import { markerColor } from "./presentation"

describe("GPS marker membership colours", () => {
  const device = (condition: LocationMapDevice["condition"], live = true, wandering = false) =>
    ({ condition, latest: { live_eligible: live }, wandering }) as LocationMapDevice
  it("shows green inside and red outside independently of trail colour or alert state", () => {
    expect(markerColor(device("inside"))).toBe("#16a34a")
    expect(markerColor(device("outside"))).toBe("#dc2626")
    expect(markerColor(device("inside", true, true))).toBe("#16a34a")
  })
  it("never colours stale or unknown evidence as inside or outside", () => {
    expect(markerColor(device("inside", false))).toBe("#64748b")
    expect(markerColor(device("outside", false, true))).toBe("#64748b")
    expect(markerColor(device("unknown"))).toBe("#64748b")
  })
})
