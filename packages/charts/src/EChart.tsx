import { useEffect, useRef, type CSSProperties } from "react"
import { init, type ChartOption } from "./core"

type Instance = ReturnType<typeof init>
export type ChartEvents = Record<string, (params: unknown) => void>

type BrushEnd = { areas?: { coordRange?: [number, number]; range?: [number, number] }[] }

type PointerEvent = { axesInfo?: { axisDim: string; value: number }[] }

/** Charts per group, for the shared crosshair. */
const linked = new Map<string, Set<Instance>>()
let relaying = false

/**
 * Shows the hovered chart's time on every other chart in its group. ECharts'
 * own connect() relays pixel positions, which only line up when charts share
 * a layout; this converts the time to each chart's own position instead.
 */
function relay(source: Instance, group: string, event: PointerEvent) {
  if (relaying) return
  const time = event.axesInfo?.find((info) => info.axisDim === "x")?.value
  relaying = true
  try {
    for (const target of linked.get(group) ?? []) {
      if (target === source || target.isDisposed()) continue
      let x: unknown
      try {
        x = time === undefined ? undefined : target.convertToPixel({ xAxisIndex: 0 }, time)
      } catch {
        x = undefined
      }
      target.dispatchAction(
        typeof x === "number" && Number.isFinite(x)
          ? { type: "updateAxisPointer", currTrigger: "mousemove", x, y: target.getHeight() / 2 }
          : { type: "updateAxisPointer", currTrigger: "leave" },
      )
    }
  } finally {
    relaying = false
  }
}

/** A horizontal brush on the first x axis, drawn when the page lets people select a range. */
const DEFAULT_BRUSH = {
  xAxisIndex: 0,
  brushType: "lineX",
  brushMode: "single",
  transformable: false,
  outOfBrush: { colorAlpha: 1 },
} as const

/**
 * One ECharts instance per element. Options replace the previous ones (no
 * merging), the chart follows its container's size, and it is disposed on
 * unmount. Pass options built with useChartTheme so colours follow the theme.
 *
 * - `group`: charts sharing a group move their crosshair and tooltip together.
 * - `onSelectRange`: dragging across the plot selects an x range (time
 *   charts pass epoch milliseconds), then the selection clears.
 * - Updates to a chart scrolled out of view wait until it is visible again.
 */
export function EChart({
  option,
  label,
  className,
  style,
  events,
  group,
  onSelectRange,
}: {
  option: ChartOption
  /** Accessible name; pair the chart with a table or text alternative. */
  label: string
  className?: string
  style?: CSSProperties
  events?: ChartEvents
  group?: string
  onSelectRange?: (from: number, to: number) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const chart = useRef<Instance | null>(null)
  const visible = useRef(true)
  const pending = useRef<ChartOption | null>(null)
  const select = useRef(onSelectRange)
  select.current = onSelectRange
  const linkedGroup = useRef(group)
  linkedGroup.current = group
  const selectable = Boolean(onSelectRange)

  function apply(instance: Instance, next: ChartOption) {
    const brush = Boolean(select.current)
    instance.setOption(brush && !next.brush ? { ...next, brush: DEFAULT_BRUSH } : next, {
      notMerge: true,
      lazyUpdate: true,
    })
    // A replaced option drops the active brush cursor, so take it again.
    if (brush)
      instance.dispatchAction({
        type: "takeGlobalCursor",
        key: "brush",
        brushOption: { brushType: "lineX", brushMode: "single" },
      })
  }

  useEffect(() => {
    const container = element.current!
    const instance = init(container, undefined, { renderer: "svg" })
    chart.current = instance
    // Panels resize with the dashboard grid, not only with the window.
    const resize = new ResizeObserver(() => instance.resize())
    resize.observe(container)
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible.current = entry.isIntersecting
            if (visible.current && pending.current) {
              apply(instance, pending.current)
              pending.current = null
            }
          })
    intersection?.observe(container)
    instance.on("updateAxisPointer", (event) => {
      if (linkedGroup.current) relay(instance, linkedGroup.current, event as PointerEvent)
    })
    instance.on("brushEnd", (raw) => {
      const area = (raw as BrushEnd).areas?.[0]
      const [from, to] = area?.coordRange ?? []
      const [left, right] = area?.range ?? []
      // A click without a drag is not a selection.
      if (from !== undefined && to !== undefined && Math.abs((right ?? 0) - (left ?? 0)) >= 4)
        select.current?.(Math.min(from, to), Math.max(from, to))
      instance.dispatchAction({ type: "brush", areas: [] })
    })
    return () => {
      resize.disconnect()
      intersection?.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    if (visible.current) apply(instance, option)
    else pending.current = option
  }, [option, selectable])

  useEffect(() => {
    const instance = chart.current
    if (!instance || !group) return
    const members = linked.get(group) ?? new Set<Instance>()
    members.add(instance)
    linked.set(group, members)
    return () => {
      members.delete(instance)
      if (!members.size) linked.delete(group)
    }
  }, [group])

  useEffect(() => {
    const instance = chart.current
    if (!instance || !events) return
    for (const [name, handler] of Object.entries(events)) instance.on(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(events)) instance.off(name, handler)
    }
  }, [events])

  return (
    <div
      ref={element}
      role="img"
      aria-label={label}
      data-slot="chart"
      className={className}
      style={style}
    />
  )
}
