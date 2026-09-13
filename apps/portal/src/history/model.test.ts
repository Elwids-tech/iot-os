import { describe, expect, it } from "vitest"
import type {
  DashboardSource,
  DeviceConfiguration,
  DeviceProfileParameter,
  HistoryRecord,
} from "@iot-os/api-client"
import {
  booleanValue,
  buildHistoryCsv,
  configurationMeta,
  formatDuration,
  isColorParameter,
  isColorSource,
  stateColor,
  stateLabel,
  validHexColor,
} from "./model"

const parameter = (values: Partial<DeviceProfileParameter>) =>
  ({
    uuid: "parameter",
    key: "value",
    label: "Value",
    data_type: "string",
    ...values,
  }) as DeviceProfileParameter

describe("history semantics", () => {
  it("distinguishes colour strings from ordinary text", () => {
    expect(
      isColorParameter(parameter({ format: "hex_color", display: {} })),
    ).toBe(true)
    expect(
      isColorParameter(
        parameter({ format: null, display: { widget: "color" } }),
      ),
    ).toBe(true)
    expect(isColorParameter(parameter({ format: null, display: {} }))).toBe(
      false,
    )
    expect(
      isColorSource({
        data_type: "string",
        format: "hex_color",
      } as DashboardSource),
    ).toBe(true)
    expect(validHexColor("#a1B2c3")).toBe(true)
    expect(validHexColor("red")).toBe(false)
  })

  it("uses stable boolean labels and state colours", () => {
    expect(booleanValue("1")).toBe(true)
    expect(booleanValue(0)).toBe(false)
    expect(booleanValue("invalid")).toBeNull()
    expect(stateLabel(true, true, "boolean")).toBe("On (1)")
    expect(stateLabel(false, true, "boolean")).toBe("Off (0)")
    expect(stateLabel(null, false, "boolean")).toBe("Unknown")
    expect(stateColor(true, true, "boolean")).toBe("#16a34a")
    expect(stateColor(false, true, "boolean")).toBe("#64748b")
    expect(stateColor("alarm", true, "enum")).toBe(
      stateColor("alarm", true, "enum"),
    )
    expect(formatDuration(90_000)).toBe("1m 30s")
  })

  it("labels configuration and profile revisions independently", () => {
    const meta = configurationMeta(
      [
        {
          uuid: "configuration",
          revision: 3,
          profile_revision: 2,
        } as DeviceConfiguration,
      ],
      "configuration",
    )
    expect(meta.configurationLabel).toBe("Device configuration 3")
    expect(meta.profileLabel).toBe("Profile revision 2")
  })
})

describe("history CSV", () => {
  it("aggregates pages into oldest-first typed and escaped rows", () => {
    const records = [
      {
        event_uuid: "event-new",
        configuration_uuid: "configuration",
        parameter_uuid: "parameter",
        received_at: "2026-09-12T12:01:00.000Z",
        observed_at: "2026-09-12T12:00:59.000Z",
        data_type: "boolean",
        unit: null,
        value: false,
        quality: "good",
        diagnostic: "operator, requested",
      },
      {
        event_uuid: "event-old",
        configuration_uuid: "configuration",
        parameter_uuid: "parameter",
        received_at: "2026-09-12T12:00:00.000Z",
        observed_at: "2026-09-12T11:59:59.000Z",
        data_type: "boolean",
        unit: null,
        value: true,
        quality: "good",
        diagnostic: "line one\nline two",
      },
    ] satisfies HistoryRecord[]
    const configurations = [
      {
        uuid: "configuration",
        revision: 3,
        profile_artifact_uuid: "artifact",
        profile_uuid: "profile",
        profile_name: "RGB profile",
        profile_revision: 2,
      } as DeviceConfiguration,
    ]

    const csv = buildHistoryCsv(records, {
      deviceUuid: "device",
      deviceName: 'Pump, "North"',
      parameterUuid: "parameter",
      parameterKey: "enabled",
      parameterLabel: "Enabled",
      configurations,
    })
    const rows = csv.split("\r\n")

    expect(rows[0]).toContain("event_uuid")
    expect(rows[0]).toContain("profile_artifact_uuid")
    expect(rows[1]).toContain("event-old")
    expect(rows[1]).toContain(",1,boolean,")
    expect(rows[1]).toContain('"Pump, ""North"""')
    expect(rows[1]).toContain('"line one\nline two"')
    expect(rows[2]).toContain("event-new")
    expect(rows[2]).toContain(",0,boolean,")
    expect(rows[2]).toContain("RGB profile,profile,2,artifact")
    expect(records[0].event_uuid).toBe("event-new")
  })
})
