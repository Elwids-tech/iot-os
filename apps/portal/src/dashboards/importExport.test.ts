import { describe, expect, it } from "vitest"
import type { Dashboard } from "@iot-os/api-client"
import {
  definition,
  FILE_TOO_LARGE,
  fieldLabel,
  MAX_IMPORT_BYTES,
  parseDefinitions,
} from "./importExport"

const device = "11111111-1111-4111-8111-111111111111"
const parameter = "22222222-2222-4222-8222-222222222222"
const source = {
  device_uuid: device,
  parameter_uuid: parameter,
  device_name: "Boiler room",
  label: "Temperature",
  unit: "C",
  data_type: "number",
  format: null,
  display_widget: null,
  precision: 1,
  color: "#2563eb",
  base: { label: "Normal", color: "#64748b" },
  thresholds: [{ value: 30, label: "Hot", color: "#dc2626" }],
}
const exported = {
  name: "Plant",
  widgets: [
    { id: "w1", schema_version: 2, type: "status", title: "Temp", description: "", config: { sources: [source] } },
    { id: "w2", schema_version: 2, type: "gauge", title: "Gauge", description: "", config: { sources: [source], min: 0, max: 100 } },
    { id: "w3", schema_version: 2, type: "text", title: "Notes", description: "", config: { sources: [], text: "Check valves" } },
    { id: "w4", schema_version: 2, type: "device_health", title: "Health", description: "", config: { sources: [], devices: [{ device_uuid: device, device_name: "Boiler room" }] } },
  ],
  layouts: { lg: [{ i: "w1", x: 0, y: 0, w: 6, h: 6 }] },
  defaults: { range: { mode: "relative", preset: "6h" }, timezone: "browser", refresh: 5 },
  tags: ["energy"],
  folder: "Plant floor",
}
const parse = (value: unknown) => parseDefinitions(JSON.stringify(value))
const withWidget = (widget: unknown) => ({ ...exported, widgets: [widget] })

describe("export", () => {
  it("keeps only the portable fields", () => {
    const dashboard = { ...exported, uuid: "x", revision: 3, starred: true } as unknown as Dashboard
    expect(definition(dashboard)).toEqual(exported)
  })
})

describe("import", () => {
  it("accepts an exported dashboard, a list, and a raw API response", () => {
    const { definitions, errors } = parse(exported)
    expect(errors).toEqual([])
    expect(definitions[0].widgets[0].config.sources[0]).toEqual({ ...source, device_name: undefined })
    // Server-set names are not sent; the server fills them from the device.
    expect(definitions[0].widgets[3].config.devices).toEqual([{ device_uuid: device }])
    expect(parse([exported, exported]).definitions).toHaveLength(2)
    expect(parse({ ...exported, uuid: "x", revision: 4, starred: false }).errors).toEqual([])
  })

  it("rebuilds the payload instead of forwarding parsed objects", () => {
    const [result] = parse(exported).definitions
    const raw = JSON.parse(JSON.stringify(exported))
    expect(result.widgets[0]).not.toBe(raw.widgets[0])
    expect(Object.keys(result.widgets[0].config)).toEqual(["sources"])
  })

  it("rejects dangerous and unknown keys at any depth", () => {
    const text = JSON.stringify(exported)
    for (const [needle, key] of [
      ['"sources":[{', '"sources":[{"__proto__":{"polluted":true},'],
      ['"base":{', '"base":{"constructor":{"prototype":{}},'],
      ['"lg":[{', '"lg":[{"prototype":1,'],
      ['"name":"Plant"', '"__proto__":{"x":1},"name":"Plant"'],
    ]) {
      const result = parseDefinitions(text.replace(needle, key))
      expect(result.definitions).toEqual([])
      expect(result.errors[0]).toMatch(/has an unknown key "(__proto__|constructor|prototype)"/)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("checks nested panel, layout and default shapes", () => {
    const cases: [unknown, string][] = [
      [withWidget({ ...exported.widgets[2], config: { sources: [], text: { html: "<b>" } } }), "Panel 1 (Notes) · config.text must be text of 1 to 4000 characters."],
      [withWidget({ ...exported.widgets[0], config: { sources: [], text: "x" } }), 'Panel 1 (Temp) · config has an unknown key "text".'],
      [withWidget({ ...exported.widgets[1], config: { sources: [], min: 5, max: 5 } }), "Panel 1 (Gauge) · config.max must be greater than min."],
      [withWidget({ ...exported.widgets[0], type: "iframe" }), "Panel 1 (Temp) · type must be one of"],
      [withWidget({ ...exported.widgets[0], config: { sources: [{ ...source, color: "red" }] } }), "Panel 1 (Temp) · config.sources.0.color must be a colour like #2563eb."],
      [withWidget({ ...exported.widgets[0], config: { sources: [{ ...source, device_uuid: "abc" }] } }), "Panel 1 (Temp) · config.sources.0.device_uuid must be a UUID."],
      [withWidget({ ...exported.widgets[0], config: { sources: [{ ...source, thresholds: [{ value: "hot", label: "x", color: "#000000" }] }] } }), "config.sources.0.thresholds.0.value must be a number."],
      [{ ...exported, layouts: { lg: [{ i: "w1", x: 11, y: 0, w: 13, h: 6 }] } }, "layouts.lg.0.w must be a whole number from 1 to 12."],
      [{ ...exported, layouts: { huge: [] } }, 'layouts has an unknown key "huge".'],
      [{ ...exported, defaults: { ...exported.defaults, refresh: 7 } }, "defaults.refresh must be one of 0, 5, 10, 30, 60."],
      [{ ...exported, tags: ["x".repeat(33)] }, "tags.0 must be text of 1 to 32 characters."],
      [{ ...exported, name: "" }, "name must be text of 1 to 120 characters."],
    ]
    for (const [value, message] of cases) expect(parse(value).errors[0]).toContain(message)
  })

  it("bounds file size, dashboard count and panels per dashboard", () => {
    expect(parseDefinitions(" ".repeat(MAX_IMPORT_BYTES + 1)).errors).toEqual([FILE_TOO_LARGE])
    expect(parse(Array.from({ length: 101 }, () => exported)).errors).toEqual([
      "The file has more than 100 dashboards.",
    ])
    const panels = Array.from({ length: 101 }, (_, i) => ({ ...exported.widgets[2], id: `w${i}` }))
    expect(parse({ ...exported, widgets: panels }).errors).toEqual([
      "widgets must be a list of up to 100 items.",
    ])
    expect(parseDefinitions("{").errors).toEqual(["The file is not valid JSON."])
    expect(parseDefinitions("[]").errors).toEqual(["The file has no dashboards."])
    expect(parse([exported, 1]).errors).toEqual(["Dashboard 2: dashboard must be an object."])
  })

  it("labels server field errors by panel", () => {
    expect(fieldLabel("widgets.0.config.sources.0.device_uuid", exported.widgets)).toBe(
      "Panel 1 (Temp) · config.sources.0.device_uuid",
    )
    expect(fieldLabel("name")).toBe("name")
  })
})
