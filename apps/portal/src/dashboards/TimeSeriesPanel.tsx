import { useState, type CSSProperties } from "react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@iot-os/ui/components/chart"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { formatNumber } from "@iot-os/ui/lib/format"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { errorMessage } from "../components/forms"
import {
  bandColor,
  profilePrecision,
  seriesColor,
  seriesStats,
  sourceKey,
  tickFormatter,
  timeLabel,
} from "./model"
import { useDeviceActivity, useDevices, useHistory, useLatest, useNow } from "./panelData"
import { Age, readingTime } from "./ReadoutPanels"
import type { PanelProps } from "./registry"

const numericType = (type: string) => ["number", "integer"].includes(type)

export default function TimeSeriesPanel({
  org,
  widget,
  view,
  window,
  onZoom,
  compare = false,
}: PanelProps) {
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
  const times = new Map<number, Record<string, number | null>>()
  for (const s of lines)
    for (const p of s.points) {
      const row = times.get(p.time) ?? { time: p.time }
      row[s.key] = p.value
      times.set(p.time, row)
    }
  const data = [...times.values()].sort((a, b) => Number(a.time) - Number(b.time))
  const [selection, setSelection] = useState<{
    from: number
    to: number
  } | null>(null)
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
          <ChartContainer
            className="aspect-auto min-h-36 w-full flex-1"
            config={Object.fromEntries(
              lines.map((s) => [s.key, { label: s.name, color: s.color }]),
            )}
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              onMouseDown={(state) => {
                const at = Number(state.activeLabel)
                if (onZoom && Number.isFinite(at))
                  setSelection({ from: at, to: at })
              }}
              onMouseMove={(state) => {
                const at = Number(state.activeLabel)
                if (selection && Number.isFinite(at))
                  setSelection({ ...selection, to: at })
              }}
              onMouseUp={() => {
                if (selection && selection.from !== selection.to)
                  onZoom?.(
                    new Date(Math.min(selection.from, selection.to)).toISOString(),
                    new Date(Math.max(selection.from, selection.to)).toISOString(),
                  )
                setSelection(null)
              }}
              onMouseLeave={() => setSelection(null)}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={[from, to]}
                allowDataOverflow
                tickFormatter={tickFormatter(to - from, view.timezone)}
                minTickGap={40}
              />
              <YAxis domain={["auto", "auto"]} width={52} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      timeLabel(
                        new Date(Number(payload?.[0]?.payload?.time)).toISOString(),
                        view.timezone,
                      )
                    }
                    formatter={(value, key, item) => {
                      const line = lines.find((l) => l.key === key)
                      return (
                        <div className="flex w-full items-center gap-2">
                          <span
                            aria-hidden
                            className="h-0.5 w-3 shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {line?.name}
                          </span>
                          <span className="font-mono tabular-nums">
                            {typeof value === "number"
                              ? formatNumber(value, line && precision(line.index))
                              : "No sample"}
                            {unit && ` ${unit}`}
                          </span>
                        </div>
                      )
                    }}
                  />
                }
              />
              {episodes.map((episode) => (
                <ReferenceArea
                  key={episode.uuid}
                  x1={Math.max(from, Date.parse(episode.activated_at!))}
                  x2={Math.min(to, episode.cleared_at ? Date.parse(episode.cleared_at) : to)}
                  fill="var(--warning)"
                  fillOpacity={0.1}
                  ifOverflow="hidden"
                />
              ))}
              {commands.map((command) => (
                <ReferenceLine
                  key={command.uuid}
                  x={Date.parse(command.created_at)}
                  stroke="var(--commanded)"
                  strokeDasharray="2 3"
                  ifOverflow="hidden"
                />
              ))}
              {thresholds.map((threshold) => (
                <ReferenceLine
                  key={threshold.value}
                  y={threshold.value}
                  stroke={bandColor(threshold.color)}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  ifOverflow="hidden"
                />
              ))}
              {lines.map((s) => (
                <Line
                  key={s.key}
                  data={s.points.map((p) => ({ ...p, [s.key]: p.value }))}
                  dataKey={s.key}
                  name={s.key}
                  stroke={s.color}
                  strokeDasharray={s.key.startsWith("previous") ? "4 3" : undefined}
                  strokeOpacity={s.key.startsWith("previous") ? 0.55 : 1}
                  type="linear"
                  dot={s.points.filter((p) => p.value !== null).length < 3}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {selection && (
                <ReferenceArea
                  x1={Math.min(selection.from, selection.to)}
                  x2={Math.max(selection.from, selection.to)}
                  fill="var(--primary)"
                  fillOpacity={0.12}
                />
              )}
            </LineChart>
          </ChartContainer>
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
                      Last reading <Age at={last!} now={now} timezone={view.timezone} /> ago.
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
      {/* Keep static labels outside Recharts' viewport-measurement loop
          when the dashboard moves or resizes a chart. */}
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
