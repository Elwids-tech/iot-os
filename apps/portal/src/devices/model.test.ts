import { describe, expect, it } from "vitest"
import type {
  Device,
  DeviceConfiguration,
  LocationBinding,
  Measurement,
  OfflineAlert,
  WorkflowAlert,
} from "@iot-os/api-client"
import {
  configurationSummary,
  connectivityStatus,
  deviceConnection,
  formatDuration,
  offlineAfterText,
  offlineReason,
  listStatuses,
  deviceHealth,
  groupAlerts,
  healthDetails,
  lastPosition,
  locationBindingInput,
  locationDraft,
  locationParameters,
  locationProblems,
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

describe("location binding form", () => {
  const parameter = (uuid: string, key: string, unit: string | null, data_type = "number") => ({ uuid, key, unit, data_type })
  const parameters = [
    parameter("lat", "gps.latitude", "deg"),
    parameter("lng", "gps.longitude", "deg"),
    parameter("acc", "gps.accuracy", "m"),
    parameter("name", "gps.label", null, "string"),
    parameter("alt", "gps.altitude", "m"),
  ]
  const binding = {
    latitude_parameter_uuid: "lng",
    longitude_parameter_uuid: "lat",
    accuracy_parameter_uuid: null,
    max_age_seconds: 300,
    max_future_skew_seconds: 0,
    allow_unknown_accuracy: false,
  } as LocationBinding
  it("starts from the profile's guess and the API defaults", () => {
    expect(locationDraft(undefined, parameters)).toEqual({
      latitude: "lat",
      longitude: "lng",
      accuracy: "acc",
      max_age_seconds: "90",
      max_future_skew_seconds: "5",
      allow_unknown_accuracy: true,
    })
  })
  it("keeps the saved choices while the applied profile still has them", () => {
    expect(locationDraft(binding, parameters)).toMatchObject({ latitude: "lng", longitude: "lat", accuracy: "", max_age_seconds: "300" })
    const reconfigured = { ...binding, latitude_parameter_uuid: "gone" }
    expect(locationDraft(reconfigured, parameters)).toMatchObject({ latitude: "lat", longitude: "lng", accuracy: "acc", max_age_seconds: "300" })
  })
  it("needs degrees for coordinates, metres for accuracy and the API's limits", () => {
    expect(locationProblems(locationDraft(undefined, parameters), parameters)).toEqual({})
    const draft = locationDraft(undefined, parameters)
    expect(locationProblems({ ...draft, latitude: "", longitude: "alt", accuracy: "lat", max_age_seconds: "0", max_future_skew_seconds: "2.5" }, parameters)).toEqual({
      latitude: "Choose the latitude parameter.",
      longitude: "Maps need degrees. Set this parameter's unit to deg in its profile.",
      accuracy: "Accuracy must be in metres. Set this parameter's unit to m in its profile.",
      max_age_seconds: "Enter whole seconds from 1 to 86,400.",
      max_future_skew_seconds: "Enter whole seconds from 0 to 300.",
    })
    expect(locationProblems({ ...draft, longitude: "lat", accuracy: "alt" }, parameters)).toEqual({
      longitude: "Choose a different parameter from latitude.",
    })
    expect(locationProblems({ ...draft, accuracy: "lat" }, parameters).accuracy).toBe("Choose a parameter that isn't a coordinate.")
  })
  it("sends numbers, the revision and no accuracy for an empty choice", () => {
    expect(locationBindingInput({ ...locationDraft(undefined, parameters), accuracy: "", max_age_seconds: " 120 " }, "config", 3)).toEqual({
      revision: 3,
      configuration_uuid: "config",
      latitude_parameter_uuid: "lat",
      longitude_parameter_uuid: "lng",
      accuracy_parameter_uuid: null,
      max_age_seconds: 120,
      max_future_skew_seconds: 5,
      allow_unknown_accuracy: true,
    })
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
    expect(groups.map((g) => [g.key, g.count, g.active, g.latest.uuid])).toEqual([
      ["door", 1, 1, "a2"],
      ["fence", 3, 0, "a5"],
      ["temp", 1, 0, "a4"],
    ])
    expect(groups[0].filter).toBe("workflow=door")
  })
  it("groups offline alerts by kind and subject and filters the list by kind", () => {
    const offline = (uuid: string, kind: string, subject: string, condition: string) =>
      ({
        uuid,
        kind,
        workflow_uuid: null,
        workflow_name: null,
        subject: { type: kind === "gateway_offline" ? "gateway" : "device", uuid: subject, name: subject === "g1" ? "Yard gateway" : "Box" },
        condition,
        activated_at: "2026-10-04T08:00:00Z",
        cleared_at: condition === "cleared" ? "2026-10-04T09:00:00Z" : null,
      }) as never
    const groups = groupAlerts([
      offline("o3", "device_offline", "d1", "cleared"),
      offline("o2", "gateway_offline", "g1", "active"),
      offline("o1", "device_offline", "d1", "cleared"),
    ])
    expect(groups.map((g) => [g.key, g.name, g.count, g.filter, g.apiFilter])).toEqual([
      ["gateway_offline:g1", "Gateway offline — Yard gateway", 1, "kind=gateway_offline", "kind%5B%5D=gateway_offline"],
      ["device_offline:d1", "Device offline", 2, "kind=device_offline", "kind%5B%5D=device_offline"],
    ])
  })
})

describe("device connectivity (spec 018)", () => {
  const alert = (changes: Partial<OfflineAlert>): OfflineAlert => ({
    uuid: "a1",
    kind: "device_offline",
    cause: "missed_check_in",
    since: "2026-10-04T08:00:00Z",
    subject: { type: "device", uuid: "d1", name: "Box" },
    ...changes,
  })
  it("says why a device is offline: its own cause or its gateway", () => {
    expect(offlineReason(alert({}))).toBe("Offline: missed check-in")
    expect(offlineReason(alert({ cause: "death_certificate" }))).toBe("Offline: death certificate")
    expect(
      offlineReason(alert({ kind: "gateway_offline", cause: "death_certificate", subject: { type: "gateway", uuid: "g1", name: "Yard gateway" } })),
    ).toBe("Offline because gateway Yard gateway is offline")
  })
  it("puts the open offline alert into the health tooltip", () => {
    const now = Date.parse("2026-10-04T08:30:00Z")
    expect(
      healthDetails({ ...state("active", "offline", "applied"), offline_alert: alert({}) }, { now }),
    ).toEqual([
      ["Lifecycle", "Active"],
      ["Connection", "Offline: missed check-in"],
      ["Offline since", "30 min ago"],
      ["Configuration", "Applied"],
    ])
  })
  it("lists Offline alert as a directory status after Offline", () => {
    expect(listStatuses.slice(0, 3)).toEqual([
      { value: "online", label: "Online" },
      { value: "offline", label: "Offline" },
      { value: "offline_alert", label: "Offline alert" },
    ])
  })
  it("formats intervals at a glance", () => {
    expect(formatDuration(45)).toBe("45 s")
    expect(formatDuration(900)).toBe("15 min")
    expect(formatDuration(5400)).toBe("1 h 30 min")
    expect(formatDuration(3600)).toBe("1 h")
    expect(formatDuration(259200)).toBe("3 d")
    expect(formatDuration(194400)).toBe("2 d 6 h")
  })
  it("reads the runtime state, labelling adapter restarts and devices silent before monitoring", () => {
    const runtime = { state: "waiting" as const, interruption: null, before_monitoring: false }
    expect(connectivityStatus(runtime)).toBe("waiting")
    expect(connectivityStatus({ ...runtime, before_monitoring: true })).toBe("before_monitoring")
    expect(connectivityStatus({ state: "interrupted", interruption: "adapter", before_monitoring: false })).toBe("adapter_restarting")
    expect(
      connectivityStatus({ state: "interrupted", interruption: "adapter", before_monitoring: false }, "Adapter paused; offline alerts resume when it is resumed."),
    ).toBe("adapter_paused")
    expect(connectivityStatus({ state: "interrupted", interruption: "connection", before_monitoring: false })).toBe("interrupted")
  })
  it("states the Offline after in effect, or that it is still learning", () => {
    const runtime = { state: "monitored" as const, offline_after_seconds: 900, offline_after_automatic: true, readings_counted: 64 }
    expect(offlineAfterText(runtime, null)).toBe("15 min (automatic)")
    expect(offlineAfterText({ ...runtime, state: "learning", offline_after_seconds: null, readings_counted: 2 }, null)).toBe(
      "Automatic, learning (2 of 3 readings)",
    )
    expect(offlineAfterText({ ...runtime, state: "unknown", offline_after_seconds: null }, null)).toBe("Automatic")
    expect(offlineAfterText({ ...runtime, state: "unknown", offline_after_seconds: null }, 3600)).toBe("1 h (set)")
  })
})
