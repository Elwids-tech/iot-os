import { graphic } from "echarts/core"
import type { ChartOption } from "./core"
import { axisStyle, tooltipStyle } from "./styles"
import { escapeHtml, withAlpha, type ChartTheme } from "./theme"

export type TimeSegment = {
  from: number
  to: number
  /** Any CSS colour, including var(--success). */
  color: string
  label: string
  /** Extra tooltip line, such as the configuration in force. */
  detail?: string
  /** Unknown or invalid values draw as a pale block with a dashed outline. */
  unknown?: boolean
}

export type TimelineInput = {
  segments: TimeSegment[]
  from: number
  to: number
  formatTick: (time: number) => string
  formatTime: (time: number) => string
  formatDuration: (ms: number) => string
}

type RenderApi = {
  value: (dimension: number) => number
  coord: (value: [number, number]) => [number, number]
  size: (value: [number, number]) => [number, number]
}
type RenderParams = { dataIndex: number; coordSys: { x: number; y: number; width: number; height: number } }

/**
 * One row of state segments over a time axis: each segment is a bar from its
 * start to the next report, with its label, span and duration on hover.
 */
export function timelineOption(theme: ChartTheme, input: TimelineInput): ChartOption {
  const axis = axisStyle(theme)
  const unknown = withAlpha(theme.muted, 0.22)
  const border = withAlpha(theme.foreground, 0.12)
  const fills = input.segments.map((segment) => (segment.unknown ? unknown : theme.color(segment.color)))
  return {
    animation: false,
    grid: { left: 4, right: 12, top: 4, bottom: 4, containLabel: true },
    xAxis: {
      type: "time",
      min: input.from,
      max: input.to,
      ...axis,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => input.formatTick(value) },
      splitLine: { show: false },
      // Follows the crosshair of linked time charts without opening a tooltip of its own.
      axisPointer: {
        show: true,
        type: "line",
        triggerTooltip: false,
        // Drawn over coloured segments, so stronger than a line chart's crosshair.
        lineStyle: { color: withAlpha(theme.foreground, 0.75), width: 1.5 },
        label: { show: false },
      },
    },
    yAxis: { type: "category", data: [""], show: false },
    tooltip: {
      trigger: "item",
      ...tooltipStyle(theme),
      formatter: (raw: unknown) => {
        const segment = input.segments[(raw as { dataIndex: number }).dataIndex]
        if (!segment) return ""
        return `<div style="font-weight:600">${escapeHtml(segment.label)}</div>
          <div>${escapeHtml(input.formatTime(segment.from))} to ${escapeHtml(input.formatTime(segment.to))}</div>
          <div style="color:${theme.muted}">${escapeHtml(input.formatDuration(segment.to - segment.from))}${segment.detail ? ` · ${escapeHtml(segment.detail)}` : ""}</div>`
      },
    },
    series: [
      {
        type: "custom" as const,
        encode: { x: [0, 1], y: 2 },
        data: input.segments.map((segment) => [segment.from, segment.to, 0]),
        renderItem: (params: RenderParams, api: RenderApi) => {
          const start = api.coord([api.value(0), 0])
          const end = api.coord([api.value(1), 0])
          const height = api.size([0, 1])[1] * 0.7
          const shape = graphic.clipRectByRect(
            { x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 1), height },
            params.coordSys,
          )
          const segment = input.segments[params.dataIndex]
          return (
            shape && {
              type: "rect",
              shape,
              style: {
                fill: fills[params.dataIndex],
                stroke: border,
                lineWidth: 0.5,
                ...(segment?.unknown ? { lineDash: [3, 2], stroke: withAlpha(theme.muted, 0.7), lineWidth: 1 } : {}),
              },
            }
          )
        },
      },
    ],
  } as ChartOption
}
