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
  /** Width of the arc in pixels; see gaugeThickness. */
  thickness?: number
}

/** The arc runs from 205° to -25°, so its ends dip below the centre by this share of the radius. */
const DIP = Math.sin((25 * Math.PI) / 180)
/** The arc keeps this share of its box, so antialiased edges aren't clipped. */
const FILL = 0.98

/**
 * Width over height of the arc's bounding box. Draw the gauge in a box of this
 * shape and the arc fills it, so the gauge scales with its panel.
 */
export const GAUGE_ASPECT = 2 / (1 + DIP)

/** Arc width for a gauge box this many pixels wide, in steps, so resizing redraws rarely. */
export const gaugeThickness = (width: number) =>
  Math.min(32, Math.max(8, Math.round(width / 18)))

/**
 * A radial gauge without text: the page draws the value and range in HTML so
 * they stay readable, selectable and sized by the skin. Bands tint the track;
 * the filled arc shows the value in the colour of its band. The arc fills a
 * box of GAUGE_ASPECT.
 */
export function gaugeOption(theme: ChartTheme, input: GaugeInput): ChartOption {
  const thickness = input.thickness ?? 10
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
        // ECharts takes the radius as a share of half the box's shorter side,
        // its height here; the arc's top sits at the top of the box.
        radius: `${FILL * GAUGE_ASPECT * 100}%`,
        center: ["50%", `${((1 - FILL) / 2 + (FILL * GAUGE_ASPECT) / 2) * 100}%`],
        axisLine: { lineStyle: { width: thickness, color: stops } },
        // Always shown: ECharts only keeps the arc while progress is on, and a
        // gauge that starts without a reading would throw when one arrives.
        // Without a reading the arc is transparent instead.
        progress: {
          show: true,
          width: thickness,
          itemStyle: { color: theme.color(input.color), opacity: input.value === null ? 0 : 1 },
        },
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
