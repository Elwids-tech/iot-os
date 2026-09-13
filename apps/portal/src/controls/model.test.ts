import { describe, expect, it } from "vitest"
import type { DeviceProfileParameter, JsonObject } from "@iot-os/api-client"
import { controlSpec, parseControlValue } from "./model"
const parameter = (
  values: Partial<DeviceProfileParameter>,
): DeviceProfileParameter => ({
  uuid: "parameter",
  key: "anything",
  label: "Any device",
  kind: "state",
  reports_state: true,
  accepts_command: true,
  data_type: "string",
  format: null,
  unit: null,
  validation: null,
  display: null,
  reporting: null,
  counter: null,
  ...values,
})
describe("parameter controls", () => {
  it("chooses controls from metadata rather than device or parameter names", () => {
    expect(controlSpec(parameter({ data_type: "boolean" })).kind).toBe("switch")
    expect(controlSpec(parameter({ format: "hex_color" })).kind).toBe("color")
    expect(
      controlSpec(
        parameter({
          data_type: "integer",
          display: { widget: "slider", step: 1 },
          validation: {
            rule: {
              and: [
                { ">=": [{ var: "value" }, 0] },
                { "<=": [{ var: "value" }, 100] },
              ],
            },
          },
        }),
      ).kind,
    ).toBe("slider")
    expect(controlSpec(parameter({ data_type: "bytes" })).kind).toBe(
      "unsupported",
    )
  })
  it("uses validation options without turning display suggestions into restrictions", () => {
    expect(
      controlSpec(
        parameter({ display: { widget: "select", options: ["a", "b"] } }),
      ).kind,
    ).toBe("text")
    expect(
      controlSpec(
        parameter({
          data_type: "enum",
          display: { widget: "toggle_group" },
          validation: { rule: { in: [{ var: "value" }, ["a", "b"]] } },
        }),
      ).options,
    ).toEqual(["a", "b"])
    expect(
      controlSpec(
        parameter({
          data_type: "enum",
          display: { widget: "searchable_select" },
          validation: { rule: { in: [{ var: "value" }, ["a", "b"]] } },
        }),
      ).optionControl,
    ).toBe("searchable_select")
    expect(controlSpec(parameter({ data_type: "enum" })).kind).toBe(
      "unsupported",
    )
  })
  it("honours an explicit compatible widget before automatic inference", () => {
    const allowed = {
      rule: { in: [{ var: "value" }, ["solid", "blink"]] },
    }
    expect(
      controlSpec(parameter({ validation: allowed, display: null })).kind,
    ).toBe("options")
    expect(
      controlSpec(
        parameter({ validation: allowed, display: { widget: "text" } }),
      ).kind,
    ).toBe("text")

    const numericAllowed = {
      rule: { in: [{ var: "value" }, [10, 20]] },
    }
    expect(
      controlSpec(
        parameter({
          data_type: "integer",
          validation: numericAllowed,
          display: { widget: "number" },
        }),
      ).kind,
    ).toBe("number")
  })
  it("falls back when slider bounds or integer steps are incompatible", () => {
    for (const display of [
      { widget: "slider" },
      { widget: "slider", min: 100, max: 0 },
      { widget: "slider", min: 0, max: 100, step: 0.5 },
    ] as JsonObject[])
      expect(
        controlSpec(parameter({ data_type: "integer", display })).kind,
      ).toBe("number")
  })
  it("preserves typed values and rejects invalid numeric or colour input", () => {
    expect(
      parseControlValue(parameter({ data_type: "boolean" }), "false"),
    ).toBe(false)
    expect(
      parseControlValue(parameter({ format: "hex_color" }), "#aAbB01"),
    ).toBe("#AABB01")
    for (const value of ["", "Infinity", "1.2", "9007199254740992"])
      expect(() =>
        parseControlValue(parameter({ data_type: "integer" }), value),
      ).toThrow()
    expect(() =>
      parseControlValue(parameter({ format: "hex_color" }), "red"),
    ).toThrow()
    const enumeration = parameter({
      data_type: "enum",
      validation: { rule: { in: [{ var: "value" }, ["solid", "blink"]] } },
    })
    expect(parseControlValue(enumeration, "blink")).toBe("blink")
    expect(() => parseControlValue(enumeration, "strobe")).toThrow()
    const brightness = parameter({
      data_type: "integer",
      validation: {
        rule: {
          and: [
            { ">=": [{ var: "value" }, 0] },
            { "<=": [{ var: "value" }, 100] },
          ],
        },
      },
    })
    expect(() => parseControlValue(brightness, "101")).toThrow(
      "no greater than 100",
    )
  })
})
