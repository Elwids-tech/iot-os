// Only the chart types and components in use, so each chart chunk stays small.
// Add line, mark-line and data-zoom modules here when a panel needs them.
import { BarChart } from "echarts/charts"
import { GridComponent, TooltipComponent } from "echarts/components"
import { init, use, type ComposeOption } from "echarts/core"
import { SVGRenderer } from "echarts/renderers"
import type { BarSeriesOption } from "echarts/charts"
import type { GridComponentOption, TooltipComponentOption } from "echarts/components"

use([BarChart, GridComponent, TooltipComponent, SVGRenderer])

export type ChartOption = ComposeOption<BarSeriesOption | GridComponentOption | TooltipComponentOption>

export { init }
