import { describe, expect, it } from "vitest"
import type { DeviceProfileParameter } from "@iot-os/api-client"
import { incompatibility, panelFor, suggestPanels, type Candidate } from "./suggest"
import { displayRange, displayStates, stateFor } from "./profileDisplay"

const device = { uuid: "d1", name: "Line 2 meter" }
let next = 0
function parameter(values: Partial<DeviceProfileParameter>): DeviceProfileParameter {
  next += 1
  return {
    uuid: `p${next}`,
    key: `key${next}`,
    label: `Parameter ${next}`,
    kind: "measurement",
    data_type: "number",
    unit: null,
    format: null,
    reports_state: true,
    accepts_command: false,
    validation: null,
    display: null,
    reporting: null,
    counter: null,
    ...values,
  } as DeviceProfileParameter
}
const candidate = (values: Partial<DeviceProfileParameter>, writable = false): Candidate => ({
  device,
  parameter: parameter(values),
  writable,
})
const types = (candidates: Candidate[]) => suggestPanels(candidates).map((s) => s.type)

describe("panel suggestions", () => {
  it("leads with Stat for a numeric value without a range", () => {
    expect(types([candidate({ unit: "V" })])).toEqual(["status", "timeseries", "table"])
  })

  it("leads with a gauge when the profile defines a range", () => {
    const power = candidate({ unit: "kW", display: { min: 0, max: 80 } })
    const suggestions = suggestPanels([power])
    expect(suggestions[0]).toEqual({ type: "gauge", reason: "Profile range 0–80 kW." })
    expect(types([candidate({ unit: "%" })])[0]).toBe("gauge")
    expect(types([candidate({ validation: { rule: { and: [{ ">=": [{ var: "value" }, 0] }, { "<=": [{ var: "value" }, 10] }] } } as DeviceProfileParameter["validation"] })])[0]).toBe("gauge")
  })

  it("never suggests a gauge for a running total", () => {
    expect(types([candidate({ kind: "counter", unit: "kWh", display: { min: 0, max: 100 } })])).toEqual(["status", "timeseries", "table"])
  })

  it("compares same-unit values in one chart and avoids mixed-unit charts", () => {
    expect(types([candidate({ unit: "V" }), candidate({ unit: "V" })])[0]).toBe("timeseries")
    const mixed = [candidate({ unit: "V" }), candidate({ unit: "A" })]
    expect(types(mixed)).not.toContain("timeseries")
    expect(incompatibility("timeseries", mixed)).toBe("Needs parameters with one unit.")
  })

  it("uses state panels for enums and controls for writable states", () => {
    expect(types([candidate({ data_type: "enum", kind: "state" })])).toEqual(["status", "state_history", "table"])
    expect(types([candidate({ data_type: "boolean", kind: "state" }, true)])[0]).toBe("controls")
    expect(incompatibility("controls", [candidate({ data_type: "boolean" })])).toBe("Needs writable parameters.")
  })

  it("lets the profile hint win for a single parameter", () => {
    expect(types([candidate({ unit: "V", display: { visualization: "timeseries" } })])[0]).toBe("timeseries")
  })

  it("falls back to a table for mixed data types", () => {
    expect(types([candidate({ unit: "V" }), candidate({ data_type: "string" })])).toEqual(["table", "status"])
  })

  it("rejects non-parameter panels and oversized gauges with reasons", () => {
    const five = Array.from({ length: 5 }, () => candidate({ unit: "V" }))
    expect(incompatibility("gauge", five)).toBe("Shows up to 4 parameters.")
    expect(incompatibility("text", five)).toBe("Configured without device parameters.")
  })
})

describe("panels from suggestions", () => {
  it("applies the profile range and names single-parameter panels after the parameter", () => {
    const power = candidate({ label: "Active power", unit: "kW", display: { min: 0, max: 80 } })
    const panel = panelFor("gauge", [power])
    expect(panel.title).toBe("Active power")
    expect(panel.config.min).toBe(0)
    expect(panel.config.max).toBe(80)
    expect(panel.config.sources[0]).toMatchObject({ device_uuid: "d1", parameter_uuid: power.parameter.uuid, unit: "kW" })
  })

  it("names multi-parameter panels after their device", () => {
    expect(panelFor("timeseries", [candidate({ unit: "V" }), candidate({ unit: "V" })]).title).toBe("Line 2 meter · Time series")
  })
})

describe("profile display hints", () => {
  it("reads state labels and matches booleans loosely", () => {
    const states = displayStates({ display: { states: [{ value: true, label: "Running", tone: "good" }, { value: "x", label: "" }] } })
    expect(states).toEqual([{ value: true, label: "Running", tone: "good" }])
    expect(stateFor(states, 1)?.label).toBe("Running")
    expect(stateFor(states, false)).toBeUndefined()
  })

  it("prefers the display range over validation limits", () => {
    expect(displayRange(parameter({ display: { min: 10, max: 20 }, unit: "%" }))).toEqual({ min: 10, max: 20 })
    expect(displayRange(parameter({ unit: "V" }))).toBeNull()
  })
})
