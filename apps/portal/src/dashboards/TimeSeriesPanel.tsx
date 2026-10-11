import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useMemo, type CSSProperties } from "react"
import { EChart, timeSeriesOption, useChartTheme, type TimeLine } from "@iot-os/charts"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { formatNumber } from "@iot-os/ui/lib/format"
import { errorMessage } from "../components/forms"
import {
  bandColor,
  profilePrecision,
  seriesColor,
  seriesStats,
  sourceKey,
  tickFormatter,
  timeLabel,
  valueBands,
} from "./model"
import { useDeviceActivity, useDevices, useHistory, useLatest, useNow } from "./panelData"
import { readingTime } from "./ReadoutPanels"
import type { PanelProps } from "./registry"

const numericType = (type: string) => ["number", "integer"].includes(type)

export default function TimeSeriesPanel({
  org,
  widget,
  view,
  window,
  onZoom,
  compare = false,
  group,
}: PanelProps) {
  const theme = useChartTheme()
  const sources = widget.config.sources
  const deviceIds = sources.map((s) => s.device_uuid)
  const queries = useHistory(org, sources, view, window)
  const previous = useHistory(org, sources, view, window, {
    previous: true,
    enabled: compare,
  })
  const devices = useDevices(org, deviceIds)
  const activity = useDeviceActivity(org, deviceIds)
  // When the range is empty, offer the newest reading instead of a dead end.
  const latest = useLatest(org, deviceIds, 0)
  const now = useNow()
  // Relative ranges: the axis follows the newest fetched window, so it
  // advances with every refresh instead of freezing at first render.
  const fetched = queries
    .flatMap((q) => (q.data ? [q.data] : []))
    .sort((a, b) => Date.parse(b.to) - Date.parse(a.to))[0]
  const domain = view.range.mode === "relative" && fetched ? fetched : window
  const from = Date.parse(domain.from),
    to = Date.parse(domain.to)
  const unit = sources[0]?.unit ?? ""
  const compatible = (s: { unit: string | null; data_type: string }) =>
    (s.unit ?? "") === unit && numericType(s.data_type)
  const incompatible = queries.some((q) =>
    q.data?.series.some((s) => !compatible(s)),
  )
  const retainedDays = Math.min(
    ...deviceIds.flatMap((id) => {
      const days = devices(id)?.data?.retention.days
      return days ? [days] : []
    }),
  )
  const clipped =
    Number.isFinite(retainedDays) && from < Date.now() - retainedDays * 86400000
  const name = (index: number) =>
    `${sources[index].label} · ${sources[index].device_name ?? devices(sources[index].device_uuid)?.data?.name ?? "Device"}`
  const precision = (index: number) =>
    sources[index].precision ??
    profilePrecision(
      devices(sources[index].device_uuid)?.data,
      sources[index].parameter_uuid,
    )
  const series = queries.flatMap((query, index) => {
    const versions = (query.data?.series ?? []).filter(compatible)
    return versions.map((s, version) => ({
      key: `series_${index}_${version}`,
      index,
      name: name(index) + (versions.length > 1 ? ` (version ${version + 1})` : ""),
      color: seriesColor(sources[index].color),
      points: s.points.map((p) => ({
        time: Date.parse(p.at),
        value: typeof p.value === "number" ? p.value : null,
      })),
    }))
  })
  const ghosts = compare
    ? previous.flatMap((query, index) => {
        if (!query.data) return []
        const shift = Date.parse(query.data.to) - Date.parse(query.data.from)
        return query.data.series.filter(compatible).map((s, version) => ({
          key: `previous_${index}_${version}`,
          index,
          name: `${name(index)}, previous period`,
          color: seriesColor(sources[index].color),
          points: s.points.map((p) => ({
            time: Date.parse(p.at) + shift,
            value: typeof p.value === "number" ? p.value : null,
          })),
        }))
      })
    : []
  const lines = [...series, ...ghosts]
  const thresholds = [
    ...new Map(
      sources.flatMap((s) => s.thresholds).map((t) => [t.value, t]),
    ).values(),
  ]
  const episodes = activity.alerts.filter(
    (a) =>
      a.activated_at &&
      Date.parse(a.activated_at) < to &&
      (!a.cleared_at || Date.parse(a.cleared_at) > from),
  )
  const commands = activity.commands.filter((c) => {
    const at = Date.parse(c.created_at)
    return at >= from && at <= to
  })
  const hasData = series.some((s) => s.points.some((p) => p.value !== null))
  const failed = queries.flatMap((query, index) =>
    query.error ? [{ query, index }] : [],
  )
  // Shade bands only when every source with thresholds shares them; mixed sets keep the dashed lines.
  const bandSets = new Map(
    sources
      .filter((s) => s.thresholds.length)
      .map((s) => [JSON.stringify([s.base, [...s.thresholds].sort((a, b) => a.value - b.value)]), s]),
  )
  const bands = bandSets.size === 1 ? valueBands([...bandSets.values()][0]) : []
  // Rebuild the chart only when what it draws changes, not on every clock tick.
  const drawn = [
    [...queries, ...previous].map((q) => q.dataUpdatedAt).join(),
    deviceIds.map((id) => devices(id)?.dataUpdatedAt ?? 0).join(),
    episodes.map((e) => `${e.uuid}:${e.cleared_at ?? ""}`).join(),
    commands.map((c) => c.uuid).join(),
    JSON.stringify(sources),
  ].join("|")
  const option = useMemo(() => {
    if (!hasData) return null
    const lineIndex = new Map(lines.map((line) => [line.key, line.index]))
    const chartLines: TimeLine[] = lines.map((line) => ({
      key: line.key,
      name: line.name,
      color: line.color,
      points: line.points,
      ghost: line.key.startsWith("previous"),
    }))
    return timeSeriesOption(theme, {
      lines: chartLines,
      from,
      to,
      formatTick: tickFormatter(to - from, view.timezone),
      formatTime: (time) => timeLabel(new Date(time).toISOString(), view.timezone),
      formatValue: (value, line) =>
        `${formatNumber(value, precision(lineIndex.get(line.key) ?? 0))}${unit ? ` ${unit}` : ""}`,
      areas: episodes.map((episode) => ({
        from: Math.max(from, Date.parse(episode.activated_at!)),
        to: Math.min(to, episode.cleared_at ? Date.parse(episode.cleared_at) : to),
        color: "var(--warning)",
      })),
      markers: commands.map((command) => ({ at: Date.parse(command.created_at), color: "var(--commanded)" })),
      thresholds: thresholds.map((threshold) => ({
        value: threshold.value,
        color: bandColor(threshold.color),
        label: `${threshold.label.charAt(0).toUpperCase()}${threshold.label.slice(1)} ${formatNumber(threshold.value)}${unit ? ` ${unit}` : ""}`,
      })),
      bands: bands.map((band) => ({ from: band.from, to: band.to, color: bandColor(band.color) })),
      selectable: Boolean(onZoom),
    })
  }, [theme, drawn, hasData, from, to, compare, view.timezone, unit, Boolean(onZoom)])
  if (!sources.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Add parameters to preview history</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  const columns = compare ? 5 : 4
  const row =
    "grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-2 @md:grid-cols-[minmax(0,1fr)_repeat(var(--columns),4.5rem)]"
  const stat = (value: number | undefined, index: number) =>
    value === undefined ? "—" : formatNumber(value, precision(index))
  return (
    <div className="@container flex h-full min-h-56 flex-col gap-2">
      {(clipped || incompatible) && (
        <p role="note" className="text-xs text-muted-foreground">
          {clipped &&
            `Older than ${retainedDays} days is past device retention. `}
          {incompatible &&
            "Segments with another unit or data type are left out."}
        </p>
      )}
      {queries.every((q) => q.isPending) ? (
        <Skeleton className="min-h-40 flex-1" />
      ) : hasData ? (
        <div className="flex min-h-40 flex-1 flex-col">
          <span className="font-mono text-xs text-muted-foreground">
            {unit || "Value"}
          </span>
          {option && (
            <EChart
              option={option}
              group={group}
              label={`${widget.title || "Time series"}: ${unit || "values"} over time`}
              className="min-h-36 w-full flex-1"
              onSelectRange={
                onZoom
                  ? (start, end) => onZoom(new Date(start).toISOString(), new Date(end).toISOString())
                  : undefined
              }
            />
          )}
        </div>
      ) : (
        !failed.length && (() => {
          const last = sources
            .flatMap((source) => {
              const reading = latest(source.device_uuid)?.data?.data.find(
                (m) => m.parameter_uuid === source.parameter_uuid && m.value !== null && m.value !== undefined,
              )
              return reading ? [readingTime(reading)] : []
            })
            .sort()
            .at(-1)
          const at = last ? Date.parse(last) : NaN
          const outside = Number.isFinite(at) && (at < from || at > to)
          return (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No measurements in this range</EmptyTitle>
                <EmptyDescription>
                  {outside ? (
                    <>
                      Last reading <RelativeTime bare className="font-mono" at={last!} now={now} timezone={view.timezone} /> ago.
                    </>
                  ) : (
                    "Choose another range or parameter."
                  )}
                </EmptyDescription>
              </EmptyHeader>
              {outside && onZoom && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Same window length, ending just after the last reading.
                    const span = Math.max(to - from, 3600000)
                    const end = Math.min(at + span * 0.1, Date.now())
                    onZoom(new Date(end - span).toISOString(), new Date(end).toISOString())
                  }}
                >
                  Show last reading
                </Button>
              )}
            </Empty>
          )
        })()
      )}
      <div
        className="text-xs"
        style={{ "--columns": columns } as CSSProperties}
      >
        {hasData && (
          <div aria-hidden className={`${row} border-b pb-1 text-muted-foreground`}>
            <span>Series</span>
            <span className="hidden text-right @md:block">Min</span>
            <span className="hidden text-right @md:block">Avg</span>
            <span className="hidden text-right @md:block">Max</span>
            <span className="text-right">Last</span>
            {compare && <span className="hidden text-right @md:block">Prev avg</span>}
          </div>
        )}
        <ul aria-label="Chart legend">
          {series.map((s) => {
            const stats = seriesStats(s.points.map((p) => p.value))
            const prev = seriesStats(
              ghosts
                .filter((g) => g.index === s.index)
                .flatMap((g) => g.points.map((p) => p.value)),
            )
            return (
              <li key={s.key} className={`${row} min-h-6`}>
                <span className="flex min-w-0 items-center gap-2">
                  <svg aria-hidden width="12" height="8" className="shrink-0">
                    <path d="M0 4H12" stroke={s.color} strokeWidth="2" />
                  </svg>
                  <span className="truncate" title={s.name}>
                    {s.name}
                  </span>
                </span>
                <span className="hidden text-right font-mono tabular-nums @md:block">
                  <span className="sr-only">Min </span>
                  {stat(stats?.min, s.index)}
                </span>
                <span className="hidden text-right font-mono tabular-nums @md:block">
                  <span className="sr-only">Average </span>
                  {stat(stats?.avg, s.index)}
                </span>
                <span className="hidden text-right font-mono tabular-nums @md:block">
                  <span className="sr-only">Max </span>
                  {stat(stats?.max, s.index)}
                </span>
                <span className="text-right font-mono tabular-nums">
                  <span className="sr-only">Last </span>
                  {stat(stats?.last, s.index)}
                </span>
                {compare && (
                  <span className="hidden text-right font-mono tabular-nums @md:block">
                    <span className="sr-only">Previous average </span>
                    {stat(prev?.avg, s.index)}
                  </span>
                )}
              </li>
            )
          })}
          {failed.map(({ query, index }) => (
            <li
              key={sourceKey(sources[index])}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1"
            >
              <span className="text-destructive">
                {name(index)}: {errorMessage(query.error)}
              </span>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                Retry {sources[index].label}
              </Button>
            </li>
          ))}
          {hasData && (episodes.length > 0 || commands.length > 0) && (
            <li className="flex flex-wrap gap-x-4 pt-1 text-muted-foreground">
              {episodes.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 bg-warning/40" />
                  {episodes.length === 1 ? "1 alert episode" : `${episodes.length} alert episodes`}
                </span>
              )}
              {commands.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 border-l border-dashed border-commanded" />
                  {commands.length === 1 ? "1 command" : `${commands.length} commands`}
                </span>
              )}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
