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

  it("reads billing allowance sources and plan assignments in their domains", () => {
    expect(statusOf("override", "allowance")).toEqual({ tone: "info", label: "Override" })
    expect(statusOf("default", "allowance")).toEqual({ tone: "muted", label: "Default" })
    expect(statusOf("trial", "plan_assignment")).toEqual({ tone: "info", label: "Trial" })
    expect(statusOf("trial_unpaid", "plan_assignment").tone).toBe("warning")
  })

  it("reads invoices and what is owed on them in their domains (spec 029)", () => {
    expect(statusOf("draft", "invoice")).toEqual({ tone: "muted", label: "Draft" })
    expect(statusOf("incomplete", "invoice").tone).toBe("warning")
    expect(statusOf("pending", "payment")).toEqual({ tone: "info", label: "Awaiting payment" })
    expect(statusOf("failed", "payment").tone).toBe("critical")
    expect(statusOf("paid_outside", "payment")).toEqual({ tone: "good", label: "Paid another way" })
    expect(statusOf("past_due", "payment").tone).toBe("warning")
    expect(statusOf("pending", "invoice_payment")).toEqual({ tone: "info", label: "Processing" })
    expect(statusOf("failed", "invoice_payment").tone).toBe("critical")
  })

  it("reads an alert activation as a warning, unlike a runtime's", () => {
    expect(statusOf("activated")).toEqual({ tone: "good", label: "Activated" })
    expect(statusOf("activated", "alert")).toEqual({ tone: "warning", label: "Activated" })
    expect(statusOf("active", "alert")).toEqual({ tone: "warning", label: "Active" })
    expect(statusOf("cleared", "alert")).toEqual({ tone: "muted", label: "Cleared" })
  })

  it("reads offline alerts: kinds, causes, stop reasons and detection states (spec 018)", () => {
    expect(statusOf("device_offline", "alert_kind")).toEqual({ tone: "critical", label: "Device offline" })
    expect(statusOf("workflow", "alert_kind")).toEqual({ tone: "info", label: "Automation" })
    expect(statusOf("missed_check_in", "offline_cause")).toEqual({ tone: "critical", label: "Missed check-in" })
    expect(statusOf("source_disconnected", "offline_cause").label).toBe("Connection lost")
    expect(statusOf("device_deactivated", "offline_stop").label).toBe("Device deactivated")
    expect(statusOf("device_moved", "offline_stop").label).toBe("Device moved")
    expect(statusOf("stopping", "device_move")).toEqual({ tone: "info", label: "Stopping devices" })
    expect(statusOf("completed", "device_move")).toEqual({ tone: "good", label: "Moved" })
    expect(statusOf("failed", "device_move")).toEqual({ tone: "critical", label: "Not moved" })
    expect(statusOf("waiting", "device_move_device").tone).toBe("info")
    expect(statusOf("pending", "device_move_successor")).toEqual({ tone: "info", label: "Activating" })
    expect(statusOf("inactive", "device_move_successor")).toEqual({ tone: "muted", label: "Inactive" })
    expect(statusOf("failed", "device_move_successor")).toEqual({ tone: "critical", label: "Activation failed" })
    expect(statusOf("stopped", "alert")).toEqual({ tone: "muted", label: "Stopped" })
    expect(statusOf("learning", "connectivity")).toEqual({ tone: "info", label: "Learning how often it reports" })
    expect(statusOf("waiting", "connectivity").label).toBe("Waiting for first report")
    // The platform not hearing a device never reads as the device being offline.
    expect(statusOf("interrupted", "connectivity").tone).toBe("muted")
    expect(statusOf("adapter_restarting", "connectivity")).toEqual({ tone: "muted", label: "Adapter restarting" })
    expect(statusOf("offline", "connectivity")).toEqual(statusOf("offline"))
  })

  it("humanizes values it does not know", () => {
    expect(statusOf("needs_review")).toEqual({ tone: "muted", label: "Needs review" })
    expect(statusOf(null)).toEqual({ tone: "muted", label: "Unknown" })
    expect(humanize("storage_retry")).toBe("Storage retry")
  })
})
