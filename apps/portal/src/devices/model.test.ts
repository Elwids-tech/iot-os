import { describe, expect, it } from "vitest"
import type {
  Device,
  DeviceConfiguration,
  Measurement,
  WorkflowAlert,
} from "@iot-os/api-client"
import {
  configurationSummary,
  deviceConnection,
  deviceHealth,
  groupAlerts,
  healthDetails,
  lastPosition,
  locationParameters,
  recentDataMs,
  RECENT_DATA_MS,
  shortDeviceCode,
} from "./model"

const state = (
  lifecycle: Device["lifecycle"],
  presence: Device["presence"],
  deployment_status: Device["deployment_status"],
) => ({ lifecycle, presence, deployment_status })

describe("device health", () => {
  it("prefers archive, failed and pending configuration over connection", () => {
    expect(deviceHealth(state("archived", "online", "failed")).label).toBe("Archived")
    expect(deviceHealth(state("active", "online", "failed")).label).toBe("Configuration failed")
    expect(deviceHealth(state("active", "offline", "pending")).label).toBe("Updating")
    expect(deviceHealth(state("deactivated", "offline", "pending")).key).toBe("updating")
  })
  it("names deactivated and never configured devices before connection", () => {
    expect(deviceHealth(state("deactivated", "offline", "inactive")).label).toBe("Deactivated")
    expect(deviceHealth(state("registered", "unseen", "idle")).label).toBe("Needs configuration")
  })
  it("uses the connection for active devices and keeps missing data unknown", () => {
    expect(deviceHealth(state("active", "online", "applied"))).toEqual({ key: "online", tone: "good", label: "Online" })
    expect(deviceHealth(state("active", "offline", "applied")).tone).toBe("critical")
    expect(deviceHealth(state("active", "unseen", "applied")).label).toBe("Not seen yet")
    expect(deviceHealth(state("active", "unknown", "applied")).label).toBe("Connection unknown")
    expect(deviceHealth(state("active", "lost" as Device["presence"], "applied")).label).toBe("Connection unknown")
  })
  it("warns when an online session has sent no data for longer than the freshness window", () => {
    const now = Date.parse("2026-10-09T12:00:00Z")
    const seen = (iso: string | null) => ({ ...state("active", "online", "applied"), last_seen_at: iso })
    expect(deviceHealth(seen("2026-10-04T12:00:00Z"), { now })).toEqual({
      key: "quiet",
      tone: "warning",
      label: "Online · no recent data",
    })
    expect(deviceHealth(seen("2026-10-09T11:30:00Z"), { now }).label).toBe("Online")
    expect(deviceHealth(seen("2026-10-09T09:00:00Z"), { now, recentMs: 4 * RECENT_DATA_MS }).label).toBe("Online")
    // A missing last-seen time is unknown, not quiet.
    expect(deviceHealth(seen(null), { now }).label).toBe("Online")
    // Offline stays offline however old the data is; lifecycle and configuration still win.
    expect(deviceHealth({ ...seen("2026-10-04T12:00:00Z"), presence: "offline" }, { now }).label).toBe("Offline")
    expect(deviceHealth({ ...seen("2026-10-04T12:00:00Z"), deployment_status: "failed" }, { now }).key).toBe("failed")
    expect(deviceConnection(seen("2026-10-04T12:00:00Z"), { now }).key).toBe("quiet")
    expect(healthDetails(seen("2026-10-04T12:00:00Z"), { now })).toEqual([
      ["Lifecycle", "Active"],
      ["Connection", "Online, no recent data"],
      ["Configuration", "Applied"],
      ["Last seen", "5 d ago"],
    ])
  })
  it("takes the freshness window from the slowest profile parameter, at least an hour", () => {
    expect(recentDataMs([])).toBe(RECENT_DATA_MS)
    expect(recentDataMs([{ reporting: { stale_after_seconds: 90 } }, { reporting: null }])).toBe(RECENT_DATA_MS)
    expect(recentDataMs([{ reporting: { stale_after_seconds: 90 } }, { reporting: { stale_after_seconds: 21600 } }])).toBe(21_600_000)
  })
  it("keeps the parts for the tooltip and drops connection for deactivated devices", () => {
    expect(healthDetails(state("active", "unknown", "applied"))).toEqual([
      ["Lifecycle", "Active"],
      ["Connection", "Unknown"],
      ["Configuration", "Applied"],
    ])
    expect(healthDetails(state("deactivated", "offline", "inactive")).map(([name]) => name)).toEqual(["Lifecycle", "Configuration"])
  })
})

describe("device codes", () => {
  it("shortens only platform-generated device-<uuid> codes", () => {
    expect(shortDeviceCode("device-ef7b2376-8fdb-4371-a8fa-f0426d457632")).toBe("device-ef7b…7632")
    expect(shortDeviceCode("meter-1")).toBe("meter-1")
    expect(shortDeviceCode("device-ef7b2376")).toBe("device-ef7b2376")
    expect(shortDeviceCode("pump-ef7b2376-8fdb-4371-a8fa-f0426d457632")).toBe("pump-ef7b2376-8fdb-4371-a8fa-f0426d457632")
  })
})

describe("configuration summary", () => {
  const configurations = [
    { uuid: "c1", revision: 1 },
    { uuid: "c2", revision: 2 },
  ] as DeviceConfiguration[]
  const device = (
    deployment_status: Device["deployment_status"],
    desired: string | null,
    applied: string | null,
    working: string | null,
  ) => ({
    deployment_status,
    desired_configuration_uuid: desired,
    applied_configuration_uuid: applied,
    last_applied_configuration_uuid: working,
    configurations,
  })
  it("reads as plain words with the revisions kept as detail", () => {
    expect(configurationSummary(device("applied", "c1", "c1", "c1"))).toEqual({
      tone: "good",
      label: "Up to date (revision 1)",
      details: ["Requested revision 1", "Applied revision 1", "Last working revision 1"],
    })
    expect(configurationSummary(device("pending", "c2", "c1", "c1")).label).toBe("Update pending (revision 2)")
    expect(configurationSummary(device("pending", null, "c1", "c1")).label).toBe("Turning off")
    expect(configurationSummary(device("failed", "c2", "c1", "c1")).label).toBe("Update failed (revision 2), still running revision 1")
    expect(configurationSummary(device("inactive", null, null, "c1")).label).toBe("Off (last used revision 1)")
    expect(configurationSummary(device("idle", null, null, null))).toEqual({ tone: "muted", label: "Not configured", details: [] })
  })
})

describe("device position", () => {
  const parameters = [
    { uuid: "lat", key: "location.latitude" },
    { uuid: "lng", key: "location.longitude" },
    { uuid: "acc", key: "location.accuracy" },
  ]
  const reading = (parameter_uuid: string, value: unknown, values: Partial<Measurement> = {}) =>
    ({
      parameter_uuid,
      value,
      quality: "good",
      observed_at: "2026-10-04T08:00:00Z",
      received_at: "2026-10-04T08:00:01Z",
      ...values,
    }) as Measurement
  it("uses the saved location binding before profile keys", () => {
    expect(
      locationParameters(
        { latitude_parameter_uuid: "b-lat", longitude_parameter_uuid: "b-lng", accuracy_parameter_uuid: null },
        parameters,
      ),
    ).toEqual({ latitude: "b-lat", longitude: "b-lng", accuracy: null })
    expect(locationParameters(null, parameters)).toEqual({ latitude: "lat", longitude: "lng", accuracy: "acc" })
    expect(locationParameters(undefined, [{ uuid: "t", key: "temperature" }, { uuid: "l", key: "location.latitude" }])).toBeNull()
  })
  it("returns the last position with its oldest observation time", () => {
    const where = locationParameters(null, parameters)!
    expect(
      lastPosition(
        [reading("lat", 51.05), reading("lng", -114.07, { observed_at: "2026-10-04T07:59:00Z" }), reading("acc", 4)],
        where,
      ),
    ).toEqual({
      latitude: 51.05,
      longitude: -114.07,
      accuracy: 4,
      observed_at: "2026-10-04T07:59:00Z",
      received_at: "2026-10-04T08:00:01Z",
      stale: false,
    })
    expect(lastPosition([reading("lat", 51.05, { quality: "stale" }), reading("lng", -114.07)], where)?.stale).toBe(true)
  })
  it("keeps missing, invalid, out of range and no-fix positions unknown", () => {
    const where = locationParameters(null, parameters)!
    expect(lastPosition([reading("lat", 51.05)], where)).toBeNull()
    expect(lastPosition([reading("lat", null), reading("lng", -114.07)], where)).toBeNull()
    expect(lastPosition([reading("lat", 51.05, { quality: "invalid" }), reading("lng", -114.07)], where)).toBeNull()
    expect(lastPosition([reading("lat", 91), reading("lng", -114.07)], where)).toBeNull()
    expect(lastPosition([reading("lat", 0), reading("lng", 0)], where)).toBeNull()
  })
})

describe("device alert groups", () => {
  const alert = (uuid: string, workflow: string, condition: WorkflowAlert["condition"], at: string) =>
    ({
      uuid,
      workflow_uuid: workflow,
      workflow_name: workflow.toUpperCase(),
      condition,
      activated_at: at,
      cleared_at: condition === "cleared" ? at : null,
    }) as WorkflowAlert
  it("collapses repeated episodes per workflow, active groups first", () => {
    const groups = groupAlerts([
      alert("a5", "fence", "cleared", "2026-10-04T08:00:00Z"),
      alert("a4", "temp", "cleared", "2026-10-03T08:00:00Z"),
      alert("a3", "fence", "cleared", "2026-10-02T08:00:00Z"),
      alert("a2", "door", "active", "2026-09-30T08:00:00Z"),
      alert("a1", "fence", "cleared", "2026-09-29T08:00:00Z"),
    ])
    expect(groups.map((g) => [g.workflow_uuid, g.count, g.active, g.latest.uuid])).toEqual([
      ["door", 1, 1, "a2"],
      ["fence", 3, 0, "a5"],
      ["temp", 1, 0, "a4"],
    ])
  })
})
