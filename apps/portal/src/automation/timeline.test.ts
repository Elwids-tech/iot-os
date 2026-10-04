import { describe, expect, it } from "vitest"
import { actionLabel, actionStages, evidenceText, type TimelineAction } from "./timeline"

describe("execution evidence", () => {
  it("keeps false and zero distinct from missing evidence", () => {
    expect(evidenceText({ known: true, value: false })).toBe("false")
    expect(evidenceText({ known: true, value: 0 })).toBe("0")
    expect(evidenceText({ known: false, value: 0, reason: "stale" })).toBe("Unknown · stale")
  })
  it("does not label authorization or observation as device confirmation", () => {
    expect(actionLabel({ id: "a", status: "dispatched" })).toBe("Dispatch authorized")
    expect(actionLabel({ id: "a", status: "observed_at_target", command: { uuid: "c", status: "observed" } })).toBe("Target state observed")
    expect(actionLabel({ id: "a", status: "observed_at_target", command: { uuid: "c", status: "confirmed" } })).toBe("Device confirmed")
  })
  it("shows only stages supported by timestamps", () => {
    const action: TimelineAction = { id: "a", status: "dispatched", accepted_at: "2026-10-03T00:00:00Z", dispatch_authorized_at: "2026-10-03T00:00:01Z", command: { uuid: "c", status: "pending" } }
    expect(actionStages(action).map(stage => stage.label)).toEqual(["Accepted by action worker", "Dispatch authorized"])
    const approved = { ...action, dispatch_authorized_at: undefined, command: { uuid: "c", status: "pending", confirmed_at: "2026-10-03T00:00:01Z" } }
    expect(actionStages(approved).map(stage => stage.label)).toEqual(["Accepted by action worker", "Command approved"])
    expect(actionStages({ ...approved, command: { ...approved.command, status: "observed", sent_at: "2026-10-03T00:00:02Z", completed_at: "2026-10-03T00:00:03Z" } }).map(stage => stage.label)).toEqual(["Accepted by action worker", "Command approved", "Sent to device", "Target state observed"])
    expect(actionStages({ ...action, command: { uuid: "c", status: "timed_out", sent_at: "2026-10-03T00:00:02Z", completed_at: "2026-10-03T00:00:30Z" } }).map(stage => stage.label)).toEqual(["Accepted by action worker", "Dispatch authorized", "Sent to device", "Delivery uncertain"])
  })
})
