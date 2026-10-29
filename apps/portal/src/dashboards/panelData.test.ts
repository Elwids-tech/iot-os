import { describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import type { DashboardView, DashboardWidget, HistorySeries } from "@iot-os/api-client"
import { panelCsvRows } from "./panelData"

// The CSV reads the query cache only; the API client needs a browser.
vi.mock("../lib/api", () => ({ api: {} }))

describe("panel CSV rows", () => {
  it("exports readings, not the points that break a chart line", () => {
    const view = { range: { kind: "relative", duration: "24h" }, timezone: "browser", refresh: 0 } as unknown as DashboardView
    const widget = {
      type: "timeseries",
      config: { sources: [{ device_uuid: "device", parameter_uuid: "probe", device_name: "Sensor", label: "Probe temperature" }] },
    } as unknown as DashboardWidget
    const series: HistorySeries = {
      configuration_uuid: "configuration",
      unit: "°C",
      data_type: "number",
      points: [
        { at: "2026-10-28T19:38:54Z", value: 25.5, min: 25.5, max: 25.5, count: 1 },
        { at: "2026-10-28T19:40:21Z", value: null, count: 0 },
        { at: "2026-10-28T21:08:15Z", value: 25.75, min: 25.75, max: 25.75, count: 1 },
      ],
    }
    const cache = new QueryClient()
    cache.setQueryData(["dashboard-history", "org", "device", "probe", JSON.stringify(view.range), "current"], { series: [series] })

    expect(panelCsvRows(cache, "org", widget, view)).toEqual([
      ["time", "device", "parameter", "average", "unit", "min", "max", "samples"],
      ["2026-10-28T19:38:54Z", "Sensor", "Probe temperature", 25.5, "°C", 25.5, 25.5, 1],
      ["2026-10-28T21:08:15Z", "Sensor", "Probe temperature", 25.75, "°C", 25.75, 25.75, 1],
    ])
  })
})
