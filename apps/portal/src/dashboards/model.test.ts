import { describe, expect, it, vi } from "vitest"
import type {
  DashboardSource,
  DeviceDetail,
  Measurement,
} from "@iot-os/api-client"
import {
  absoluteError,
  appendLayout,
  appliedParameters,
  bandFor,
  cleanLayouts,
  dateInput,
  DEFAULT_VIEW,
  inputDate,
  newWidget,
  readView,
  resolveRange,
  responsiveLayouts,
  thresholdError,
  widgetError,
  writeView,
} from "./model"
import { createRequestQueue } from "./requests"

const source: DashboardSource = {
  device_uuid: "device",
  parameter_uuid: "parameter",
  label: "Temperature",
  unit: "C",
  data_type: "number",
  precision: null,
  color: "#2563eb",
  base: { label: "Below range", color: "#64748b" },
  thresholds: [-10, 0, 20, 40, 80].map((value) => ({
    value,
    label: String(value),
    color: "#2563eb",
  })),
}
const reading = (value: number, quality: Measurement["quality"] = "good") =>
  ({ value, quality }) as Measurement
describe("per-parameter thresholds", () => {
  it("supports more than three bands, negatives, and inclusive lower boundaries", () => {
    expect(bandFor(source, reading(-11)).label).toBe("Below range")
    expect(bandFor(source, reading(-10)).label).toBe("-10")
    expect(bandFor(source, reading(19.99)).label).toBe("0")
    expect(bandFor(source, reading(20)).label).toBe("20")
    expect(bandFor(source, reading(900)).label).toBe("80")
  })
  it("prioritizes measurement quality and handles no reading", () => {
    for (const state of ["stale", "invalid", "inactive"] as const)
      expect(bandFor(source, reading(20, state)).label).toBe(state)
    expect(bandFor(source).label).toBe("No reading")
  })
  it("rejects duplicate and non-finite boundaries", () => {
    expect(
      thresholdError({
        ...source,
        thresholds: [source.thresholds[0], source.thresholds[0]],
      }),
    ).toMatch(/unique/)
    expect(
      thresholdError({
        ...source,
        thresholds: [{ ...source.thresholds[0], value: NaN }],
      }),
    ).toMatch(/finite/)
    expect(thresholdError(source)).toBeNull()
  })
  it("creates panels without domain-specific rules and validates chart units", () => {
    const panel = newWidget("timeseries")
    expect(panel.config.sources).toEqual([])
    panel.config.sources = [
      source,
      { ...source, parameter_uuid: "another", unit: "V" },
    ]
    expect(widgetError(panel)).toMatch(/same unit/)
    panel.config.sources[1].unit = "C"
    expect(widgetError(panel)).toBeNull()
  })
})
describe("historical viewing state", () => {
  it("rolls relative ranges but never moves absolute ranges", () => {
    const at = Date.parse("2026-09-09T12:00:00Z")
    const window = resolveRange(DEFAULT_VIEW.range, at)
    expect(window).toEqual({
      from: "2026-09-09T06:00:00.000Z",
      to: "2026-09-09T12:00:00.000Z",
    })
    expect(resolveRange({ mode: "absolute", ...window }, at + 10000)).toEqual(
      window,
    )
  })
  it("round trips independent URL overrides without mutating saved defaults", () => {
    const before = structuredClone(DEFAULT_VIEW)
    const value = {
      ...DEFAULT_VIEW,
      timezone: "utc" as const,
      refresh: 0 as const,
      range: {
        mode: "absolute" as const,
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
      },
    }
    const params = writeView(new URLSearchParams("keep=yes&range=6h"), value)
    expect(readView(params, DEFAULT_VIEW)).toEqual(value)
    expect(params.get("keep")).toBe("yes")
    expect(params.has("range")).toBe(false)
    expect(DEFAULT_VIEW).toEqual(before)
    expect(readView(new URLSearchParams(), DEFAULT_VIEW)).toEqual(before)
  })
  it("validates ordering, future times, and maximum intervals", () => {
    expect(absoluteError("bad", "bad")).toMatch(/valid/)
    expect(absoluteError("2026-01-02", "2026-01-01")).toMatch(/after/)
    expect(absoluteError("2026-01-01", "2099-01-01")).toMatch(/future/)
    expect(absoluteError("2025-01-01", "2026-01-01")).toMatch(/90 days/)
  })
  it("converts UTC and local inputs using the date-specific offset", () => {
    const iso = "2026-01-15T12:30:45.000Z"
    expect(inputDate(dateInput(iso, "utc"), "utc")).toBe(iso)
    expect(inputDate(dateInput(iso, "browser"), "browser")).toBe(iso)
    expect(inputDate("not a date", "browser")).toBe("")
  })
})
describe("configuration and layout", () => {
  it("scales missing breakpoints without changing saved layouts", () => {
    const layout = {
      lg: [
        { i: "one", x: 0, y: 0, w: 6, h: 6 },
        { i: "two", x: 6, y: 0, w: 6, h: 6 },
      ],
    }
    const result = responsiveLayouts(layout)
    expect(result.md?.map((i) => [i.x, i.w, i.y])).toEqual([
      [0, 5, 0],
      [5, 5, 0],
    ])
    expect(result.xs?.map((i) => [i.x, i.w, i.y])).toEqual([
      [0, 1, 0],
      [0, 1, 6],
    ])
    expect(result.lg).toEqual(layout.lg)
    expect(Object.keys(layout)).toEqual(["lg"])
  })
  it("offers last-applied parameters without latest telemetry", () => {
    const device = {
      applied_configuration_uuid: null,
      last_applied_configuration_uuid: "previous",
      configurations: [
        {
          uuid: "previous",
          definition: {
            profile_canonical_json: JSON.stringify({
              parameters: [{ uuid: "p", label: "Awaiting measurement" }],
            }),
          },
        },
      ],
    } as unknown as DeviceDetail
    expect(appliedParameters(device)[0].label).toBe("Awaiting measurement")
  })
  it("preserves layout IDs and appends independently at each breakpoint", () => {
    const original = {
      lg: [{ i: "one", x: 0, y: 0, w: 6, h: 5 }],
      xs: [{ i: "one", x: 0, y: 0, w: 1, h: 5 }],
    }
    const next = appendLayout(original, "two")
    expect(next.lg?.[1]).toEqual({ i: "two", x: 6, y: 0, w: 6, h: 6 })
    expect(next.xs?.[1].w).toBe(1)
    expect(original.lg).toHaveLength(1)
    expect(cleanLayouts(next)).toEqual(next)
  })
})
it("bounds concurrent requests and removes aborted queued work", async () => {
  const run = createRequestQueue(1),
    controller = new AbortController()
  let release!: () => void
  const first = run(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  await Promise.resolve()
  const request = vi.fn(async () => 1)
  const second = run(controller.signal, request)
  const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" })
  controller.abort()
  await rejected
  release()
  await first
  expect(request).not.toHaveBeenCalled()
  await expect(run(new AbortController().signal, async () => 2)).resolves.toBe(
    2,
  )
})
