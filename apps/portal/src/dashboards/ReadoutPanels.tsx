import { Link } from "react-router-dom"
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
import { formatAge, formatDateTime, formatNumber } from "@iot-os/ui/lib/format"
import { RequestError } from "../components/forms"
import { devicePath, formatValue } from "../devices/shared"
import {
  bandColor,
  bandFor,
  gaugeSegments,
  NEUTRAL,
  profilePrecision,
  sourceKey,
} from "./model"
import { useDevices, useLatest, useNow } from "./panelData"
import type { PanelProps } from "./registry"

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

/** Relative age with the absolute time on hover. */
export function Age({
  at,
  now,
  timezone,
}: {
  at: string
  now: number
  timezone: DashboardView["timezone"]
}) {
  return (
    <time
      dateTime={at}
      title={formatDateTime(at, timezone) + (timezone === "utc" ? " UTC" : "")}
      className="font-mono tabular-nums"
    >
      {formatAge(at, now)}
    </time>
  )
}

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
    <ul
      className="grid gap-4"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
      }}
    >
      {rows.map(({ source, query, reading, band, precision }) => {
        const value =
          typeof reading?.value === "number" ? reading.value : null
        const position =
          value === null
            ? null
            : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
        return (
          <li key={sourceKey(source)} className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{source.label}</span>
              {showBand(source, band) && <BandMark band={band} />}
            </div>
            {query?.isPending ? (
              <Skeleton className="h-9 w-28" />
            ) : (
              <p className="font-mono text-3xl tabular-nums in-data-kiosk:text-5xl">
                {value === null ? "—" : formatNumber(value, precision)}
                {source.unit && (
                  <span className="ml-1 text-sm text-muted-foreground">
                    {source.unit}
                  </span>
                )}
              </p>
            )}
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
              className="relative h-2 bg-muted"
            >
              {gaugeSegments(source, min, max).map((segment) => (
                <span
                  key={segment.from}
                  className="absolute inset-y-0 opacity-70"
                  style={{
                    left: `${segment.from}%`,
                    width: `${segment.to - segment.from}%`,
                    backgroundColor: bandColor(segment.color),
                  }}
                />
              ))}
              {position !== null && (
                <span
                  className="absolute -inset-y-1 w-0.5 bg-foreground"
                  style={{ left: `calc(${position}% - 1px)` }}
                />
              )}
            </div>
            <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
              <span>{formatNumber(min)}</span>
              {reading && (
                <Age at={readingTime(reading)} now={now} timezone={view.timezone} />
              )}
              <span>{formatNumber(max)}</span>
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
        {rows.map(({ source, query, reading, band, precision }) => (
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
                  {reading ? formatReading(reading.value, precision) : "—"}
                  {source.unit && (
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
                <Age at={readingTime(reading)} now={now} timezone={view.timezone} />
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
                  <Age at={device.last_seen_at} now={now} timezone={view.timezone} />
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
