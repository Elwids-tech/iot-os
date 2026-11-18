import { describe, expect, it } from "vitest"
import { requirementText } from "./requirement"

const acme = { organization: "a", name: "Acme" }
const north = { organization: "b", name: "Northstar" }
const third = { organization: "c", name: "Plant 3" }

describe("requirementText", () => {
  it("names who requires two-step sign-in", () => {
    expect(requirementText([])).toBeNull()
    expect(requirementText(["platform"])).toBe("Two-step sign-in is required for platform staff.")
    expect(requirementText([acme])).toBe("Acme requires two-step sign-in for every member.")
    expect(requirementText([acme, north])).toBe("Acme and Northstar require two-step sign-in for every member.")
    expect(requirementText([acme, north, third])).toBe("Acme, Northstar and Plant 3 require two-step sign-in for every member.")
    expect(requirementText(["platform", acme])).toBe("Two-step sign-in is required for platform staff, and Acme requires it for every member.")
  })
})
