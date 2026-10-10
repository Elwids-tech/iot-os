import { useEffect, useRef, type CSSProperties } from "react"
import { init, type ChartOption } from "./core"

type Instance = ReturnType<typeof init>
export type ChartEvents = Record<string, (params: unknown) => void>

/**
 * One ECharts instance per element. Options replace the previous ones (no
 * merging), the chart follows its container's size, and it is disposed on
 * unmount. Pass options built with useChartTheme so colours follow the theme.
 */
export function EChart({
  option,
  label,
  className,
  style,
  events,
}: {
  option: ChartOption
  /** Accessible name; pair the chart with a table or text alternative. */
  label: string
  className?: string
  style?: CSSProperties
  events?: ChartEvents
}) {
  const element = useRef<HTMLDivElement>(null)
  const chart = useRef<Instance | null>(null)

  useEffect(() => {
    const container = element.current!
    const instance = init(container, undefined, { renderer: "svg" })
    chart.current = instance
    // Panels resize with the dashboard grid, not only with the window.
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  useEffect(() => {
    const instance = chart.current
    if (!instance || !events) return
    for (const [name, handler] of Object.entries(events)) instance.on(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(events)) instance.off(name, handler)
    }
  }, [events])

  return <div ref={element} role="img" aria-label={label} className={className} style={style} />
}
