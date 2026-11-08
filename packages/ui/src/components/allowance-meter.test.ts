import { describe, expect, it } from "vitest"
import { allowanceUse } from "./allowance-meter"

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
