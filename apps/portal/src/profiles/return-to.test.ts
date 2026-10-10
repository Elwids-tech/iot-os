import { describe, expect, it } from "vitest"
import { safeReturnTo, withParam, withReturnTo } from "./return-to"

const origin = "https://portal.example.test"

describe("safeReturnTo", () => {
  it("keeps same-origin organization paths with their query", () => {
    expect(safeReturnTo("/organizations/o-1/devices/onboard", origin)).toBe(
      "/organizations/o-1/devices/onboard",
    )
    expect(safeReturnTo("/organizations/o-1/devices/onboard?step=1", origin)).toBe(
      "/organizations/o-1/devices/onboard?step=1",
    )
  })

  it("rejects absolute, protocol-relative, traversal and non-organization paths", () => {
    for (const value of [
      null,
      "",
      "https://evil.example/organizations/o-1",
      "//evil.example/organizations/o-1",
      "/\\evil.example",
      "/organizations\\..\\evil",
      "/organizations/../admin",
      "/dashboards",
      "javascript:alert(1)",
      "organizations/o-1",
    ])
      expect(safeReturnTo(value, origin)).toBeNull()
  })
})

describe("withReturnTo and withParam", () => {
  it("adds the way back and replaces a parameter", () => {
    expect(withReturnTo("/organizations/o/device-profiles/p/overview", null)).toBe(
      "/organizations/o/device-profiles/p/overview",
    )
    expect(withReturnTo("/organizations/o/device-profiles", "/organizations/o/devices/onboard")).toBe(
      "/organizations/o/device-profiles?returnTo=%2Forganizations%2Fo%2Fdevices%2Fonboard",
    )
    expect(withReturnTo("/a?x=1", "/organizations/o")).toBe(
      "/a?x=1&returnTo=%2Forganizations%2Fo",
    )
    expect(withParam("/organizations/o/devices/onboard?profile=old", "profile", "new")).toBe(
      "/organizations/o/devices/onboard?profile=new",
    )
  })
})
