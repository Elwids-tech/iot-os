import { describe, expect, it } from "vitest"
import type { DeviceProfileParameter } from "@iot-os/api-client"
import { stateChoices } from "./StateColorsSection"

const parameter = (patch: Partial<DeviceProfileParameter>) =>
  ({ uuid: "p", key: "mode", label: "Mode", kind: "state", data_type: "enum", format: null, unit: null, reports_state: true, accepts_command: false, validation: null, display: null, reporting: null, counter: null, ...patch }) as DeviceProfileParameter

describe("state colour choices", () => {
  it("offers On and Off for booleans with the profile's tones and the panel's colour", () => {
    const choices = stateChoices(
      { data_type: "boolean", state_colors: [{ value: false, color: "#123456" }] },
      parameter({ data_type: "boolean", display: { states: [{ value: true, label: "Running", tone: "good" }] } }),
    )
    expect(choices.map(({ value, label, profileColor, color, listed }) => [value, label, profileColor, color, listed])).toEqual([
      [true, "Running", "#006133", undefined, true],
      [false, "Off (0)", "#64748b", "#123456", true],
    ])
  })

  it("lists enum options and labelled states once, then values only the panel colours", () => {
    const choices = stateChoices(
      { data_type: "enum", state_colors: [{ value: "idle", color: "#111111" }, { value: "service", color: "#222222" }] },
      parameter({
        validation: { rule: { in: [{ var: "value" }, ["idle", "running"]] } },
        display: { states: [{ value: "running", label: "Running", tone: "muted" }, { value: "fault", label: "Fault", tone: "critical" }] },
      }),
    )
    expect(choices.map(({ value, label, color, listed }) => [value, label, color, listed])).toEqual([
      ["idle", "idle", "#111111", true],
      ["running", "Running", undefined, true],
      ["fault", "Fault", undefined, true],
      ["service", "service", "#222222", false],
    ])
    expect(choices[1].profileColor).toBe("#64748b")
    expect(choices[2].profileColor).toBe("#be1218")
  })
})
