import { describe, expect, it } from "vitest"
import type { DeviceDetail, DeviceProfileParameter } from "@iot-os/api-client"
import { profilePanels, TEMPLATES, withLayout } from "./templates"

const parameter = (
  key: string,
  values: Partial<DeviceProfileParameter> = {},
): DeviceProfileParameter => ({
  uuid: `${key}-uuid`,
  key,
  label: key,
  kind: "measurement",
  reports_state: true,
  accepts_command: false,
  data_type: "number",
  format: null,
  unit: "V",
  validation: null,
  display: null,
  reporting: null,
  counter: null,
  ...values,
})
// Only the fields the generators read.
const device = (uuid: string, parameters: DeviceProfileParameter[]) =>
  ({
    uuid,
    name: `Device ${uuid}`,
    applied_configuration_uuid: "c1",
    last_applied_configuration_uuid: "c1",
    configurations: [
      {
        uuid: "c1",
        definition: {
          profile_canonical_json: JSON.stringify({ parameters }),
          mappings: parameters
            .filter((p) => p.accepts_command)
            .map((p) => ({ parameter_uuid: p.uuid, metric: p.key, command_metric: p.key })),
        },
      },
    ],
  }) as unknown as DeviceDetail

const meter = [
  parameter("voltage.l1"),
  parameter("voltage.l2"),
  parameter("voltage.l3"),
  parameter("voltage.average"),
  parameter("energy.imported", { unit: "kWh", kind: "counter" }),
  parameter("energy.exported", { unit: "kWh", kind: "counter" }),
]
const template = (id: string) => TEMPLATES.find((t) => t.id === id)!

describe("dashboard templates", () => {
  it("builds energy panels from matching keys across devices", () => {
    const widgets = template("energy").build([device("a", meter), device("b", meter)])
    expect(widgets.map((w) => [w.type, w.title, w.config.sources.length])).toEqual([
      ["status", "Phase voltage", 6],
      ["timeseries", "Phase voltage", 6],
      ["gauge", "Average voltage", 2],
      ["status", "Energy", 4],
      ["consumption", "Energy use", 4],
    ])
    expect(widgets[0].config.sources[3]).toMatchObject({
      device_uuid: "b",
      device_name: "Device b",
      parameter_uuid: "voltage.l1-uuid",
    })
    expect(widgets[2].config).toMatchObject({ min: 0, max: 300 })
  })

  it("drops panels whose parameters are missing and keeps device health", () => {
    expect(template("energy").build([device("a", [parameter("other")])])).toEqual([])
    const gps = template("gps").build([device("a", [parameter("other")])])
    expect(gps.map((w) => w.type)).toEqual(["device_health"])
    expect(gps[0].config.devices).toEqual([{ device_uuid: "a", device_name: "Device a" }])
  })

  it("builds light controls and history from writable state parameters", () => {
    const light = device("l", [
      parameter("power", { kind: "state", data_type: "boolean", unit: null, accepts_command: true }),
      parameter("color", {
        kind: "state",
        data_type: "string",
        unit: null,
        format: "hex_color",
        accepts_command: true,
      }),
    ])
    expect(template("rgb").build([light]).map((w) => [w.type, w.config.sources.length])).toEqual([
      ["controls", 2],
      ["state_history", 1],
      ["color_history", 1],
    ])
  })
})

describe("device profile panels", () => {
  it("adds a status per group, a chart per group and unit, consumption for counters, and controls", () => {
    const widgets = profilePanels(
      [
        device("a", [
          ...meter,
          parameter("mode", { kind: "state", data_type: "boolean", unit: null, accepts_command: true }),
        ]),
      ],
      (uuid) => (uuid.startsWith("energy") ? "Energy" : undefined),
    )
    expect(widgets.map((w) => [w.type, w.title, w.config.sources.length])).toEqual([
      ["status", "Latest values", 5],
      ["timeseries", "Trend (V)", 4],
      ["status", "Energy", 2],
      ["consumption", "Energy (kWh)", 2],
      ["controls", "Controls", 1],
    ])
    const { widgets: placed, layouts } = withLayout(widgets)
    expect(new Set(placed.map((w) => w.id)).size).toBe(5)
    expect(layouts.lg?.map((l) => l.i)).toEqual(placed.map((w) => w.id))
  })
})
