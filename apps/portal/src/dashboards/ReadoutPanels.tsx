import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  EChart,
  GAUGE_ASPECT,
  gaugeOption,
  gaugeThickness,
  useChartTheme,
} from "@iot-os/charts"
import type {
  DashboardBand,
  DashboardSource,
  DashboardView,
  Measurement,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  StatusMark,
  type StatusTone,
} from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { formatNumber } from "@iot-os/ui/lib/format"
import { RequestError } from "../components/forms"
import { devicePath, formatValue } from "../devices/shared"
import {
  bandColor,
  bandFor,
  gaugeSegments,
  NEUTRAL,
  appliedParameters,
  profilePrecision,
  seriesColor,
  sourceKey,
} from "./model"
import { useDevices, useLatest, useNow } from "./panelData"
import type { PanelProps } from "./registry"
import { displayStates, stateFor, TONE_COLOR } from "./profileDisplay"

export function formatReading(value: unknown, precision?: number) {
  return typeof value === "number"
    ? formatNumber(value, precision)
    : formatValue(value)
}

/** A threshold band: its colour as a square plus its label. */
export function BandMark({ band }: { band: DashboardBand }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="size-2 shrink-0"
        style={{ backgroundColor: bandColor(band.color) }}
      />
      {band.label.charAt(0).toUpperCase() + band.label.slice(1)}
    </span>
  )
}

/** Bands matter when the source has thresholds or a quality problem; the plain base band is noise. */
export const showBand = (source: DashboardSource, band: DashboardBand) =>
  source.thresholds.length > 0 || band.label !== source.base.label


export const presenceTone = (presence?: string): StatusTone =>
  presence === "online" ? "good" : presence === "offline" ? "critical" : "muted"
export const presenceLabel = (presence?: string) =>
  presence === "online" ? "Online" : presence === "offline" ? "Offline" : "Unknown"

/** Latest reading, band and display precision per source. */
function useReadings(org: string, sources: DashboardSource[], view: DashboardView) {
  const latest = useLatest(
    org,
    sources.map((s) => s.device_uuid),
    view.refresh,
  )
  const devices = useDevices(
    org,
    sources.map((s) => s.device_uuid),
  )
  return sources.map((source) => {
    const query = latest(source.device_uuid)
    const reading = query?.data?.data.find(
      (m) => m.parameter_uuid === source.parameter_uuid,
    )
    return {
      source,
      query,
      reading,
      presence: query?.data?.presence,
      band: query?.error
        ? { ...NEUTRAL, label: "Unavailable" }
        : bandFor(source, reading),
      precision:
        source.precision ??
        profilePrecision(devices(source.device_uuid)?.data, source.parameter_uuid),
      // The profile's label and tone for enum and boolean values, read at render time.
      state:
        reading && reading.value !== null && reading.value !== undefined
          ? stateFor(
              displayStates(
                appliedParameters(devices(source.device_uuid)?.data).find(
                  (p) => p.uuid === source.parameter_uuid,
                ),
              ),
              reading.value,
            )
          : undefined,
    }
  })
}

/** Receipt of the value shown: the retained valid value when the latest sample was invalid. */
export const readingTime = (reading: Measurement) =>
  reading.last_valid_received_at &&
  reading.value !== null &&
  reading.value !== undefined
    ? reading.last_valid_received_at
    : reading.received_at

/** The arc of one gauge; the value and range around it are HTML. It fills its positioned parent, a box of GAUGE_ASPECT. */
function GaugeArc({
  source,
  min,
  max,
  value,
  band,
}: {
  source: DashboardSource
  min: number
  max: number
  value: number | null
  band: DashboardBand
}) {
  const theme = useChartTheme()
  const segments = gaugeSegments(source, min, max)
  // The arc thickens with the gauge; thickness moves in steps, so a resize redraws rarely.
  const box = useRef<HTMLDivElement>(null)
  const [thickness, setThickness] = useState<number>()
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setThickness(gaugeThickness(entry.contentRect.width)),
    )
    observer.observe(box.current!)
    return () => observer.disconnect()
  }, [])
  const option = useMemo(
    () =>
      gaugeOption(theme, {
        min,
        max,
        value,
        thickness,
        // The filled arc takes the colour of the band the value is in.
        color: band.color === NEUTRAL.color ? seriesColor(source.color) : bandColor(band.color),
        bands: segments.map((segment) => ({
          to: segment.to / 100,
          color: bandColor(segment.color),
          neutral: segment.color === NEUTRAL.color,
        })),
      }),
    [theme, min, max, value, thickness, band.color, source.color, JSON.stringify(segments)],
  )
  // Out of flow, so the chart's last drawn size never holds the box open while it shrinks.
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden">
      <EChart option={option} label={`${source.label} gauge`} className="size-full" />
    </div>
  )
}

export function GaugePanel({ org, widget, view }: PanelProps) {
  const now = useNow()
  const min = widget.config.min ?? 0,
    max = widget.config.max ?? 100
  const rows = useReadings(org, widget.config.sources, view)
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add numeric parameters to preview the gauge.
      </p>
    )
  return (
    // Gauges share the panel's height, so they grow and shrink with it.
    <ul
      className="grid h-full gap-4"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
        gridAutoRows: "minmax(min-content, 1fr)",
      }}
    >
      {rows.map(({ source, query, reading, band, precision }) => {
        const value =
          typeof reading?.value === "number" ? reading.value : null
        return (
          <li key={sourceKey(source)} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{source.label}</span>
              {showBand(source, band) && <BandMark band={band} />}
            </div>
            {/* The space left in the cell (container-type: size); the gauge and its
                range take the largest width that keeps the arc's shape. */}
            <div className="flex min-h-28 flex-1 justify-center [container-type:size]">
              <div
                className="flex flex-col gap-1"
                style={{ width: `min(100cqw, (100cqh - 1.25rem) * ${GAUGE_ASPECT})` }}
              >
                {/* The meter carries the value for assistive technology; the arc inside it is presentational. */}
                <div
                  role="meter"
                  aria-label={source.label}
                  aria-valuemin={min}
                  aria-valuemax={max}
                  aria-valuenow={value ?? undefined}
                  aria-valuetext={
                    value === null
                      ? "No reading"
                      : `${formatNumber(value, precision)}${source.unit ? " " + source.unit : ""}, ${band.label}`
                  }
                  className="relative [container-type:inline-size]"
                  style={{ aspectRatio: GAUGE_ASPECT }}
                >
                  <GaugeArc source={source} min={min} max={max} value={value} band={band} />
                  {/* The value scales with the gauge's width. */}
                  <div className="absolute inset-x-0 bottom-[30%] flex justify-center font-mono text-[length:clamp(1.25rem,18cqw,6rem)] leading-tight tabular-nums">
                    {query?.isPending ? (
                      <Skeleton className="h-[1em] w-[3em]" />
                    ) : (
                      <p className="whitespace-nowrap">
                        {/* Keyed by the shown text so a changed reading remounts and runs one highlight. */}
                        <span
                          key={value === null ? "—" : formatNumber(value, precision)}
                          className="-mx-1 rounded-sm px-1 motion-safe:animate-value-flash"
                        >
                          {value === null ? "—" : formatNumber(value, precision)}
                        </span>
                        {source.unit && (
                          <span className="ml-1 text-[0.5em] text-muted-foreground">
                            {source.unit}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex h-4 justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>{formatNumber(min)}</span>
                  {reading && (
                    <RelativeTime bare className="truncate font-mono" at={readingTime(reading)} now={now} timezone={view.timezone} />
                  )}
                  <span>{formatNumber(max)}</span>
                </div>
              </div>
            </div>
            {query?.error && (
              <RequestError error={query.error}>
                <Button variant="outline" size="sm" onClick={() => query.refetch()}>
                  Retry latest reading
                </Button>
              </RequestError>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function TablePanel({ org, widget, view }: PanelProps) {
  const now = useNow()
  const rows = useReadings(org, widget.config.sources, view)
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add parameters to preview the table.
      </p>
    )
  return (
    // Narrow panels drop Band, then Age; fullscreen shows every column.
    <div className="@container">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Device</TableHead>
          <TableHead>Parameter</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="hidden @lg:table-cell">Band</TableHead>
          <TableHead className="hidden text-right @md:table-cell">Age</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ source, query, reading, band, precision, state }) => (
          <TableRow key={sourceKey(source)}>
            <TableCell className="max-w-40 truncate">
              <Link
                className="hover:underline"
                to={devicePath(org, source.device_uuid)}
              >
                {source.device_name ?? "Device"}
              </Link>
            </TableCell>
            <TableCell className="max-w-48 truncate">{source.label}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {query?.isPending ? (
                <Skeleton className="ml-auto h-4 w-12" />
              ) : (
                <>
                  {state?.tone && (
                    <span aria-hidden className="mr-2 inline-block size-2.5 align-middle" style={{ backgroundColor: TONE_COLOR[state.tone] }} />
                  )}
                  {state ? state.label : reading ? formatReading(reading.value, precision) : "—"}
                  {source.unit && !state && (
                    <span className="ml-1 text-muted-foreground">{source.unit}</span>
                  )}
                </>
              )}
            </TableCell>
            <TableCell className="hidden @lg:table-cell">
              {showBand(source, band) && <BandMark band={band} />}
            </TableCell>
            <TableCell className="hidden text-right text-muted-foreground @md:table-cell">
              {reading && (
                <RelativeTime bare className="font-mono" at={readingTime(reading)} now={now} timezone={view.timezone} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  )
}

/** Plain text, rendered as text (never HTML). */
export function TextPanel({ widget }: PanelProps) {
  return widget.config.text?.trim() ? (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {widget.config.text}
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">Enter text to preview it.</p>
  )
}

export function DeviceHealthPanel({ org, widget, view }: PanelProps) {
  const now = useNow()
  const entries = widget.config.devices ?? []
  const devices = useDevices(
    org,
    entries.map((d) => d.device_uuid),
    view.refresh ? Math.max(view.refresh, 10) * 1000 : 30000,
  )
  if (!entries.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add devices to preview their health.
      </p>
    )
  const presences = entries.map(
    (entry) => devices(entry.device_uuid)?.data?.presence,
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {presences.filter((p) => p === "online").length} online ·{" "}
        {presences.filter((p) => p === "offline").length} offline
      </p>
      <ul className="flex flex-col">
        {entries.map((entry) => {
          const query = devices(entry.device_uuid)
          const device = query?.data
          return (
            <li
              key={entry.device_uuid}
              className="flex h-(--row-h) items-center gap-3 border-b text-sm last:border-b-0"
            >
              <Link
                className="min-w-0 flex-1 truncate hover:underline"
                to={devicePath(org, entry.device_uuid)}
              >
                {device?.name ?? entry.device_name ?? "Device"}
              </Link>
              {query?.error ? (
                <StatusMark tone="muted">Unavailable</StatusMark>
              ) : query?.isPending ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <StatusMark tone={presenceTone(device?.presence)}>
                  {presenceLabel(device?.presence)}
                </StatusMark>
              )}
              <span className="w-14 text-right text-xs text-muted-foreground">
                {device?.last_seen_at && (
                  <RelativeTime bare className="font-mono" at={device.last_seen_at} now={now} timezone={view.timezone} />
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
