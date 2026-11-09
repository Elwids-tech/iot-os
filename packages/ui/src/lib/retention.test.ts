import { describe, expect, it } from "vitest"
import { reductionSteps, reductionText } from "./retention"

const day = (iso: string) => iso.slice(0, 10)

describe("retention", () => {
  it("lists each step cleanup takes, earliest first", () => {
    const reduction = {
      days: 7,
      from: "2026-12-13T10:00:00Z",
      steps: [
        { days: 30, from: "2026-12-08T10:00:00Z" },
        { days: 7, from: "2026-12-13T10:00:00Z" },
      ],
    }
    expect(reductionSteps(reduction)).toHaveLength(2)
    expect(reductionText(reduction, day)).toBe("30 days from 2026-12-08, then 7 days from 2026-12-13")
  })

  it("reads a payload without steps as its one step", () => {
    expect(reductionSteps({ days: 1, from: "2026-12-08T10:00:00Z" })).toEqual([{ days: 1, from: "2026-12-08T10:00:00Z" }])
    expect(reductionText({ days: 1, from: "2026-12-08T10:00:00Z" }, day)).toBe("1 day from 2026-12-08")
  })
})
