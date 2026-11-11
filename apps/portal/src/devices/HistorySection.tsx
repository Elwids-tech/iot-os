import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  configurationProfile,
  type DeviceDetail,
  type HistorySeries,
} from "@iot-os/api-client"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { EChart, timeSeriesOption, useChartTheme } from "@iot-os/charts"
import { Button } from "@iot-os/ui/components/button"
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react"
import { formatAge, formatNumber } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"
import { Choice, TextField, errorMessage } from "../components/forms"
import { HistoryRecordsTable } from "../history/HistoryRecordsTable"
import { StateHistoryVisualization } from "../history/StateHistoryVisualization"
import { displayStates } from "../dashboards/profileDisplay"
import {
  configurationMeta,
  emptyHistoryReason,
  isColorParameter,
  latestDataWindow,
} from "../history/model"
import { DeviceEmpty, formatTime, Section } from "./shared"

type HistoryPoint = HistorySeries["points"][number]

function range(hours: number) {
  const to = new Date()
  return {
    from: new Date(to.getTime() - hours * 3600000).toISOString(),
    to: to.toISOString(),
  }
}
/** Value for a datetime-local input in the browser's zone. */
function localInput(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

/**
 * A moved device's readings from before the move, shared by the organization it moved
 * from (spec 031): where they start and end, and who recorded them.
 */
type Earlier = { from: number; to: number; organization: string }

/** The span of a series recorded before the move, or null. */
function earlierSpan(
  points: HistoryPoint[],
  link: DeviceDetail["link"],
): Earlier | null {
  const times = points
    .filter((point) => point.recorded_in === "source" && point.count > 0)
    .map((point) => Date.parse(point.at))
  if (!times.length) return null
  const movedFrom = link?.direction === "moved_from" ? link : null
  return {
    from: Math.min(...times),
    to: movedFrom ? Date.parse(movedFrom.cutover_at) : Math.max(...times),
    organization: movedFrom?.organization_name ?? "the organization it moved from",
  }
}

/** One stored series of a numeric parameter; dragging across it selects a custom range. */
function HistoryChart({
  points,
  name,
  unit,
  span,
  earlier,
  onSelect,
}: {
  points: { at: string; value: unknown }[]
  name: string
  unit: string | null
  span: number
  /** Shaded, with the move marked, and named in the tooltip. */
  earlier: Earlier | null
  onSelect: (from: number, to: number) => void
}) {
  const theme = useChartTheme()
  const option = useMemo(
    () =>
      timeSeriesOption(theme, {
        areas: earlier
          ? [{ from: earlier.from, to: earlier.to, color: "var(--muted-foreground)" }]
          : undefined,
        markers: earlier
          ? [{ at: earlier.to, color: "var(--muted-foreground)" }]
          : undefined,
        lines: [
          {
            key: "value",
            name,
            color: "var(--series-1)",
            points: points.map((point) => ({
              time: Date.parse(point.at),
              value: typeof point.value === "number" ? point.value : null,
            })),
          },
        ],
        formatTick: (time) =>
          new Date(time).toLocaleString(
            [],
            span > 36 * 3600000
              ? { month: "short", day: "numeric" }
              : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
          ),
        formatTime: (time) =>
          formatTime(new Date(time).toISOString()) +
          (earlier && time < earlier.to ? ` · recorded in ${earlier.organization}` : ""),
        formatValue: (value) => `${formatNumber(value)}${unit ? ` ${unit}` : ""}`,
        selectable: true,
      }),
    [theme, points, name, unit, span, earlier],
  )
  return (
    <EChart
      option={option}
      label={`${name}: ${unit ?? "values"} over time`}
      className="h-72 w-full"
      onSelectRange={onSelect}
    />
  )
}

export default function HistorySection({
  org,
  device,
}: {
  org: string
  device: DeviceDetail
}) {
  const parameters = useMemo(() => {
    const map = new Map()
    for (const configuration of device.configurations)
      for (const parameter of configurationProfile(configuration).parameters)
        if (!map.has(parameter.uuid)) map.set(parameter.uuid, parameter)
    return [...map.values()] as ReturnType<
      typeof configurationProfile
    >["parameters"]
  }, [device.configurations])
  const [parameter, setParameter] = useState(parameters[0]?.uuid ?? "")
  const [preset, setPreset] = useState("24")
  const [window, setWindow] = useState(() => range(24))
  const [custom, setCustom] = useState({ from: "", to: "" })
  const queryClient = useQueryClient()
  const selected = parameters.find((item) => item.uuid === parameter)
  const numeric = Boolean(
    selected && ["number", "integer"].includes(selected.data_type),
  )
  const state = Boolean(
    selected && ["boolean", "enum"].includes(selected.data_type),
  )
  const colour = isColorParameter(selected)

  const numericQuery = useQuery({
    queryKey: ["device-history", org, device.uuid, parameter, window],
    queryFn: ({ signal }) =>
      api.deviceHistory(
        org,
        device.uuid,
        { parameter_uuid: parameter, ...window, max_points: 500 },
        signal,
      ),
    enabled: Boolean(parameter && numeric),
  })
  const stateQuery = useQuery({
    queryKey: ["device-state-history", org, device.uuid, parameter, window],
    queryFn: ({ signal }) =>
      api.deviceStateHistory(
        org,
        device.uuid,
        { parameter_uuid: parameter, ...window, max_points: 500 },
        signal,
      ),
    enabled: Boolean(parameter && (state || colour)),
  })

  function refresh() {
    if (preset === "custom") {
      void numericQuery.refetch()
      void stateQuery.refetch()
      void queryClient.resetQueries({
        queryKey: ["device-history-records", org, device.uuid],
      })
    } else {
      setWindow(range(Number(preset)))
    }
  }

  const visual = numeric ? numericQuery : stateQuery
  const charted = numeric || state || colour
  const hasVisualData = numeric
    ? Boolean(numericQuery.data?.some((series) => series.points.length))
    : Boolean(stateQuery.data?.timeline.length)
  const empty = emptyHistoryReason(
    window,
    device.last_seen_at,
    device.retention.cutoff ??
      new Date(Date.now() - device.retention.days * 86400000).toISOString(),
  )
  function selectRange(from: number, to: number) {
    const next = { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
    setPreset("custom")
    setCustom({ from: localInput(next.from), to: localInput(next.to) })
    setWindow(next)
  }
  function jumpToLatest() {
    if (!device.last_seen_at) return
    const next = latestDataWindow(window, device.last_seen_at)
    setPreset("custom")
    setCustom({ from: localInput(next.from), to: localInput(next.to) })
    setWindow(next)
  }

  return (
    <div className="flex flex-col gap-(--panel-gap)">
      <Section
        title="Measurement history"
        meta={`Kept for ${device.retention.days} days (${
          device.retention.source === "organization"
            ? "organization setting"
            : device.retention.source === "platform"
              ? "platform default"
              : "default"
        })`}
      >
        <div className="flex flex-col gap-5">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Choice
              label="Parameter"
              value={parameter}
              onChange={setParameter}
              options={[
                { value: "", label: "Choose parameter" },
                ...parameters.map((item) => ({
                  value: item.uuid,
                  label: item.label,
                })),
              ]}
            />
            <Choice
              label="Time range"
              value={preset}
              onChange={(value) => {
                setPreset(value)
                if (value !== "custom") setWindow(range(Number(value)))
              }}
              options={[
                { value: "1", label: "Last hour" },
                { value: "24", label: "Last 24 hours" },
                { value: "168", label: "Last 7 days" },
                { value: "720", label: "Last 30 days" },
                { value: "2160", label: "Last 90 days" },
                { value: "8760", label: "Last 12 months" },
                { value: "custom", label: "Custom range" },
              ]}
            />
          </FieldGroup>
          {preset === "custom" && (
            <form
              className="flex flex-wrap items-end gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setWindow({
                  from: new Date(custom.from).toISOString(),
                  to: new Date(custom.to).toISOString(),
                })
              }}
            >
              <FieldGroup className="grid flex-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="From"
                  type="datetime-local"
                  required
                  value={custom.from}
                  onChange={(event) =>
                    setCustom({ ...custom, from: event.target.value })
                  }
                />
                <TextField
                  label="To"
                  type="datetime-local"
                  required
                  min={custom.from}
                  value={custom.to}
                  onChange={(event) =>
                    setCustom({ ...custom, to: event.target.value })
                  }
                />
              </FieldGroup>
              <Button>Apply range</Button>
            </form>
          )}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh history
            </Button>
          </div>
          {charted && visual.isError && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>History couldn't be loaded</AlertTitle>
              <AlertDescription>
                <p>{errorMessage(visual.error)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={visual.isFetching}
                  onClick={() => void visual.refetch()}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {numericQuery.data?.map((series, index) => {
            const meta = configurationMeta(
              device.configurations,
              series.configuration_uuid,
            )
            const earlier = earlierSpan(series.points, device.link)
            const own = (series.configurations ?? []).filter(
              (span) => span.recorded_in !== "source",
            ).length
            return (
              <div
                key={series.configuration_uuid + index}
                className="flex flex-col gap-3"
              >
                <p className="text-sm text-muted-foreground">
                  {selected?.label} · {series.unit ?? "No unit"} ·{" "}
                  {meta.configurationLabel} · {meta.profileLabel}
                  {own > 1 && ` · joins ${own} configurations`}
                  {earlier &&
                    ` · shaded: recorded in ${earlier.organization} before the move`}
                </p>
                <HistoryChart
                  points={series.points}
                  name={selected?.label ?? "Value"}
                  unit={series.unit}
                  span={Date.parse(window.to) - Date.parse(window.from)}
                  earlier={earlier}
                  onSelect={selectRange}
                />
              </div>
            )
          })}

          {stateQuery.data && (state || colour) && (
            <StateHistoryVisualization
              history={stateQuery.data}
              configurations={device.configurations}
              colour={colour}
              states={displayStates(selected)}
              recordedIn={
                device.link?.direction === "moved_from"
                  ? device.link.organization_name ?? undefined
                  : undefined
              }
            />
          )}

          {charted && visual.isSuccess && !hasVisualData && (
            empty === "range-expired" ? (
              <DeviceEmpty
                title="This range is past retention"
                description={`Measurements are kept for ${device.retention.days} days. Increasing retention cannot restore measurements that were already deleted.`}
              />
            ) : empty === "data-expired" && device.last_seen_at ? (
              <DeviceEmpty
                title="No stored measurements"
                description={`The device last reported ${formatAge(device.last_seen_at)} ago. Measurements are kept for ${device.retention.days} days, so its readings are no longer stored.`}
              />
            ) : empty === "before-range" && device.last_seen_at ? (
              <DeviceEmpty
                title="No measurements in this range"
                description={`The device last reported ${formatAge(device.last_seen_at)} ago, before this range starts.`}
              >
                <Button size="sm" onClick={jumpToLatest}>
                  Jump to latest data
                </Button>
              </DeviceEmpty>
            ) : (
              <DeviceEmpty
                title="No measurements in this range"
                description="Choose another parameter or time range."
              />
            )
          )}
        </div>
      </Section>
      {selected && (
        <section aria-labelledby="history-records" className="flex flex-col gap-3">
          <h2 id="history-records" className="skin-label text-heading">
            Recorded values
          </h2>
          {/* A new parameter or range starts again from the newest record, scrolled to the top. */}
          <HistoryRecordsTable
            key={`${parameter}:${window.from}:${window.to}`}
            org={org}
            device={device}
            parameter={selected}
            window={window}
          />
        </section>
      )}
    </div>
  )
}
