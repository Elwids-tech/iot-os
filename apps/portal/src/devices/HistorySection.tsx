import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { configurationProfile, type DeviceDetail } from "@iot-os/api-client"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Button } from "@iot-os/ui/components/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@iot-os/ui/components/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { api } from "../lib/api"
import { Choice, TextField, RequestError } from "../components/forms"
import { DeviceEmpty, formatTime, formatValue } from "./shared"

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
    for (const c of device.configurations)
      for (const p of configurationProfile(c).parameters)
        if (!map.has(p.uuid)) map.set(p.uuid, p)
    return [...map.values()] as ReturnType<
      typeof configurationProfile
    >["parameters"]
  }, [device.configurations])
  const [parameter, setParameter] = useState(parameters[0]?.uuid ?? ""),
    [preset, setPreset] = useState("24"),
    [window, setWindow] = useState(() => range(24)),
    [custom, setCustom] = useState({ from: "", to: "" })
  const query = useQuery({
    queryKey: ["device-history", org, device.uuid, parameter, preset, window],
    queryFn: () =>
      api.deviceHistory(org, device.uuid, {
        parameter_uuid: parameter,
        ...(preset === "custom" ? window : range(Number(preset))),
        max_points: 500,
      }),
    enabled: Boolean(parameter),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const selected = parameters.find((p) => p.uuid === parameter)
  return (
    <div className="flex flex-col gap-6 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Measurement history</CardTitle>
          <CardDescription>
            Available retention: {device.retention.days} days (
            {device.retention.source === "organization"
              ? "organization override"
              : device.retention.source === "platform"
                ? "platform default"
                : "90-day fallback"}
            ). Charts group numeric samples by receipt time and keep
            configuration revisions and units separate.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Choice
              label="Parameter"
              value={parameter}
              onChange={setParameter}
              options={[
                { value: "", label: "Choose parameter" },
                ...parameters.map((p) => ({ value: p.uuid, label: p.label })),
              ]}
            />
            <Choice
              label="Time range"
              value={preset}
              onChange={(v) => {
                setPreset(v)
                if (v !== "custom") setWindow(range(Number(v)))
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
          </FieldGroup>
          {preset === "custom" && (
            <form
              className="flex flex-wrap items-end gap-4"
              onSubmit={(e) => {
                e.preventDefault()
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
                  onChange={(e) =>
                    setCustom({ ...custom, from: e.target.value })
                  }
                />
                <TextField
                  label="To"
                  type="datetime-local"
                  required
                  min={custom.from}
                  value={custom.to}
                  onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                />
              </FieldGroup>
              <Button>Apply range</Button>
            </form>
          )}
          <RequestError error={query.error} />
          {query.data?.map((series, index) => (
            <div
              key={series.configuration_uuid + index}
              className="flex flex-col gap-3"
            >
              <p className="text-sm text-muted-foreground">
                {selected?.label} · {series.unit ?? "No unit"} · Configuration{" "}
                {device.configurations.find(
                  (c) => c.uuid === series.configuration_uuid,
                )?.revision ?? series.configuration_uuid.slice(0, 8)}
              </p>
              {["number", "integer"].includes(series.data_type) && (
                <ChartContainer
                  className="h-72 w-full"
                  config={{
                    value: {
                      label: selected?.label ?? "Value",
                      color: "var(--primary)",
                    },
                  }}
                >
                  <LineChart
                    accessibilityLayer
                    data={series.points.map((p) => ({
                      ...p,
                      time: new Date(p.at).getTime(),
                    }))}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) =>
                        new Date(v).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
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
              )}
              <details>
                <summary className="cursor-pointer text-sm">
                  View timestamped values
                </summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Minimum</TableHead>
                      <TableHead>Maximum</TableHead>
                      <TableHead>Samples</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {series.points.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{formatTime(p.at)}</TableCell>
                        <TableCell>{formatValue(p.value)}</TableCell>
                        <TableCell>{formatValue(p.min)}</TableCell>
                        <TableCell>{formatValue(p.max)}</TableCell>
                        <TableCell>{p.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </div>
          ))}
          {!query.isPending && !query.data?.length && (
            <DeviceEmpty
              title="No measurements in this range"
              description="Choose another parameter or time range. Increasing retention cannot restore measurements that were already deleted."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
