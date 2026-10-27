import { describe, expect, it } from "vitest"
import type { DashboardLayout, DashboardSource, DeviceProfileParameter } from "@iot-os/api-client"
import fixture from "../../../../contracts/dashboards/v1/panel-suggestions.fixture.json"
import { appendLayout, COLORS, NEUTRAL } from "./model"
import {
  incompatibility,
  OTHER_PANELS,
  PARAMETER_PANELS,
  panelFor,
  sourceFor,
  suggestPanels,
  type Candidate,
  type PanelType,
  type Suggestion,
} from "./suggest"
import { displayRange, displayStates, stateFor } from "./profileDisplay"

type SuggestionCase = {
  id: string
  candidates: Candidate[]
  expected: Suggestion[]
  incompatible: Record<PanelType, string | null>
  sources: DashboardSource[]
}
type LayoutCase = {
  id: string
  existing: DashboardLayout
  add: string[]
  placement: "available" | "bottom"
  expected: DashboardLayout
}
const suggestions = fixture.suggestions as unknown as SuggestionCase[]
const layouts = fixture.layouts as unknown as LayoutCase[]

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

describe("panel suggestions", () => {
  // The server's PanelSuggestions and DashboardLayout read the same cases.
  it.each(suggestions.map((entry) => [entry.id, entry] as const))("%s", (_, entry) => {
    expect(suggestPanels(entry.candidates)).toEqual(entry.expected)
    const types = [...PARAMETER_PANELS, ...OTHER_PANELS]
    expect(Object.fromEntries(types.map((type) => [type, incompatibility(type, entry.candidates)]))).toEqual(entry.incompatible)
    expect(entry.candidates.map((c, index) => sourceFor(c.device, c.parameter, index))).toEqual(entry.sources)
  })

  it.each(layouts.map((entry) => [entry.id, entry] as const))("places panels: %s", (_, entry) => {
    expect(entry.add.reduce((result, id) => appendLayout(result, id, entry.placement), entry.existing)).toEqual(entry.expected)
  })

  it("shares the palette and neutral band with the server", () => {
    expect(COLORS).toEqual(fixture.palette)
    expect(NEUTRAL).toEqual(fixture.neutral)
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
