import { describe, expect, it } from "vitest"
import { ApiError, type DeviceDefinition, type DeviceProfileParameter } from "@iot-os/api-client"
import {
  autoMatches,
  conversionMatters,
  draftProblems,
  isAutoMatch,
  metricFits,
  sameConfiguration,
} from "./mapping"

const parameter = (
  key: string,
  label: string,
  data_type: DeviceProfileParameter["data_type"] = "number",
  ingress_conversion: DeviceProfileParameter["ingress_conversion"] = null,
) => ({ uuid: "p-" + key, key, label, data_type, ingress_conversion })
const metric = (name: string, datatype: string) => ({ name, datatype, value: 1 })

describe("metricFits", () => {
  it("accepts the datatypes the API accepts", () => {
    expect(metricFits(parameter("t", "T"), "Int16")).toBe(true)
    expect(metricFits(parameter("t", "T", "integer"), "Double")).toBe(false)
    expect(metricFits(parameter("on", "On", "boolean"), "String")).toBe(false)
  })
  it("lets a converted float feed an integer", () => {
    const counts = parameter("c", "Count", "integer", { source_unit: null, multiplier: 10, offset: 0 })
    expect(metricFits(counts, "Float")).toBe(true)
  })
})

describe("autoMatches", () => {
  it("matches names loosely and skips incompatible types", () => {
    const parameters = [
      parameter("pm2_5", "PM2.5"),
      parameter("co2", "CO2", "integer"),
      parameter("humidity", "Humidity"),
    ]
    expect(
      autoMatches(parameters, [
        metric("pm 2.5", "Float"),
        metric("CO2", "Double"),
        metric("Humidity", "Float"),
      ]),
    ).toEqual([
      { parameter_uuid: "p-pm2_5", metric: "pm 2.5", command_metric: null },
      { parameter_uuid: "p-humidity", metric: "Humidity", command_metric: null },
    ])
  })
})

describe("isAutoMatch", () => {
  const match = { parameter_uuid: "p", metric: "T", command_metric: null }
  it("stops counting once the row is customised", () => {
    expect(isAutoMatch({ ...match }, match)).toBe(true)
    expect(isAutoMatch({ ...match, metric: "U" }, match)).toBe(false)
    expect(isAutoMatch({ ...match, conversion_mode: "none" }, match)).toBe(false)
    expect(isAutoMatch(undefined, match)).toBe(false)
  })
})

describe("conversionMatters", () => {
  const mapping = { parameter_uuid: "p-t", metric: "T", command_metric: null }
  it("hides the control when the source is already in the stored form", () => {
    expect(conversionMatters(parameter("t", "T"), mapping, metric("T", "Double"))).toBe(false)
  })
  it("shows it for a type change, a profile conversion or a device override", () => {
    expect(conversionMatters(parameter("t", "T"), mapping, metric("T", "Int16"))).toBe(true)
    expect(
      conversionMatters(
        parameter("t", "T", "number", { source_unit: "°F", multiplier: 0.5556, offset: -17.78 }),
        mapping,
        metric("T", "Double"),
      ),
    ).toBe(true)
    expect(
      conversionMatters(parameter("t", "T"), { ...mapping, conversion_mode: "none" }, metric("T", "Double")),
    ).toBe(true)
  })
})

describe("draftProblems", () => {
  const mappings = [
    { parameter_uuid: "p-a", metric: "A", command_metric: null },
    { parameter_uuid: "p-b", metric: "B", command_metric: "B" },
  ]
  it("puts mapping errors on their rows and keeps the rest general", () => {
    const error = new ApiError(422, {
      message: "Invalid",
      errors: {
        "mappings.0": ["The source datatype is incompatible with this profile parameter."],
        "mappings.1.command_metric": ["Commands require a writable profile parameter."],
        "mappings.1.ingress_conversion": ["The multiplier must not be zero."],
        "mappings.p-c": ["Map C before activation."],
        runtime: ["The runtime rejected this configuration."],
      },
    })
    expect(draftProblems(error, mappings)).toEqual({
      rows: {
        "p-a": { metric: "The source datatype is incompatible with this profile parameter." },
        "p-b": {
          command: "Commands require a writable profile parameter.",
          conversion: "The multiplier must not be zero.",
        },
        "p-c": { metric: "Map C before activation." },
      },
      general: ["The runtime rejected this configuration."],
    })
  })
  it("falls back to the message and ignores other failures", () => {
    expect(draftProblems(new ApiError(422, { message: "Select a discovered source." }), [])).toEqual({
      rows: {},
      general: ["Select a discovered source."],
    })
    expect(draftProblems(new ApiError(409, {}), mappings)).toBeNull()
  })
})

describe("sameConfiguration", () => {
  const definition = {
    profile_artifact_uuid: "artifact",
    birth_revision: 2,
    source: { candidate_uuid: "source" },
    mappings: [
      { parameter_uuid: "p-b", metric: "B", command_metric: null, conversion_mode: "profile", ingress_conversion: { source_unit: "°F", multiplier: 2, offset: 0 } },
      { parameter_uuid: "p-a", metric: "A", command_metric: null, conversion_mode: "custom", ingress_conversion: { source_unit: null, multiplier: 10, offset: 1 } },
    ],
  } as unknown as DeviceDefinition
  const draft = {
    artifact_uuid: "artifact",
    candidate_uuid: "source",
    birth_revision: 2,
    mappings: [
      { parameter_uuid: "p-a", metric: "A", command_metric: null, conversion_mode: "custom" as const, ingress_conversion: { offset: 1, multiplier: 10, source_unit: null } },
      { parameter_uuid: "p-b", metric: "B", command_metric: null },
    ],
  }
  it("ignores order and the resolved profile conversion", () => {
    expect(sameConfiguration(draft, definition)).toBe(true)
  })
  it("notices a changed source metric or birth", () => {
    expect(sameConfiguration({ ...draft, birth_revision: 3 }, definition)).toBe(false)
    expect(
      sameConfiguration({ ...draft, mappings: [draft.mappings[0], { ...draft.mappings[1], metric: "C" }] }, definition),
    ).toBe(false)
    expect(sameConfiguration(draft, undefined)).toBe(false)
  })
})
