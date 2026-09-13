import { useMemo, useState } from "react"
import { useQueries } from "@tanstack/react-query"
import type { DashboardView, DashboardWidget } from "@iot-os/api-client"
import { ChartContainer, ChartTooltip } from "@iot-os/ui/components/chart"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { resolveRange, sourceKey, timeLabel } from "./model"
import { telemetryRequest } from "./requests"

export default function TimeSeriesPanel({
  org,
  widget,
  view,
  window,
  onZoom,
}: {
  org: string
  widget: DashboardWidget
  view: DashboardView
  window: { from: string; to: string }
  onZoom?: (from: string, to: string) => void
}) {
  const sources = widget.config.sources
  const rangeKey = JSON.stringify(view.range)
  const refreshInterval =
    view.range.mode === "relative" && view.refresh
      ? view.refresh * 1000
      : (false as const)
  const queries = useQueries({
    queries: sources.map((source) => ({
      queryKey: [
        "dashboard-history",
        org,
        source.device_uuid,
        source.parameter_uuid,
        rangeKey,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () =>
          api.deviceHistory(org, source.device_uuid, {
            parameter_uuid: source.parameter_uuid,
            ...(view.range.mode === "relative"
              ? resolveRange(view.range)
              : window),
            max_points: 500,
          }, signal),
        ),
      staleTime: Infinity,
      gcTime: 30000,
      refetchInterval: refreshInterval,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  })
  const deviceIds = [...new Set(sources.map((s) => s.device_uuid))]
  const devices = useQueries({
    queries: deviceIds.map((id) => ({
      queryKey: ["dashboard-device", org, id],
      queryFn: () => api.device(org, id),
      staleTime: 30000,
      refetchOnWindowFocus: false,
    })),
  })
  const unit = sources[0]?.unit ?? ""
  const incompatible = queries.some((q) =>
    q.data?.some(
      (s) =>
        (s.unit ?? "") !== unit || !["number", "integer"].includes(s.data_type),
    ),
  )
  const retainedDays = Math.min(
    ...devices.flatMap((q) => (q.data ? [q.data.retention.days] : [])),
  )
  const clipped =
    Number.isFinite(retainedDays) &&
    Date.parse(window.from) < Date.now() - retainedDays * 86400000
  const series = queries.flatMap((query, index) =>
    (query.data ?? [])
      .filter(
        (s) =>
          (s.unit ?? "") === unit &&
          ["number", "integer"].includes(s.data_type),
      )
      .map((s, version) => ({
        key: `series_${index}_${version}`,
        name: `${sources[index].label} · ${s.configuration_uuid.slice(0, 8)}`,
        color: sources[index].color,
        precision: sources[index].precision,
        points: s.points.map((p) => ({
          time: Date.parse(p.at),
          value: typeof p.value === "number" ? p.value : null,
          count: p.count,
          min: p.min,
          max: p.max,
        })),
      })),
  )
  const data = useMemo(() => {
    const times = new Map<number, Record<string, number | null>>()
    for (const s of series)
      for (const p of s.points) {
        const row = times.get(p.time) ?? { time: p.time }
        row[s.key] = p.value
        times.set(p.time, row)
      }
    return [...times.values()].sort((a, b) => Number(a.time) - Number(b.time))
  }, [series])
  const [selection, setSelection] = useState<{
    from: number
    to: number
  } | null>(null)
  const hasData = series.some((s) => s.points.some((p) => p.value !== null))
  return (
    <div className="flex h-full min-h-64 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Bucket averages by platform receipt time ·{" "}
        {view.timezone === "utc"
          ? "UTC"
          : Intl.DateTimeFormat().resolvedOptions().timeZone}{" "}
        · Drag across the plot to zoom all charts
      </p>
      {(clipped || incompatible) && (
        <Alert>
          <AlertDescription>
            {clipped &&
              `Requested history extends beyond available retention (${retainedDays} days); older measurements are unavailable. `}
            {incompatible &&
              "Unit or data-type changes: incompatible historical segments are excluded from this axis."}
          </AlertDescription>
        </Alert>
      )}
      {queries.map((query, index) =>
        query.error ? (
          <div key={sourceKey(sources[index])}>
            <RequestError error={query.error} />
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry {sources[index].label}
            </Button>
          </div>
        ) : null,
      )}
      {queries.some((q) => q.isPending) ? (
        <Skeleton className="min-h-48 flex-1" />
      ) : hasData ? (
        <ChartContainer
          className="min-h-48 w-full flex-1"
          config={Object.fromEntries(
            series.map((s) => [s.key, { label: s.name, color: s.color }]),
          )}
        >
          <LineChart
            accessibilityLayer
            data={data}
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
                  new Date(
                    Math.min(selection.from, selection.to),
                  ).toISOString(),
                  new Date(
                    Math.max(selection.from, selection.to),
                  ).toISOString(),
                )
              setSelection(null)
            }}
            onMouseLeave={() => setSelection(null)}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              domain={[Date.parse(window.from), Date.parse(window.to)]}
              allowDataOverflow
              tickFormatter={(v) =>
                new Date(v).toLocaleString(undefined, {
                  ...(view.timezone === "utc" ? { timeZone: "UTC" } : {}),
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              minTickGap={45}
            />
            <YAxis
              domain={["auto", "auto"]}
              width={65}
              label={{
                value: unit || "Value",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <ChartTooltip
              labelFormatter={(value) =>
                timeLabel(new Date(Number(value)).toISOString(), view.timezone)
              }
              formatter={(value, name) => [
                typeof value === "number"
                  ? value.toLocaleString(undefined, {
                      maximumFractionDigits:
                        sources.find((s) => String(name).startsWith(s.label))
                          ?.precision ?? 4,
                    }) + (unit ? ` ${unit}` : "")
                  : "No sample",
                `${name} (average)`,
              ]}
            />
            <Legend />
            {series.map((s) => (
              <Line
                key={s.key}
                data={s.points.map((p) => ({ ...p, [s.key]: p.value }))}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
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
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {sources.length
                ? "No measurements in this range"
                : "Add parameters to preview history"}
            </EmptyTitle>
            <EmptyDescription>
              Choose another range or parameter. Increasing retention cannot
              restore deleted measurements.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
