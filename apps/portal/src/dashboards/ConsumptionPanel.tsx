import { useMemo } from "react"
import type { CounterBucket } from "@iot-os/api-client"
import {
  axisStyle,
  EChart,
  escapeHtml,
  tooltipStyle,
  useChartTheme,
  withAlpha,
  type ChartEvents,
  type ChartOption,
} from "@iot-os/charts"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { formatNumber } from "@iot-os/ui/lib/format"
import { errorMessage } from "../components/forms"
import { PERIOD_LABELS } from "./calendar"
import { consumptionModel, zoneNote } from "./consumption"
import { profilePrecision, seriesColor, sourceKey } from "./model"
import { reportingTimezone, useConsumption, useDevices } from "./panelData"
import type { PanelProps } from "./registry"

const BUCKET_NAMES: Record<CounterBucket, string> = {
  "15m": "15 minutes",
  "1h": "hour",
  "1d": "day",
  "1w": "week",
  "1mo": "month",
  "1y": "year",
}
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })

/**
 * Counter usage as bars per hour, day, week or month. Days and months start
 * in each device's site time zone, meter resets and rollovers are counted by
 * the runtime, and the bucket still in progress is hatched.
 */
export default function ConsumptionPanel({ org, widget, view, window, onZoom, preview }: PanelProps) {
  const theme = useChartTheme()
  const sources = widget.config.sources
  const period = widget.config.period ?? "dashboard"
  const devices = useDevices(org, sources.map((s) => s.device_uuid))
  const queries = useConsumption(org, widget, view, window, (id) => reportingTimezone(devices(id)?.data))
  const viewerZone = view.timezone === "utc" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone
  const results = queries.map((q) => q.data)
  const model = useMemo(
    () => consumptionModel(results, { period, viewerZone }),
    [period, viewerZone, ...results],
  )
  const name = (index: number) =>
    `${sources[index].label} · ${sources[index].device_name ?? devices(sources[index].device_uuid)?.data?.name ?? "Device"}`
  const precision = (index: number) =>
    sources[index].precision ?? profilePrecision(devices(sources[index].device_uuid)?.data, sources[index].parameter_uuid)
  const unit = model?.series.find(Boolean)?.unit ?? sources[0]?.unit ?? ""
  const amount = (value: number, index: number) =>
    `${formatNumber(value, precision(index))}${unit ? ` ${unit}` : ""}`
  const colors = sources.map((s) => theme.color(seriesColor(s.color)))

  const option = useMemo<ChartOption | null>(() => {
    if (!model?.hasData) return null
    const now = Date.now()
    const radius = Math.min(theme.radius, 4)
    const axis = axisStyle(theme)
    return {
      animation: !theme.reducedMotion,
      grid: { left: 4, right: 8, top: 20, bottom: 4, containLabel: true },
      xAxis: {
        type: "category",
        data: model.categories.map((c) => c.label),
        ...axis,
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: unit,
        nameGap: 8,
        nameLocation: "end",
        ...axis,
        nameTextStyle: { ...axis.nameTextStyle, align: "left" },
        axisLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(theme.muted, 0.12) } },
        ...tooltipStyle(theme),
        formatter: (raw: unknown) => {
          const params = (Array.isArray(raw) ? raw : [raw]) as { dataIndex: number }[]
          const at = params[0]?.dataIndex ?? 0
          const category = model.categories[at]
          const values = model.series.map((s) => s?.values[at] ?? null)
          const partial = values.some((v) => v?.partial)
          const resets = values.reduce((sum, v) => sum + (v?.resets ?? 0), 0)
          const rows = sources
            .map((_, index) => {
              const value = values[index]
              return `<div style="display:flex;justify-content:space-between;gap:16px;align-items:center">
                <span style="display:flex;align-items:center;gap:6px;min-width:0"><span style="width:8px;height:8px;flex:none;background:${colors[index]}"></span>${escapeHtml(sources.length > 1 ? name(index) : sources[index].label)}</span>
                <span style="font-family:${escapeHtml(theme.monoFamily)};font-variant-numeric:tabular-nums">${value ? escapeHtml(amount(value.value, index)) : "No readings"}</span>
              </div>`
            })
            .join("")
          const notes = [
            partial && (category.end > now ? "So far: this period is still counting." : "Partly outside the selected range."),
            resets > 0 && (resets === 1 ? "A meter reset or rollover was handled." : `${resets} meter resets or rollovers were handled.`),
            onZoom && !preview && period === "dashboard" && model.bucket !== "15m" && "Click to zoom in.",
          ].filter(Boolean)
          return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(category.title)}</div>${rows}${notes
            .map((note) => `<div style="color:${theme.muted};margin-top:4px">${escapeHtml(note)}</div>`)
            .join("")}`
        },
      },
      series: sources.map((source, index) => ({
        type: "bar" as const,
        name: name(index),
        barMaxWidth: 32,
        barGap: "8%",
        barCategoryGap: "28%",
        itemStyle: { color: colors[index], borderRadius: [radius, radius, 0, 0] },
        emphasis: { disabled: true },
        data: (model.series[index]?.values ?? []).map((value) =>
          value === null
            ? null
            : {
                value: value.value,
                itemStyle: value.partial
                  ? {
                      color: withAlpha(colors[index], 0.6),
                      decal: {
                        symbol: "rect",
                        dashArrayX: [1, 0],
                        dashArrayY: [2, 3],
                        rotation: -Math.PI / 4,
                        color: withAlpha(theme.surface, 0.55),
                      },
                    }
                  : undefined,
              },
        ),
      })),
    }
  }, [model, theme, unit, colors.join(), sources, onZoom, preview, period])

  const events = useMemo<ChartEvents | undefined>(() => {
    if (!onZoom || preview || period !== "dashboard" || !model || model.bucket === "15m") return undefined
    return {
      click: (params) => {
        const category = model.categories[(params as { dataIndex: number }).dataIndex]
        if (category) onZoom(new Date(category.start).toISOString(), new Date(Math.min(category.end, Date.now())).toISOString())
      },
    }
  }, [onZoom, preview, period, model])

  if (!sources.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Add counters to preview consumption</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  const failed = queries.flatMap((query, index) => (query.error ? [{ query, index }] : []))
  const note = model ? zoneNote(model, period, viewerZone) : null
  const single = sources.length === 1 ? model?.series[0] : null
  const partialNow = model?.series.some((s) => s?.values.some((v) => v?.partial)) ?? false
  const resets = model?.series.reduce((sum, s) => sum + (s?.resets ?? 0), 0) ?? 0

  return (
    // Previews sit in small cards, so they drop the minimum heights.
    <div className={`@container flex h-full flex-col gap-2 ${preview ? "" : "min-h-56"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {single && (
          <p className="font-mono text-2xl tabular-nums in-data-kiosk:text-4xl">
            {formatNumber(single.total, precision(0))}
            {unit && <span className="ml-1 text-sm text-muted-foreground">{unit}</span>}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {period === "dashboard" ? "Total for the time range" : PERIOD_LABELS[period]}
          {partialNow && (period === "dashboard" ? "" : " so far")}
          {model && ` · per ${BUCKET_NAMES[model.bucket]}`}
        </p>
      </div>
      {(model?.coarsened || note || resets > 0) && (
        <p role="note" className="text-xs text-muted-foreground">
          {model?.coarsened && "Too many bars for this range, so bar size is automatic. "}
          {resets > 0 && (resets === 1 ? "1 meter reset or rollover handled. " : `${resets} meter resets or rollovers handled. `)}
          {note}
        </p>
      )}
      {queries.every((q) => q.isPending) ? (
        <Skeleton className={`flex-1 ${preview ? "min-h-20" : "min-h-40"}`} />
      ) : option ? (
        <EChart
          option={option}
          events={events}
          label={`${widget.title}: ${unit || "usage"} per ${model ? BUCKET_NAMES[model.bucket] : "period"}`}
          className={`flex-1 ${preview ? "min-h-20" : "min-h-40"}`}
        />
      ) : (
        !failed.length && (
          <Empty className="min-h-40 flex-1">
            <EmptyHeader>
              <EmptyTitle>No usage recorded</EmptyTitle>
              <EmptyDescription>
                {period === "dashboard"
                  ? "The counters reported nothing in this time range."
                  : `The counters reported nothing ${PERIOD_LABELS[period].toLowerCase()}.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
      {model?.hasData && (
        <table className="sr-only">
          <caption>{widget.title}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {sources.map((source, index) => (
                <th key={sourceKey(source)} scope="col">{name(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.categories.map((category, at) => (
              <tr key={category.key}>
                <th scope="row">{category.title}</th>
                {sources.map((source, index) => {
                  const value = model.series[index]?.values[at]
                  return (
                    <td key={sourceKey(source)}>
                      {value ? `${amount(value.value, index)}${value.partial ? " (partial)" : ""}` : "No readings"}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(sources.length > 1 || failed.length > 0) && (
        <ul aria-label="Chart legend" className="text-xs">
          {sources.length > 1 &&
            sources.map((source, index) => (
              <li key={sourceKey(source)} className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-2 shrink-0" style={{ background: colors[index] }} />
                  <span className="truncate" title={name(index)}>{name(index)}</span>
                </span>
                <span className="text-right font-mono tabular-nums">
                  <span className="sr-only">Total </span>
                  {model?.series[index] ? amount(model.series[index]!.total, index) : "—"}
                </span>
              </li>
            ))}
          {failed.map(({ query, index }) => (
            <li key={`error-${sourceKey(sources[index])}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
              <span className="text-destructive">
                {name(index)}: {errorMessage(query.error)}
              </span>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                Retry {sources[index].label}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
