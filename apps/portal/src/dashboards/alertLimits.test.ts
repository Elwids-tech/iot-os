import { describe, expect, it, vi } from "vitest"
import type { AlertLimit, DashboardSource } from "@iot-os/api-client"
import {
  MAX_LIMIT_LINES,
  comparisonText,
  createLimitBatcher,
  deviceNames,
  drawnLimits,
  limitDevices,
  limitLabel,
  limitNote,
  panelLimits,
  treatmentText,
} from "./alertLimits"

const source = (device: string, extra: Partial<DashboardSource> = {}): DashboardSource =>
  ({ device_uuid: device, parameter_uuid: "temperature", label: "Temperature", unit: "°C", data_type: "number", thresholds: [], ...extra }) as DashboardSource
const row = (extra: Partial<AlertLimit> = {}): AlertLimit => ({
  workflow_uuid: "w1",
  workflow_name: "Pump safety",
  state: "running",
  device_uuid: "pump-1",
  parameter_uuid: "temperature",
  role: "raise",
  operator: "gt",
  value: 25,
  unit: "°C",
  aggregate: null,
  window_seconds: null,
  held_seconds: null,
  combined: false,
  ...extra,
})
const names = (uuid: string) => ({ "pump-1": "Pump 1", "pump-2": "Pump 2", "pump-3": "Pump 3", "pump-4": "Pump 4", "pump-5": "Pump 5" })[uuid] ?? uuid

describe("which devices a panel asks limits for", () => {
  it("asks once per device, for numeric sources only", () => {
    const sources = [source("pump-1"), source("pump-1", { parameter_uuid: "pressure" }), source("pump-2"), source("door", { data_type: "boolean" })]
    expect(limitDevices({ sources })).toEqual(["pump-1", "pump-2"])
  })

  it("asks for nothing when the panel turned limits off", () => {
    expect(limitDevices({ sources: [source("pump-1")], alert_limits: false })).toEqual([])
    expect(limitDevices({ sources: [source("pump-1")], alert_limits: true })).toEqual(["pump-1"])
  })
})

describe("batched limit requests", () => {
  it("asks once for the devices of every panel and gives each its own rows", async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (_org: string, ids: string[]) => ids.map((id) => row({ device_uuid: id })))
    const ask = createLimitBatcher(request)
    const answers = Promise.all([ask("org", "pump-1"), ask("org", "pump-2"), ask("org", "pump-1")])
    await vi.advanceTimersByTimeAsync(30)
    const [first, second, again] = await answers
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith("org", ["pump-1", "pump-2"])
    expect([first, second, again].map((rows) => rows.map((r) => r.device_uuid))).toEqual([["pump-1"], ["pump-2"], ["pump-1"]])
    vi.useRealTimers()
  })

  it("asks in chunks of 100 and keeps organizations apart", async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (_org: string, _ids: string[]) => [] as AlertLimit[])
    const ask = createLimitBatcher(request)
    const all = Promise.all([...Array.from({ length: 150 }, (_, i) => ask("org", `d${i}`)), ask("other", "d0")])
    await vi.advanceTimersByTimeAsync(30)
    await all
    expect(request.mock.calls.map(([org, ids]) => [org, ids.length])).toEqual([["org", 100], ["org", 50], ["other", 1]])
    vi.useRealTimers()
  })

  it("fails every caller of a failed request, and the next round asks again", async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue([row()])
    const ask = createLimitBatcher(request)
    const failed = Promise.allSettled([ask("org", "pump-1"), ask("org", "pump-2")])
    await vi.advanceTimersByTimeAsync(30)
    expect((await failed).map((result) => result.status)).toEqual(["rejected", "rejected"])
    const next = ask("org", "pump-1")
    await vi.advanceTimersByTimeAsync(30)
    expect(await next).toHaveLength(1)
    vi.useRealTimers()
  })
})

describe("a panel's limits", () => {
  it("keeps limits on what the panel draws", () => {
    const limits = panelLimits([source("pump-1")], [row(), row({ parameter_uuid: "pressure" }), row({ device_uuid: "pump-2" })], names)
    expect(limits).toHaveLength(1)
    expect(limits[0]).toMatchObject({ value: 25, sameUnit: true, devices: [{ uuid: "pump-1", name: "Pump 1" }] })
  })

  it("merges limits that differ only by device and keeps the devices each covers", () => {
    const sources = [source("pump-1"), source("pump-2"), source("pump-3")]
    const limits = panelLimits(sources, [row(), row({ device_uuid: "pump-2" }), row({ device_uuid: "pump-3", value: 40 })], names)
    expect(limits.map((limit) => [limit.value, limit.devices.map((device) => device.name)])).toEqual([
      [40, ["Pump 3"]],
      [25, ["Pump 1", "Pump 2"]],
    ])
  })

  it("keeps apart limits of different automations, sides, treatments and states", () => {
    const rows = [row(), row({ workflow_uuid: "w2", workflow_name: "Other" }), row({ operator: "gte" }), row({ aggregate: "average", window_seconds: 10 }), row({ state: "suspended" }), row({ role: "clear", operator: "lt", value: 20 })]
    expect(panelLimits([source("pump-1")], rows, names)).toHaveLength(6)
  })

  it("marks a limit in another unit than the panel shows", () => {
    expect(panelLimits([source("pump-1", { unit: "°F" })], [row()], names)[0].sameUnit).toBe(false)
    expect(panelLimits([source("pump-1", { unit: null })], [row({ unit: "" })], names)[0].sameUnit).toBe(true)
  })
})

describe("words for a limit", () => {
  const [limit] = panelLimits([source("pump-1")], [row()], names)

  it("says the side and the value with its unit", () => {
    expect(comparisonText(limit)).toBe("> 25 °C")
    expect(comparisonText({ ...limit, operator: "lte", value: 2.5, unit: "" })).toBe("≤ 2.5")
    expect(comparisonText({ ...limit, role: "clear", operator: "lt", value: 20 })).toBe("clears < 20 °C")
  })

  it("says how the reading is treated first", () => {
    expect(treatmentText(limit)).toBe("")
    expect(treatmentText({ ...limit, aggregate: "average", window_seconds: 10 })).toBe("10 s average")
    expect(treatmentText({ ...limit, aggregate: "min", window_seconds: 60 })).toBe("minimum over 1 min")
    expect(treatmentText({ ...limit, aggregate: "max", window_seconds: 60 })).toBe("maximum over 1 min")
    expect(treatmentText({ ...limit, aggregate: "average", window_seconds: 10, held_seconds: 300, combined: true })).toBe("10 s average · for 5 min · with other conditions")
  })

  it("names the device on the line only when the panel draws several and the line is one device's", () => {
    expect(limitLabel(limit, false)).toBe("Pump safety > 25 °C")
    expect(limitLabel(limit, true)).toBe("Pump safety > 25 °C · Pump 1")
    const [shared] = panelLimits([source("pump-1"), source("pump-2")], [row(), row({ device_uuid: "pump-2" })], names)
    expect(limitLabel(shared, true)).toBe("Pump safety > 25 °C")
    expect(limitLabel({ ...limit, held_seconds: 300 }, true)).toBe("Pump safety > 25 °C · Pump 1 · for 5 min")
  })

  it("lists up to three devices and counts the rest", () => {
    const devices = ["pump-3", "pump-1", "pump-2", "pump-5", "pump-4"].map((uuid) => ({ uuid, name: names(uuid) }))
    expect(deviceNames(devices.slice(0, 2))).toBe("Pump 1, Pump 3")
    expect(deviceNames(devices)).toBe("Pump 1, Pump 2, Pump 3 and 2 more")
  })
})

describe("which limits are drawn", () => {
  const many = panelLimits(
    [source("pump-1")],
    Array.from({ length: 12 }, (_, i) => row({ value: i * 10, workflow_uuid: `w${i}` })),
    names,
  )

  it("draws every running limit in the panel's unit when there are few", () => {
    const limits = panelLimits([source("pump-1")], [row(), row({ value: 30, state: "suspended" }), row({ value: 35, unit: "°F" })], names)
    expect(drawnLimits(limits, null).map((limit) => limit.value)).toEqual([25])
  })

  it("draws at most eight, the ones nearest the drawn values", () => {
    const drawn = drawnLimits(many, { min: 42, max: 58 })
    expect(drawn).toHaveLength(MAX_LIMIT_LINES)
    // 50 is inside the range; then outwards by distance, the lower value first on a tie.
    expect(drawn.map((limit) => limit.value).sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
  })

  it("says in words why a limit has no line", () => {
    const limits = panelLimits([source("pump-1")], [row(), row({ value: 30, state: "suspended" }), row({ value: 35, unit: "°F" }), row({ value: 500 }), row({ value: -40 })], names)
    const drawn = drawnLimits(limits, { min: 20, max: 30 })
    const note = (value: number) => limitNote(limits.find((limit) => limit.value === value)!, drawn, { min: 10, max: 40 })
    expect(note(25)).toBeNull()
    expect(note(30)).toBe("suspended, not checking")
    expect(note(35)).toBe("not drawn: in °F")
    expect(note(500)).toBe("above the chart")
    expect(note(-40)).toBe("below the chart")
    expect(limitNote(many[0], drawnLimits(many, { min: 0, max: 10 }), null)).toBe("not drawn")
  })
})
