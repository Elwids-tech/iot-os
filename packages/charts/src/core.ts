// Only the chart types and components in use, so each chart chunk stays small.
import { BarChart, CustomChart, GaugeChart, LineChart } from "echarts/charts"
import {
  BrushComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components"
import { init, use, type ComposeOption } from "echarts/core"
import { SVGRenderer } from "echarts/renderers"
import type {
  BarSeriesOption,
  CustomSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
} from "echarts/charts"
import type {
  BrushComponentOption,
  GridComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from "echarts/components"

use([
  BarChart,
  CustomChart,
  GaugeChart,
  LineChart,
  BrushComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
])

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | CustomSeriesOption
  | GaugeSeriesOption
  | LineSeriesOption
  | BrushComponentOption
  | GridComponentOption
  | MarkAreaComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
>

export { init }
