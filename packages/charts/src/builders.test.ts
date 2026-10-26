import { describe, expect, it } from "vitest"
import { init } from "./core"
import { gaugeOption, type GaugeInput } from "./gauge"
import type { ChartTheme } from "./theme"
import { timelineOption } from "./timeline"
import { timeSeriesOption, type TimeLine } from "./timeSeries"

// Colours resolve to themselves so assertions read the tokens back.
const theme: ChartTheme = {
  foreground: "rgb(0, 0, 0)",
  muted: "rgb(100, 100, 100)",
  border: "rgb(200, 200, 200)",
  surface: "rgb(255, 255, 255)",
  popover: "rgb(255, 255, 255)",
  popoverForeground: "rgb(0, 0, 0)",
  fontFamily: "sans-serif",
  monoFamily: "monospace",
  radius: 4,
  reducedMotion: false,
  color: (value) => value,
}
const line = (key: string, extra: Partial<TimeLine> = {}): TimeLine => ({
  key,
  name: key,
  color: "rgb(1, 2, 3)",
  points: [
    { time: 1000, value: 1 },
    { time: 2000, value: null },
    { time: 3000, value: 3 },
  ],
  ...extra,
})
const format = { formatTick: String, formatTime: (t: number) => `t${t}`, formatValue: (v: number) => `${v} V` }

describe("timeSeriesOption", () => {
  it("keeps gaps, fades comparison lines and puts overlays on the first line only", () => {
    const option = timeSeriesOption(theme, {
      ...format,
      lines: [line("now"), line("previous", { ghost: true })],
      from: 0,
      to: 4000,
      thresholds: [{ value: 2, color: "rgb(9, 9, 9)", label: "High 2 V" }],
      bands: [{ from: 2, to: null, color: "rgb(9, 9, 9)" }],
      areas: [{ from: 1500, to: 2500, color: "rgb(8, 8, 8)" }],
      markers: [{ at: 2200, color: "rgb(7, 7, 7)" }],
    }) as any
    expect(option.xAxis).toMatchObject({ type: "time", min: 0, max: 4000 })
    expect(option.series[0].data).toEqual([[1000, 1], [2000, null], [3000, 3]])
    expect(option.series[0].connectNulls).toBe(false)
    expect(option.series[1].lineStyle).toMatchObject({ type: [4, 3], opacity: 0.55 })
    expect(option.series[1].markArea).toBeUndefined()
    const areas = option.series[0].markArea.data
    expect(areas[0]).toEqual([{ yAxis: 2, itemStyle: { color: "rgba(9, 9, 9, 0.08)" } }, { yAxis: Infinity }])
    expect(areas[1][0]).toMatchObject({ xAxis: 1500 })
    const lines = option.series[0].markLine.data
    expect(lines[0]).toMatchObject({ yAxis: 2, label: { show: true, formatter: "High 2 V" } })
    expect(lines[1]).toMatchObject({ xAxis: 2200 })
  })

  it("lists every line in the tooltip and says when one has no sample", () => {
    const option = timeSeriesOption(theme, { ...format, lines: [line("L1"), line("L2")] }) as any
    const html: string = option.tooltip.formatter([
      { seriesIndex: 0, axisValue: 2000, value: [2000, 230.5] },
      { seriesIndex: 1, axisValue: 2000, value: [2000, null] },
    ])
    expect(html).toContain("t2000")
    expect(html).toContain("230.5 V")
    expect(html).toContain("No sample")
  })

  it("escapes names that come from user data", () => {
    const option = timeSeriesOption(theme, { ...format, lines: [line("<b>x</b>")] }) as any
    expect(option.tooltip.formatter([{ seriesIndex: 0, axisValue: 1, value: [1, 1] }])).toContain("&lt;b&gt;x&lt;/b&gt;")
  })

  it("draws a brush only when the chart is selectable", () => {
    expect((timeSeriesOption(theme, { ...format, lines: [line("a")] }) as any).brush).toBeUndefined()
    expect((timeSeriesOption(theme, { ...format, lines: [line("a")], selectable: true }) as any).brush).toMatchObject({
      xAxisIndex: 0,
      brushType: "lineX",
    })
  })
})

describe("timelineOption", () => {
  it("describes a segment with its span and duration", () => {
    const option = timelineOption(theme, {
      segments: [{ from: 0, to: 60000, color: "rgb(0, 128, 0)", label: "On", detail: "Revision 2" }],
      from: 0,
      to: 120000,
      formatTick: String,
      formatTime: (t) => `t${t}`,
      formatDuration: (ms) => `${ms / 1000} s`,
    }) as any
    const html: string = option.tooltip.formatter({ dataIndex: 0 })
    expect(html).toContain("On")
    expect(html).toContain("t0 to t60000")
    expect(html).toContain("60 s · Revision 2")
  })
})

describe("gaugeOption", () => {
  it("tints the track by band, clamps the value and hides the arc without a reading", () => {
    const option = gaugeOption(theme, {
      min: 0,
      max: 80,
      value: 95,
      color: "rgb(1, 1, 1)",
      bands: [
        { to: 0.8, color: "x", neutral: true },
        { to: 1, color: "rgb(200, 0, 0)" },
      ],
    }) as any
    expect(option.series[0].axisLine.lineStyle.color).toEqual([
      [0.8, "rgba(100, 100, 100, 0.18)"],
      [1, "rgba(200, 0, 0, 0.45)"],
    ])
    expect(option.series[0].data[0].value).toBe(80)
    const empty = (gaugeOption(theme, { min: 0, max: 1, value: null, color: "x", bands: [] }) as any).series[0]
    expect(empty.progress).toMatchObject({ show: true, itemStyle: { opacity: 0 } })
  })

  it("renders a reading that arrives after the gauge was drawn without one", () => {
    const chart = init(null, undefined, { renderer: "svg", ssr: true, width: 200, height: 120 })
    const input = (value: number | null): GaugeInput => ({ min: 0, max: 100, value, color: "rgb(1, 1, 1)", bands: [] })
    try {
      // The same sequence as a dashboard loading: no reading yet, then one.
      for (const value of [null, 42, null, 64]) {
        chart.setOption(gaugeOption(theme, input(value)), { notMerge: true })
        const arc = chart.renderToSVGString().split("\n").find((tag) => tag.includes('fill="rgb(1, 1, 1)"'))
        expect(arc).toBeDefined()
        expect(arc?.includes('fill-opacity="0"')).toBe(value === null)
      }
    } finally {
      chart.dispose()
    }
  })
})
