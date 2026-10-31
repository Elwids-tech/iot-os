import { describe, expect, it } from "vitest"

import { groupByDay, initialsOf } from "./activity-timeline"

describe("groupByDay", () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime()
  const at = (days: number, hour: number) => new Date(2026, 9, 31 - days, hour).toISOString()

  it("labels today and yesterday and keeps the order within each day", () => {
    const items = [at(0, 14), at(0, 9), at(1, 22), at(1, 1), at(4, 12)]
    const days = groupByDay(items, (item) => item, now)

    expect(days.map((day) => day.label.slice(0, 9))).toEqual(["Today", "Yesterday", expect.any(String)])
    expect(days.map((day) => day.items.length)).toEqual([2, 2, 1])
    expect(days[0].items).toEqual([items[0], items[1]])
  })

  it("adds the year to days of another year", () => {
    const [day] = groupByDay([new Date(2025, 5, 2, 12).toISOString()], (item) => item, now)

    expect(day.label).toContain("2025")
  })
})

describe("initialsOf", () => {
  it("takes the first and last word, or the first two letters of one word", () => {
    expect(initialsOf("Ana Maria Silva")).toBe("AS")
    expect(initialsOf("ana")).toBe("AN")
    expect(initialsOf(null)).toBe("?")
  })
})
