import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { configurationProfile, type DeviceDetail } from "@iot-os/api-client"
import { FieldGroup } from "@iot-os/ui/components/field"
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
import { ChevronDownIcon, ChevronUpIcon, RefreshCwIcon } from "lucide-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { api } from "../lib/api"
import { Choice, TextField, RequestError } from "../components/forms"
import { HistoryRecordsTable } from "../history/HistoryRecordsTable"
import { StateHistoryVisualization } from "../history/StateHistoryVisualization"
import { configurationMeta, isColorParameter } from "../history/model"
import { DeviceEmpty, formatTime, Section } from "./shared"

function range(hours: number) {
  const to = new Date()
  return {
    from: new Date(to.getTime() - hours * 3600000).toISOString(),
    to: to.toISOString(),
  }
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

  const visualPending = numeric ? numericQuery.isPending : stateQuery.isPending
  const hasVisualData = numeric
    ? Boolean(numericQuery.data?.some((series) => series.points.length))
    : Boolean(stateQuery.data?.timeline.length)

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
          <RequestError error={numericQuery.error ?? stateQuery.error} />

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
            />
          )}

          {(numeric || state || colour) && !visualPending && !hasVisualData && (
            <DeviceEmpty
              title="No measurements in this range"
              description="Choose another parameter or time range. Increasing retention cannot restore measurements that were already deleted."
            />
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
