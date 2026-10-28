import { describe, expect, it } from "vitest"
import { humanize, statusOf } from "./status"

describe("status vocabulary", () => {
  it("reads one value the same everywhere", () => {
    expect(statusOf("pending")).toEqual({ tone: "info", label: "Pending" })
    expect(statusOf(" Online ")).toEqual({ tone: "good", label: "Online" })
    expect(statusOf("observed")).toEqual({ tone: "good", label: "Confirmed" })
    expect(statusOf("uncertain")).toEqual({ tone: "warning", label: "Uncertain" })
  })

  it("lets a domain override a shared value", () => {
    expect(statusOf("applied")).toEqual({ tone: "good", label: "Applied" })
    expect(statusOf("applied", "automation")).toEqual({ tone: "good", label: "Active" })
    expect(statusOf("sent")).toEqual({ tone: "commanded", label: "Sent" })
    expect(statusOf("sent", "delivery")).toEqual({ tone: "good", label: "Sent" })
    expect(statusOf("pending", "delivery")).toEqual({ tone: "info", label: "Pending" })
  })

  it("reads adapter source, checklist and run states in their domains", () => {
    expect(statusOf("idle")).toEqual({ tone: "muted", label: "Not configured" })
    expect(statusOf("idle", "source")).toEqual({ tone: "muted", label: "Idle" })
    expect(statusOf("rejecting", "source")).toEqual({ tone: "warning", label: "Rejecting" })
    expect(statusOf("waiting", "checklist")).toEqual({ tone: "info", label: "Waiting" })
    expect(statusOf("stopped", "poll_run")).toEqual({ tone: "critical", label: "Stopped" })
    expect(statusOf("pending", "ingest")).toEqual({ tone: "info", label: "Pending" })
  })

  it("humanizes values it does not know", () => {
    expect(statusOf("needs_review")).toEqual({ tone: "muted", label: "Needs review" })
    expect(statusOf(null)).toEqual({ tone: "muted", label: "Unknown" })
    expect(humanize("storage_retry")).toBe("Storage retry")
  })
})
