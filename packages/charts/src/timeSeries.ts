import type { ChartOption } from "./core"
import { axisStyle, tooltipStyle } from "./styles"
import { escapeHtml, withAlpha, type ChartTheme } from "./theme"

export type TimePoint = { time: number; value: number | null }

export type TimeLine = {
  key: string
  name: string
  /** Any CSS colour, including var(--series-1). */
  color: string
  points: TimePoint[]
  /** A comparison line, such as the previous period: dashed and faded. */
  ghost?: boolean
  /** Bridge missing samples instead of breaking the line. */
  connectNulls?: boolean
}

/** A shaded time range, such as an alert episode. */
export type TimeArea = { from: number; to: number; color: string }
/** A vertical mark at one moment, such as a command. */
export type TimeMarker = { at: number; color: string }
/** A dashed horizontal line, such as a threshold. */
export type ValueLine = { value: number; color: string; label?: string }
/** A shaded value range between thresholds; null means open-ended. */
export type ValueBand = { from: number | null; to: number | null; color: string }

export type TimeSeriesInput = {
  lines: TimeLine[]
  /** Axis bounds in epoch milliseconds; omitted bounds follow the data. */
  from?: number
  to?: number
  formatTick: (time: number) => string
  formatTime: (time: number) => string
  formatValue: (value: number, line: TimeLine) => string
  areas?: TimeArea[]
  markers?: TimeMarker[]
  thresholds?: ValueLine[]
  bands?: ValueBand[]
  /** Draws the brush used to drag-select a time range (see EChart onSelectRange). */
  selectable?: boolean
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 })

type AxisParam = { seriesIndex: number; axisValue?: number; value?: [number, number | null] }

/**
 * Lines over a time axis, drawn with the app's tokens: recessive axes, a
 * crosshair tooltip listing every line, threshold bands and lines, shaded
 * episodes and command marks. Overlays never stretch the value axis.
 */
export function timeSeriesOption(theme: ChartTheme, input: TimeSeriesInput): ChartOption {
  const axis = axisStyle(theme)
  const colors = input.lines.map((line) => theme.color(line.color))
  const primary = theme.color("var(--primary)")

  const markArea = {
    silent: true,
    animation: false,
    data: [
      // Infinity reaches the edge of the plot, whatever the value axis shows.
      ...(input.bands ?? []).map((band) => [
        { yAxis: band.from ?? -Infinity, itemStyle: { color: withAlpha(theme.color(band.color), 0.08) } },
        { yAxis: band.to ?? Infinity },
      ]),
      ...(input.areas ?? []).map((area) => [
        { xAxis: area.from, itemStyle: { color: withAlpha(theme.color(area.color), 0.12) } },
        { xAxis: area.to },
      ]),
    ],
  }
  const markLine = {
    silent: true,
    animation: false,
    symbol: "none",
    data: [
      ...(input.thresholds ?? []).map((line) => {
        const color = theme.color(line.color)
        return {
          yAxis: line.value,
          lineStyle: { color, type: [4, 4], width: 1, opacity: 0.75 },
          label: {
            show: Boolean(line.label),
            formatter: line.label ?? "",
            position: "insideEndTop",
            color,
            fontFamily: theme.monoFamily,
            fontSize: 10,
          },
        }
      }),
      ...(input.markers ?? []).map((marker) => ({
        xAxis: marker.at,
        lineStyle: { color: theme.color(marker.color), type: [2, 3], width: 1 },
        label: { show: false },
      })),
    ],
  }

  const row = (color: string, name: string, value: string, ghost: boolean) =>
    `<div style="display:flex;justify-content:space-between;gap:16px;align-items:center">
      <span style="display:flex;align-items:center;gap:6px;min-width:0"><span style="width:12px;height:0;flex:none;border-top:2px ${ghost ? "dashed" : "solid"} ${color}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:16rem">${escapeHtml(name)}</span></span>
      <span style="font-family:${escapeHtml(theme.monoFamily)};font-variant-numeric:tabular-nums">${escapeHtml(value)}</span>
    </div>`

  return {
    animation: false,
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: "time",
      min: input.from,
      max: input.to,
      ...axis,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => input.formatTick(value) },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axis,
      axisLine: { show: false },
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.muted, width: 1 }, label: { show: false } },
      ...tooltipStyle(theme),
      formatter: (raw: unknown) => {
        const params = (Array.isArray(raw) ? raw : [raw]) as AxisParam[]
        const time = params[0]?.axisValue ?? params[0]?.value?.[0]
        const rows = params
          .filter((param) => input.lines[param.seriesIndex])
          .map((param) => {
            const line = input.lines[param.seriesIndex]
            const value = param.value?.[1]
            return row(
              colors[param.seriesIndex],
              line.name,
              typeof value === "number" ? input.formatValue(value, line) : "No sample",
              Boolean(line.ghost),
            )
          })
          .join("")
        return `${time === undefined ? "" : `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(input.formatTime(Number(time)))}</div>`}${rows}`
      },
    },
    ...(input.selectable
      ? {
          brush: {
            xAxisIndex: 0,
            brushType: "lineX",
            brushMode: "single",
            transformable: false,
            outOfBrush: { colorAlpha: 1 },
            brushStyle: { color: withAlpha(primary, 0.12), borderColor: withAlpha(primary, 0.4), borderWidth: 1 },
          },
        }
      : {}),
    series: input.lines.map((line, index) => ({
      type: "line" as const,
      name: line.name,
      data: line.points.map((point) => [point.time, point.value]),
      // A lone sample or two would be invisible as a line.
      showSymbol: line.points.filter((point) => point.value !== null).length < 3,
      symbolSize: 6,
      connectNulls: line.connectNulls ?? false,
      lineStyle: {
        color: colors[index],
        width: line.ghost ? 1.25 : 1.75,
        type: line.ghost ? [4, 3] : "solid",
        opacity: line.ghost ? 0.55 : 1,
      },
      itemStyle: { color: colors[index], opacity: line.ghost ? 0.55 : 1 },
      emphasis: { disabled: true },
      ...(index === 0 ? { markArea, markLine } : {}),
    })),
  } as ChartOption
}
