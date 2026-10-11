import type { ChartTheme } from "./theme"

/** Recessive axes: muted labels, hairline grid, no ticks. */
export function axisStyle(theme: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: theme.border, width: 1 } },
    nameTextStyle: { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 11 },
  }
}

/** Tooltips drawn like the app's popovers, kept inside the chart. */
export function tooltipStyle(theme: ChartTheme) {
  return {
    confine: true,
    // A stable hook for tests; ECharts tooltips have no role.
    className: "chart-tooltip",
    backgroundColor: theme.popover,
    borderColor: theme.border,
    borderWidth: 1,
    padding: [6, 8],
    textStyle: { color: theme.popoverForeground, fontFamily: theme.fontFamily, fontSize: 12 },
    extraCssText: `border-radius:${theme.radius}px;box-shadow:none;`,
    transitionDuration: theme.reducedMotion ? 0 : 0.1,
  }
}
