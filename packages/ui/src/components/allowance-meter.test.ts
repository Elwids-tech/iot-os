import { describe, expect, it } from "vitest"
import { allowanceLine, allowanceUse } from "./allowance-meter"

describe("allowanceUse", () => {
  it("reads unlimited, within, near and used up for a monthly allowance", () => {
    expect(allowanceUse(10, null)).toBe("unlimited")
    expect(allowanceUse(79, 100)).toBe("within")
    expect(allowanceUse(80, 100)).toBe("near")
    expect(allowanceUse(100, 100)).toBe("used_up")
    expect(allowanceUse(140, 100)).toBe("used_up")
  })

  it("matches the server's 80% rule in whole numbers", () => {
    // ceil(3 × 0.8) = 3, so 2 of 3 is still within.
    expect(allowanceUse(2, 3)).toBe("within")
    expect(allowanceUse(0, 0)).toBe("used_up")
  })

  it("puts a level past its limit over it", () => {
    expect(allowanceUse(52, 50, "level")).toBe("over_limit")
    expect(allowanceUse(50, 50, "level")).toBe("used_up")
  })
})

describe("allowanceLine", () => {
  const noun: [string, string] = ["alert", "alerts"]

  it("says what is left, or the overage once it is used up", () => {
    expect(allowanceLine(400, 1000, { noun })).toBe("600 alerts left")
    expect(allowanceLine(1240, 1000, { overage: 240, noun })).toBe("240 alerts of overage")
    expect(allowanceLine(10, null, { noun })).toBeNull()
  })

  it("keeps what is left beside the month's overage after an allowance is raised past the count", () => {
    expect(allowanceLine(1240, 2000, { overage: 240, noun })).toBe("760 alerts left · 240 alerts of overage")
  })

  it("puts a level over its limit and gives an earlier month its overage only", () => {
    expect(allowanceLine(52, 50, { kind: "level", noun: ["device", "devices"] })).toBe("2 devices over the limit")
    expect(allowanceLine(1240, 2000, { overage: 240, noun, earlier: true })).toBe("240 alerts of overage")
    expect(allowanceLine(400, 2000, { noun, earlier: true })).toBeNull()
  })
})
