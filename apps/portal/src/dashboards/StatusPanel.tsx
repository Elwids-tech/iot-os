import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { Measurement } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { RequestError } from "../components/forms"
import {
  bandFor,
  NEUTRAL,
  profilePrecision,
  seriesColor,
  sourceKey,
} from "./model"
import { useDevices, useHistory, useLatest, useNow } from "./panelData"
import {
  Age,
  BandMark,
  formatReading,
  presenceLabel,
  readingTime,
  showBand,
} from "./ReadoutPanels"
import type { PanelProps } from "./registry"

export function StatusPanel({
  org,
  widget,
  view,
  window,
  simulation,
  display,
}: PanelProps) {
  const sources = widget.config.sources
  const now = useNow()
  const latest = useLatest(
    org,
    sources.map((s) => s.device_uuid),
    view.refresh,
  )
  const devices = useDevices(
    org,
    sources.map((s) => s.device_uuid),
  )
  // With no per-viewer choice, show cells unless they would scroll inside
  // the panel; then fall back to the denser table.
  const root = useRef<HTMLDivElement>(null)
  const cells = useRef<HTMLUListElement>(null)
  const [fit, setFit] = useState<"cells" | "table">("cells")
  const table = (display ?? fit) === "table"
  const overflowing = () =>
    Boolean(
      root.current &&
        cells.current &&
        cells.current.offsetHeight > root.current.clientHeight + 1,
    )
  useEffect(() => {
    const node = root.current
    if (!node || display) return
    let size = ""
    // On a new panel size, check the cells shown, or give cells a fresh try
    // after the table (the layout effect below measures them).
    const observer = new ResizeObserver(([entry]) => {
      const next = `${entry.contentRect.width}x${entry.contentRect.height}`
      if (next === size) return
      size = next
      setFit(overflowing() ? "table" : "cells")
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [display, sources.length > 0])
  useLayoutEffect(() => {
    if (!display && fit === "cells" && overflowing()) setFit("table")
  })
  // Table rows show a trend over the dashboard range; shares the time series cache.
  const history = useHistory(org, sources, view, window, { enabled: table })
  if (!sources.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No parameters yet</EmptyTitle>
          <EmptyDescription>
            Add device parameters to preview their latest readings.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const rows = sources.map((source, index) => {
    const query = latest(source.device_uuid)
    let measurement = query?.data?.data.find(
      (m) => m.parameter_uuid === source.parameter_uuid,
    )
    const simulated = simulation?.source === sourceKey(source)
    if (simulated && Number.isFinite(simulation.value))
      measurement = {
        ...measurement,
        parameter_uuid: source.parameter_uuid,
        key: "simulation",
        label: source.label,
        unit: source.unit,
        data_type: source.data_type,
        value: simulation.value,
        quality: "good",
        received_at: new Date().toISOString(),
        observed_at: new Date().toISOString(),
        historical: false,
      } as Measurement
    const precision =
      source.precision ??
      profilePrecision(devices(source.device_uuid)?.data, source.parameter_uuid)
    return {
      source,
      query,
      measurement,
      simulated,
      presence: query?.data?.presence,
      state: query?.error
        ? { ...NEUTRAL, label: "Unavailable" }
        : bandFor(source, measurement),
      value: measurement ? formatReading(measurement.value, precision) : "—",
      unit: measurement?.unit ?? source.unit,
      trend: history[index]?.data?.series.flatMap((s) =>
        s.points.map((p) => (typeof p.value === "number" ? p.value : null)),
      ),
    }
  })
  const oneDevice = new Set(sources.map((s) => s.device_uuid)).size === 1
  // The root has the panel's size (container-type: size), so cells can
  // shrink their values on short panels and overflow can be measured.
  const frame = (children: ReactNode) => (
    <div ref={root} className="h-full min-h-24 [container-type:size]">
      {children}
    </div>
  )
  if (table)
    return frame(
      // Narrow panels drop Trend, then Age; fullscreen shows every column.
      <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parameter</TableHead>
            <TableHead className="hidden @md:table-cell">Trend</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Band</TableHead>
            <TableHead className="hidden text-right @sm:table-cell">Age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={sourceKey(row.source)}>
              <TableCell className="max-w-48">
                <span className="block truncate">{row.source.label}</span>
                {!oneDevice && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.source.device_name}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden @md:table-cell">
                <Sparkline values={row.trend} color={seriesColor(row.source.color)} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums in-data-kiosk:text-lg">
                {row.query?.isPending && !row.simulated ? (
                  <Skeleton className="ml-auto h-4 w-12" />
                ) : (
                  <>
                    {row.value}
                    {row.unit && (
                      <span className="ml-1 text-muted-foreground">{row.unit}</span>
                    )}
                  </>
                )}
              </TableCell>
              <TableCell>
                {showBand(row.source, row.state) && <BandMark band={row.state} />}
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground @sm:table-cell">
                {row.measurement && !row.simulated && (
                  <Age at={readingTime(row.measurement)} now={now} timezone={view.timezone} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>,
    )
  return frame(
    <div className="overflow-hidden">
      <ul
        ref={cells}
        className="-mr-px -mb-px grid"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 8rem), 1fr))",
        }}
      >
        {rows.map((row) => {
          const { source, query, measurement, simulated } = row
          const retained = Boolean(
            measurement?.last_valid_received_at &&
              measurement.value !== null &&
              measurement.value !== undefined,
          )
          return (
            <li
              key={sourceKey(source)}
              aria-label={source.label}
              className="flex min-w-0 flex-col gap-0.5 border-r border-b p-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-2 text-sm">
                <span className="min-w-0 break-words">
                  {source.label || measurement?.label || "Parameter"}
                </span>
                {showBand(source, row.state) && <BandMark band={row.state} />}
              </div>
              {source.device_name && !oneDevice && (
                <p className="truncate text-xs text-muted-foreground">
                  {source.device_name}
                </p>
              )}
              {query?.isPending && !simulated ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <p className="font-mono text-2xl break-words tabular-nums in-data-kiosk:text-4xl [@container(max-height:11rem)]:text-lg">
                  {row.value}
                  {row.unit ? (
                    <span className="ml-1 text-sm text-muted-foreground">
                      {row.unit}
                    </span>
                  ) : null}
                </p>
              )}
              {query?.error && (
                <RequestError error={query.error}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => query.refetch()}
                  >
                    Retry latest reading
                  </Button>
                </RequestError>
              )}
              {simulated ? (
                <p className="text-xs text-muted-foreground">
                  Simulation, not telemetry
                </p>
              ) : measurement ? (
                <div className="flex flex-col text-xs text-muted-foreground">
                  <p>
                    {retained ? "Last valid value received " : "Received "}
                    <Age at={readingTime(measurement)} now={now} timezone={view.timezone} />
                    {" ago"}
                  </p>
                  {retained && (
                    <p>
                      Latest diagnostic received{" "}
                      <Age at={measurement.received_at} now={now} timezone={view.timezone} />
                      {" ago"}
                    </p>
                  )}
                  {measurement.diagnostic && <p>{measurement.diagnostic}</p>}
                  {row.presence && row.presence !== "online" && (
                    <StatusMark tone="muted">
                      Device {presenceLabel(row.presence).toLowerCase()}
                    </StatusMark>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Waiting for a reading
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>,
  )
}

/** Small trend line over the dashboard range; decorative, the table carries the values. */
function Sparkline({
  values,
  color,
}: {
  values?: Array<number | null>
  color: string
}) {
  const known = (values ?? []).filter((v): v is number => v !== null)
  if (known.length < 2) return <span className="text-xs text-muted-foreground">—</span>
  const min = Math.min(...known),
    max = Math.max(...known),
    span = max - min || 1
  const points = (values ?? [])
    .map((value, index, all) =>
      value === null
        ? null
        : `${((index / (all.length - 1)) * 80).toFixed(1)},${(18 - ((value - min) / span) * 16).toFixed(1)}`,
    )
    .filter(Boolean)
    .join(" ")
  return (
    <svg aria-hidden width="80" height="20" viewBox="0 0 80 20" className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  )
}
