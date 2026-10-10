import { describe, expect, it } from "vitest"
import { deploymentState, lastActivity, relativeTime, triggerSummary } from "./directory"

describe("automation directory", () => {
  it("summarises triggers per device", () => {
    expect(triggerSummary([
      { node_id: "lat", device_uuid: "a", device_name: "Tracker 7", parameter: "Latitude" },
      { node_id: "lon", device_uuid: "a", device_name: "Tracker 7", parameter: "Longitude" },
      { node_id: "p", device_uuid: "b", device_name: null, parameter: "Pressure" },
    ])).toBe("Tracker 7: Latitude, Longitude · Unavailable device: Pressure")
    expect(triggerSummary([])).toBe("")
  })
  it("picks the most recent activity", () => {
    expect(lastActivity({
      deployment_status: "applied", updated_at: "2026-10-01T00:00:00Z", last_action_at: "2026-10-03T00:00:00Z",
      last_deployment: { target: "active", status: "succeeded", at: "2026-10-02T00:00:00Z", draft_revision: 4 },
    })).toEqual({ label: "Action requested", at: "2026-10-03T00:00:00Z" })
    expect(lastActivity({
      deployment_status: "failed", updated_at: "2026-10-01T00:00:00Z",
      last_deployment: { target: "active", status: "failed", at: "2026-10-02T00:00:00Z", draft_revision: 4 },
    })?.label).toBe("Activation failed")
    expect(lastActivity({ deployment_status: "inactive" })).toBeUndefined()
  })
  it("labels deployment states with text, not colour alone", () => {
    expect(deploymentState("applied")).toEqual({ tone: "good", label: "Active" })
    expect(deploymentState("mystery")).toEqual({ tone: "muted", label: "mystery" })
  })
  it("formats recent times relatively", () => {
    const now = Date.parse("2026-10-09T12:00:00Z")
    expect(relativeTime("2026-10-09T11:59:30Z", now)).toBe("just now")
    expect(relativeTime("2026-10-09T09:00:00Z", now)).toMatch(/3 hours ago/)
  })
})
