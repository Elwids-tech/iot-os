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
  csvCell,
  configurationMeta,
  emptyHistoryReason,
  formatDuration,
  isColorParameter,
  isColorSource,
  latestDataWindow,
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
  it("neutralizes formula text but keeps negative numbers numeric", () => {
    for (const text of ["=1+1", "+1", "-cmd", "@SUM(A1)", "\tx", "\rx"])
      expect(csvCell(text).replace(/^"|"$/g, "")).toMatch(/^'/)
    expect(csvCell(-114.012333)).toBe("-114.012333")
    expect(csvCell("Pump 1")).toBe("Pump 1")
    const csv = buildHistoryCsv(
      [
        {
          event_uuid: "event",
          configuration_uuid: "configuration",
          parameter_uuid: "parameter",
          received_at: "2026-09-12T12:00:00.000Z",
          observed_at: "2026-09-12T12:00:00.000Z",
          data_type: "number",
          unit: "deg",
          value: -114.012333,
          quality: "good",
        },
      ] as HistoryRecord[],
      {
        deviceUuid: "device",
        deviceName: "=HYPERLINK(\"x\")",
        parameterUuid: "parameter",
        parameterKey: "lon",
        parameterLabel: "@lon",
        configurations: [],
      },
    )
    const row = csv.split("\r\n")[1]
    expect(row).toContain(",-114.012333,number,")
    expect(row).toContain('"\'=HYPERLINK(""x"")"')
    expect(row).toContain(",'@lon,")
  })
})

describe("empty history ranges", () => {
  const day = { from: "2026-10-08T12:00:00.000Z", to: "2026-10-09T12:00:00.000Z" }
  const cutoff = "2026-09-09T12:00:00.000Z"
  it("offers the latest data when the device went quiet before the range", () => {
    expect(emptyHistoryReason(day, "2026-10-04T08:30:00.000Z", cutoff)).toBe("before-range")
    expect(latestDataWindow(day, "2026-10-04T08:30:00.000Z")).toEqual({
      from: "2026-10-03T08:31:00.000Z",
      to: "2026-10-04T08:31:00.000Z",
    })
  })
  it("mentions retention only when the range or the last data is past the cutoff", () => {
    expect(emptyHistoryReason({ from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" }, "2026-10-09T11:00:00Z", cutoff)).toBe("range-expired")
    expect(emptyHistoryReason(day, "2026-09-01T00:00:00Z", cutoff)).toBe("data-expired")
    expect(emptyHistoryReason(day, "2026-10-09T11:00:00Z", cutoff)).toBe("empty")
    expect(emptyHistoryReason(day, null, cutoff)).toBe("empty")
  })
})
