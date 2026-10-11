import type { ChartOption } from "./core"
import { withAlpha, type ChartTheme } from "./theme"

export type GaugeInput = {
  min: number
  max: number
  value: number | null
  /** Colour of the filled arc; any CSS colour. */
  color: string
  /** Bands along the scale as [end fraction 0..1, CSS colour], in order, ending at 1. */
  bands: { to: number; color: string; neutral?: boolean }[]
}

/**
 * A radial gauge without text: the page draws the value and range in HTML so
 * they stay readable, selectable and sized by the skin. Bands tint the track;
 * the filled arc shows the value in the colour of its band.
 */
export function gaugeOption(theme: ChartTheme, input: GaugeInput): ChartOption {
  const track = withAlpha(theme.muted, 0.18)
  const stops: [number, string][] = input.bands.length
    ? input.bands.map((band) => [
        Math.min(1, Math.max(0, band.to)),
        band.neutral ? track : withAlpha(theme.color(band.color), 0.45),
      ])
    : [[1, track]]
  if (stops[stops.length - 1][0] < 1) stops.push([1, track])
  return {
    animation: !theme.reducedMotion,
    animationDurationUpdate: theme.reducedMotion ? 0 : 300,
    series: [
      {
        type: "gauge" as const,
        min: input.min,
        max: input.max,
        startAngle: 205,
        endAngle: -25,
        radius: "100%",
        center: ["50%", "66%"],
        axisLine: { lineStyle: { width: 10, color: stops } },
        progress: { show: input.value !== null, width: 10, itemStyle: { color: theme.color(input.color) } },
        pointer: { show: false },
        anchor: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: { show: false },
        data: [{ value: input.value === null ? input.min : Math.min(input.max, Math.max(input.min, input.value)) }],
      },
    ],
  } as ChartOption
}
