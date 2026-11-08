import { describe, expect, it } from "vitest"
import { formatDay, formatMonth, paymentState } from "./invoices"

describe("invoices", () => {
  it("names UTC months and days", () => {
    const november = new Date(Date.UTC(2026, 10, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    expect(formatMonth("2026-11-01")).toBe(november)
    expect(formatMonth("2026-11")).toBe(november)
    expect(formatMonth("soon")).toBe("soon")
    expect(formatDay("2026-11-16T23:30:00+00:00")).toBe(
      new Date(Date.UTC(2026, 10, 16)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    )
  })

  it("shows an unpaid invoice past its due date as overdue", () => {
    const now = Date.parse("2026-11-20T00:00:00Z")
    const issued = { status: "issued", payment_status: "pending", due_at: "2026-11-16T10:00:00+00:00" }
    expect(paymentState(issued, now)).toBe("overdue")
    expect(paymentState({ ...issued, due_at: "2026-11-30T10:00:00+00:00" }, now)).toBe("pending")
    expect(paymentState({ ...issued, payment_status: "credited" }, now)).toBe("credited")
    expect(paymentState({ status: "draft", payment_status: "pending", due_at: null }, now)).toBeNull()
  })
})
