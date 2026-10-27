import { useMemo, useRef, type ReactNode } from "react"
import {
  Responsive,
  WidthProvider,
  type ResponsiveLayouts,
} from "react-grid-layout/legacy"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import type {
  DashboardLayout,
  DashboardView,
  DashboardWidget,
} from "@iot-os/api-client"
import { usePanelGap } from "@iot-os/ui/components/skin"
import { cn } from "@iot-os/ui/lib/utils"
import { GRID_COLUMNS, resolveRange, responsiveLayouts } from "./model"
import { PanelBody } from "./registry"

const Grid = WidthProvider(Responsive)
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
export const ROW_HEIGHT = 48

/**
 * A dashboard's panels on the grid. On its own it is read-only, so it can draw a
 * proposal that was never saved; with `preview`, Controls panels show their controls
 * without sending commands. The workspace adds drag handles, panel menus and layout
 * editing through the optional props.
 */
export function DashboardGrid({
  org,
  widgets,
  layouts,
  view,
  window,
  preview,
  group,
  compare,
  onZoom,
  badge,
  display,
  handle,
  menu,
  editable = false,
  invalid,
  onBreakpointChange,
  onLayoutChange,
  panelRef,
}: {
  org: string
  widgets: DashboardWidget[]
  layouts: DashboardLayout
  view: DashboardView
  /** The resolved time window; defaults to the view's range. */
  window?: { from: string; to: string }
  preview?: boolean
  /** Time charts in one group share their crosshair. */
  group?: string
  compare?: boolean
  onZoom?: (from: string, to: string) => void
  /** A note beside the panel title, such as a proposed panel's change. */
  badge?: (widget: DashboardWidget) => ReactNode
  /** Status panels: the viewer's choice of cells or table. */
  display?: (widget: DashboardWidget) => "cells" | "table" | undefined
  handle?: (widget: DashboardWidget) => ReactNode
  menu?: (widget: DashboardWidget) => ReactNode
  /** Panels can be dragged and resized. */
  editable?: boolean
  /** A panel to outline as invalid. */
  invalid?: string | null
  onBreakpointChange?: (breakpoint: string) => void
  /** Called after the person drags or resizes a panel, not when the grid settles itself. */
  onLayoutChange?: (layouts: ResponsiveLayouts) => void
  panelRef?: (id: string, node: HTMLDivElement | null) => void
}) {
  const gap = usePanelGap()
  const gridLayouts = useMemo(() => responsiveLayouts(layouts), [layouts])
  const rangeKey = JSON.stringify(view.range)
  const ownWindow = useMemo(() => resolveRange(view.range), [rangeKey])
  const layoutAction = useRef(false)
  const bodyProps = {
    preview,
    org,
    view,
    window: window ?? ownWindow,
    compare,
    group,
    onZoom,
  }
  return (
    <div className={cn(!gap && "border-t border-l")}>
      <Grid
        className="dashboard-grid"
        autoSize
        isBounded={false}
        // Panels stick to the panel above or the top, as in Grafana; dragging down only reorders.
        compactType="vertical"
        layouts={gridLayouts as ResponsiveLayouts}
        breakpoints={BREAKPOINTS}
        cols={GRID_COLUMNS}
        rowHeight={ROW_HEIGHT}
        margin={[gap, gap]}
        containerPadding={[0, 0]}
        isDraggable={editable}
        isResizable={editable}
        resizeHandles={["s", "e", "se"]}
        draggableHandle=".dashboard-drag-handle"
        onBreakpointChange={onBreakpointChange}
        onDragStart={() => {
          layoutAction.current = true
        }}
        onResizeStart={() => {
          layoutAction.current = true
        }}
        onLayoutChange={(_, next) => {
          if (layoutAction.current) {
            onLayoutChange?.(next)
            layoutAction.current = false
          }
        }}
      >
        {widgets.map((widget) => {
          const devices = [
            ...new Set(
              widget.config.sources.flatMap((s) =>
                s.device_name ? [s.device_name] : [],
              ),
            ),
          ]
          const meta =
            widget.type === "controls"
              ? "Live · 1 s"
              : devices.length > 2
                ? `${devices.length} devices`
                : devices.join(", ")
          const note = badge?.(widget)
          return (
            // Chart dimensions must settle with the grid, not animate through
            // intermediate sizes that trigger synchronous measurement updates.
            <div key={widget.id} style={{ transition: "none" }}>
              <div
                id={`panel-${widget.id}`}
                className={cn(
                  "flex h-full flex-col overflow-hidden bg-card text-card-foreground",
                  gap ? "border" : "border-r border-b",
                  invalid === widget.id && "ring-2 ring-destructive ring-inset",
                )}
              >
                <div className="flex items-start gap-2 border-b py-1.5 pr-1.5 pl-3">
                  {handle?.(widget)}
                  <div className="min-w-0 flex-1 py-0.5">
                    <h2
                      id={`panel-title-${widget.id}`}
                      className="skin-label truncate text-sm font-medium"
                      title={widget.title}
                    >
                      {widget.title}
                    </h2>
                    {widget.description && (
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={widget.description}
                      >
                        {widget.description}
                      </p>
                    )}
                  </div>
                  {note && <div className="shrink-0 py-0.5">{note}</div>}
                  {meta && (
                    <span className="hidden max-w-[40%] truncate py-0.5 text-xs text-muted-foreground sm:block">
                      {meta}
                    </span>
                  )}
                  {menu?.(widget)}
                </div>
                <div
                  ref={panelRef && ((node) => panelRef(widget.id, node))}
                  // Focusable so keyboard users can scroll a panel whose
                  // content is taller than its grid cell.
                  role="group"
                  tabIndex={0}
                  aria-labelledby={`panel-title-${widget.id}`}
                  className="min-h-0 flex-1 overflow-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <PanelBody
                    {...bodyProps}
                    widget={widget}
                    display={display?.(widget)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </Grid>
    </div>
  )
}
