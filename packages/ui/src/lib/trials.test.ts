import { describe, expect, it } from "vitest"
import { formatDay } from "./invoices"
import { trialEndingSoon, trialEndsAt, trialLastDay, trialText } from "./trials"

describe("trials", () => {
  it("turns a trial's last UTC day into its end and back", () => {
    expect(trialEndsAt("2026-12-08")).toBe("2026-12-09T00:00:00.000Z")
    expect(trialLastDay("2026-12-09T00:00:00+00:00")).toBe("2026-12-08")
    expect(trialLastDay("2026-12-08T14:00:00Z")).toBe("2026-12-08")
    expect(trialEndsAt("2026-12-31")).toBe("2027-01-01T00:00:00.000Z")
  })

  it("describes a trial and when it ends", () => {
    expect(trialText({ kind: "trial", trial_ends_at: "2026-12-09T00:00:00Z" })).toBe(`Trial until ${formatDay("2026-12-08")}`)
    expect(trialText({ kind: "trial", trial_ends_at: null })).toBe("Trial, no end date")
    expect(trialText({ kind: "trial_unpaid", trial_ends_at: null })).toBe("Trial ended, no payment method")
    expect(trialText({ kind: "paid", trial_ends_at: null })).toBeNull()
  })

  it("counts a limited trial ending within 7 days as ending soon", () => {
    const now = Date.parse("2026-12-01T12:00:00Z")
    expect(trialEndingSoon({ kind: "trial", trial_ends_at: "2026-12-08T00:00:00Z" }, now)).toBe(true)
    expect(trialEndingSoon({ kind: "trial", trial_ends_at: "2026-12-09T00:00:00Z" }, now)).toBe(false)
    expect(trialEndingSoon({ kind: "trial", trial_ends_at: null }, now)).toBe(false)
    expect(trialEndingSoon({ kind: "trial_unpaid", trial_ends_at: null }, now)).toBe(false)
  })
})
