import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { configurationProfile, type DeviceDetail } from "@iot-os/api-client"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@iot-os/ui/components/chart"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  RefreshCwIcon,
} from "lucide-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { formatAge } from "@iot-os/ui/lib/format"
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
  const [recordLimit, setRecordLimit] = useState(500)
  const [recordsOpen, setRecordsOpen] = useState(false)
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
  function jumpToLatest() {
    if (!device.last_seen_at) return
    const next = latestDataWindow(window, device.last_seen_at)
    setPreset("custom")
    setCustom({ from: localInput(next.from), to: localInput(next.to) })
    setWindow(next)
    setRecordsOpen(false)
  }

  return (
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
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Choice
              label="Parameter"
              value={parameter}
              onChange={(value) => {
                setParameter(value)
                setRecordsOpen(false)
              }}
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
                setRecordsOpen(false)
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
            <Choice
              label="Record limit"
              value={String(recordLimit)}
              onChange={(value) => {
                setRecordLimit(Number(value))
                setRecordsOpen(false)
              }}
              options={[100, 500, 1000, 5000].map((value) => ({
                value: String(value),
                label: `Latest ${value.toLocaleString()} records`,
              }))}
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
                setRecordsOpen(false)
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
            return (
              <div
                key={series.configuration_uuid + index}
                className="flex flex-col gap-3"
              >
                <p className="text-sm text-muted-foreground">
                  {selected?.label} · {series.unit ?? "No unit"} ·{" "}
                  {meta.configurationLabel} · {meta.profileLabel}
                  {(series.configurations?.length ?? 0) > 1 &&
                    ` · joins ${series.configurations!.length} configurations`}
                </p>
                <ChartContainer
                  className="h-72 w-full"
                  config={{
                    value: {
                      label: selected?.label ?? "Value",
                      color: "var(--series-1)",
                    },
                  }}
                >
                  <LineChart
                    accessibilityLayer
                    data={series.points.map((point) => ({
                      ...point,
                      time: new Date(point.at).getTime(),
                    }))}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      minTickGap={48}
                      tickFormatter={(value) =>
                        new Date(value).toLocaleString(
                          [],
                          Date.parse(window.to) - Date.parse(window.from) >
                            36 * 3600000
                            ? { month: "short", day: "numeric" }
                            : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
                        )
                      }
                    />
                    <YAxis domain={["auto", "auto"]} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) =>
                            formatTime(payload[0]?.payload?.at)
                          }
                        />
                      }
                    />
                    <Line
                      dataKey="value"
                      type="linear"
                      stroke="var(--color-value)"
                      dot={series.points.length < 3}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>
            )
          })}

          {stateQuery.data && (state || colour) && (
            <StateHistoryVisualization
              history={stateQuery.data}
              configurations={device.configurations}
              colour={colour}
              states={displayStates(selected)}
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

          {selected && (
            <Collapsible open={recordsOpen} onOpenChange={setRecordsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  View timestamped values
                  {recordsOpen ? (
                    <ChevronUpIcon data-icon="inline-end" />
                  ) : (
                    <ChevronDownIcon data-icon="inline-end" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                {recordsOpen && (
                  <HistoryRecordsTable
                    key={`${parameter}:${window.from}:${window.to}:${recordLimit}`}
                    org={org}
                    device={device}
                    parameter={selected}
                    window={window}
                    limit={recordLimit}
                  />
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
    </Section>
  )
}
