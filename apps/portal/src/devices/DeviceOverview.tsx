import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQueries, useQuery } from "@tanstack/react-query"
import {
  configurationProfile,
  type Dashboard,
  type DeviceDetail,
  type Measurement,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@iot-os/ui/components/chart"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { formatDateTime, formatNumber } from "@iot-os/ui/lib/format"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { dashboardPath } from "../dashboards/model"
import { telemetryRequest } from "../dashboards/requests"
import {
  Age,
  configurationRevision,
  deviceProfile,
  devicePath,
  DeviceStatus,
  formatReading,
  formatValue,
  gatewayPath,
  parameterPrecisions,
  profilePath,
  Section,
} from "./shared"

const ranges = {
  "15m": { label: "15 min", ms: 900_000 },
  "1h": { label: "1 h", ms: 3_600_000 },
  "6h": { label: "6 h", ms: 21_600_000 },
  "24h": { label: "24 h", ms: 86_400_000 },
  "7d": { label: "7 d", ms: 604_800_000 },
}
type Range = keyof typeof ranges
type Point = { time: number; value: number }

const numericReading = (r: Measurement) =>
  ["number", "integer"].includes(r.data_type)

export function DeviceOverview({
  org,
  device,
  editable,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
}) {
  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6">
      <LatestReadout org={org} device={device} editable={editable} />
      <aside
        aria-label="Device summary"
        className="flex min-w-0 flex-col gap-6 xl:border-l xl:pl-6"
      >
        <DeviceDetails org={org} device={device} />
        <UsedIn org={org} device={device} />
        <DeviceAlerts org={org} device={device} />
        <RecentCommands org={org} device={device} />
      </aside>
    </div>
  )
}

function LatestReadout({
  org,
  device,
  editable,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
}) {
  const configured = Boolean(
    device.applied_configuration_uuid || device.last_applied_configuration_uuid,
  )
  const [range, setRange] = useState<Range>("1h")
  const latest = useQuery({
    queryKey: [
      "device-latest",
      org,
      device.uuid,
      device.applied_configuration_uuid ?? device.last_applied_configuration_uuid,
      device.lifecycle,
    ],
    queryFn: () => api.deviceLatest(org, device.uuid),
    enabled: configured,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const readings = latest.data?.data ?? []
  const numeric = readings.filter(numericReading).slice(0, 12)
  const trends = useQueries({
    queries: numeric.map((r) => ({
      queryKey: ["device-trend", org, device.uuid, r.parameter_uuid, range],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () => {
          const to = Date.now()
          return api.deviceHistory(
            org,
            device.uuid,
            {
              parameter_uuid: r.parameter_uuid,
              from: new Date(to - ranges[range].ms).toISOString(),
              to: new Date(to).toISOString(),
              max_points: 120,
            },
            signal,
          )
        }),
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    })),
  })
  const points = new Map<string, Point[]>(
    numeric.map((r, index) => [
      r.parameter_uuid,
      (trends[index]?.data ?? [])
        .flatMap((series) => series.points)
        .map((p) => ({ time: Date.parse(p.at), value: Number(p.value) }))
        .filter((p) => Number.isFinite(p.value))
        .sort((a, b) => a.time - b.time),
    ]),
  )
  const precision = parameterPrecisions(device)

  if (!configured)
    return (
      <Section title="Latest measurements">
        <p className="text-sm text-muted-foreground">
          Readings appear after a configuration is applied and the source reports.{" "}
          {editable && (
            <Link
              className="text-primary underline"
              to={devicePath(org, device.uuid) + "/configuration"}
            >
              Open configuration
            </Link>
          )}
        </p>
      </Section>
    )
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Section
        title="Latest measurements"
        meta={
          device.lifecycle === "deactivated"
            ? "Retained readings, ingestion is off"
            : latest.dataUpdatedAt
              ? "Updated " +
                new Date(latest.dataUpdatedAt).toLocaleTimeString([], {
                  hourCycle: "h23",
                })
              : undefined
        }
        actions={
          numeric.length > 0 && (
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Trend range"
              value={range}
              onValueChange={(value) => value && setRange(value as Range)}
            >
              {Object.entries(ranges).map(([value, { label }]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )
        }
      >
        <RequestError error={latest.error} />
        {latest.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : readings.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parameter</TableHead>
                <TableHead className="max-md:hidden">Key</TableHead>
                <TableHead>{ranges[range].label} trend</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead className="text-right">Observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {readings.map((r) => (
                <TableRow key={r.parameter_uuid}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-md:hidden">
                    {r.key}
                  </TableCell>
                  <TableCell>
                    {numericReading(r) && (
                      <Sparkline points={points.get(r.parameter_uuid) ?? []} />
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-right font-mono tabular-nums">
                    {formatReading(r.value, precision.get(r.parameter_uuid))}
                    {r.unit && (
                      <span className="ml-1 text-muted-foreground">{r.unit}</span>
                    )}
                  </TableCell>
                  <TableCell title={r.diagnostic || undefined}>
                    <DeviceStatus value={r.quality} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Age value={r.observed_at} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            Waiting for the first reading.
          </p>
        )}
      </Section>
      <TrendChart
        readings={numeric}
        points={points}
        precision={precision}
        range={ranges[range].label}
      />
    </div>
  )
}

function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null
  const times = points.map((p) => p.time),
    values = points.map((p) => p.value)
  const [t0, t1] = [Math.min(...times), Math.max(...times)],
    [v0, v1] = [Math.min(...values), Math.max(...values)]
  const line = points
    .map(
      (p) =>
        `${(((p.time - t0) / (t1 - t0 || 1)) * 80).toFixed(1)},${(19 - ((p.value - v0) / (v1 - v0 || 1)) * 18).toFixed(1)}`,
    )
    .join(" ")
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 80 20"
      preserveAspectRatio="none"
      className="h-5 w-20 text-muted-foreground"
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Chart for the largest group of numeric readings that share a unit.
 * ponytail: skips groups whose values are far apart (latitude and longitude share "deg"),
 * where one axis would flatten every line.
 */
function TrendChart({
  readings,
  points,
  precision,
  range,
}: {
  readings: Measurement[]
  points: Map<string, Point[]>
  precision: Map<string, number | undefined>
  range: string
}) {
  const groups = new Map<string, Measurement[]>()
  for (const r of readings) groups.set(r.unit ?? "", [...(groups.get(r.unit ?? "") ?? []), r])
  const group = [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length)[0]
    ?.slice(0, 6)
  if (!group) return null
  const latest = group.map((r) => Number(r.value)).filter(Number.isFinite)
  const spread = Math.max(...latest) - Math.min(...latest)
  if (!latest.length || spread > 0.5 * Math.max(...latest.map(Math.abs))) return null
  const rows = new Map<number, Record<string, number>>()
  group.forEach((r, index) => {
    for (const p of points.get(r.parameter_uuid) ?? [])
      rows.set(p.time, { ...rows.get(p.time), time: p.time, [`s${index}`]: p.value })
  })
  const data = [...rows.values()].sort((a, b) => a.time - b.time)
  if (!data.length) return null
  const [t0, t1] = [data[0].time, data[data.length - 1].time]
  const tick = (value: number) =>
    new Date(value).toLocaleString([], {
      ...(t1 - t0 > 36 * 3_600_000
        ? { month: "short", day: "numeric" }
        : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    })
  const unit = group[0].unit
  const config = Object.fromEntries(
    group.map((r, index) => [
      `s${index}`,
      { label: r.label, color: `var(--series-${index + 1})` },
    ]),
  )
  return (
    <Section title={unit ? `Readings in ${unit}` : "Readings"} meta={`Last ${range}`}>
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tick}
            minTickGap={48}
          />
          <YAxis domain={["auto", "auto"]} width={48} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatDateTime(new Date(Number(payload[0]?.payload?.time)).toISOString())
                }
              />
            }
          />
          {group.map((_, index) => (
            <Line
              key={index}
              dataKey={`s${index}`}
              stroke={`var(--color-s${index})`}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <table aria-label="Chart legend" className="mt-2 w-full text-sm">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="h-8 text-left font-medium">Series</th>
            <th className="pl-3 text-right font-medium">Min</th>
            <th className="pl-3 text-right font-medium">Avg</th>
            <th className="pl-3 text-right font-medium">Max</th>
            <th className="pl-3 text-right font-medium">Last</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {group.map((r, index) => {
            const values = (points.get(r.parameter_uuid) ?? []).map((p) => p.value)
            const format = (value: number) =>
              values.length ? formatNumber(value, precision.get(r.parameter_uuid)) : ""
            return (
              <tr key={r.parameter_uuid} className="h-8">
                <td className="font-sans">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-0.5 w-3 align-middle"
                    style={{ background: `var(--series-${index + 1})` }}
                  />
                  {r.label}
                </td>
                <td className="pl-3 text-right">{format(Math.min(...values))}</td>
                <td className="pl-3 text-right">
                  {format(values.reduce((sum, v) => sum + v, 0) / values.length)}
                </td>
                <td className="pl-3 text-right">{format(Math.max(...values))}</td>
                <td className="pl-3 text-right">{format(values[values.length - 1])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

function DeviceDetails({ org, device }: { org: string; device: DeviceDetail }) {
  const profile = deviceProfile(device)
  const revisions = [
    ["requested", configurationRevision(device, device.desired_configuration_uuid)],
    ["applied", configurationRevision(device, device.applied_configuration_uuid)],
    ["last working", configurationRevision(device, device.last_applied_configuration_uuid)],
  ].filter(([, revision]) => revision !== undefined)
  return (
    <Section title="Details">
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <Detail label="Profile">
          {profile ? (
            <>
              <Link
                className="text-primary underline-offset-4 hover:underline"
                to={profilePath(org, profile.uuid)}
              >
                {profile.name}
              </Link>
              <span className="text-muted-foreground"> · rev {profile.revision}</span>
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Detail>
        <Detail label="Gateway">
          {device.candidate ? (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={gatewayPath(org, device.candidate.gateway.uuid)}
            >
              {device.candidate.gateway.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Detail>
        <Detail label="Source">
          {device.candidate ? (
            <span className="font-mono">
              {device.candidate.source_device_id || "Gateway measurements"}
            </span>
          ) : (
            <span className="text-muted-foreground">Not assigned</span>
          )}
        </Detail>
        <Detail label="Serial number">
          {device.serial_number || <span className="text-muted-foreground">Not set</span>}
        </Detail>
        <Detail label="Configuration">
          {revisions.length ? (
            revisions.map(([name, revision]) => `${name} ${revision}`).join(" · ")
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Detail>
        {device.description && <Detail label="Description">{device.description}</Detail>}
      </dl>
    </Section>
  )
}

/** Dashboards whose panels read this device, filtered from the dashboards list. */
export function UsedIn({ org, device }: { org: string; device: DeviceDetail }) {
  const dashboards = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
  })
  const used = (dashboards.data ?? [])
    .map((dashboard: Dashboard) => ({
      dashboard,
      panels: dashboard.widgets.filter(
        (w) =>
          w.config.sources?.some((s) => s.device_uuid === device.uuid) ||
          w.config.devices?.some((d) => d.device_uuid === device.uuid),
      ).length,
    }))
    .filter((item) => item.panels > 0)
  return (
    <Section title="Used in" meta={dashboards.data ? used.length : undefined}>
      {dashboards.isPending ? (
        <Skeleton className="h-6 w-full" />
      ) : dashboards.error ? (
        <p className="text-sm text-muted-foreground">Dashboards could not be loaded.</p>
      ) : used.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {used.map(({ dashboard, panels }) => (
            <li key={dashboard.uuid} className="flex justify-between gap-3">
              <Link
                className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                to={dashboardPath(org, dashboard.uuid)}
              >
                {dashboard.name}
              </Link>
              <span className="shrink-0 text-muted-foreground">
                {panels === 1 ? "1 panel" : `${panels} panels`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Not on any dashboard</p>
      )}
    </Section>
  )
}

function DeviceAlerts({ org, device }: { org: string; device: DeviceDetail }) {
  const query = `device=${device.uuid}&per_page=5`
  const alerts = useQuery({
    queryKey: ["alerts", org, query],
    queryFn: () => api.alerts(org, query),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const items = alerts.data?.data ?? []
  const active = items.filter((a) => a.condition === "active").length
  return (
    <Section
      title="Alerts"
      meta={alerts.data ? (active ? `${active} active` : "None active") : undefined}
    >
      {alerts.isPending ? (
        <Skeleton className="h-6 w-full" />
      ) : alerts.error ? (
        <p className="text-sm text-muted-foreground">Alerts could not be loaded.</p>
      ) : items.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((alert) => (
            <li key={alert.uuid} className="flex flex-wrap items-center justify-between gap-x-3">
              <Link
                className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                to={`/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(alert.uuid)}`}
              >
                {alert.workflow_name}
              </Link>
              <span className="flex items-center gap-2 text-muted-foreground">
                <StatusMark tone={alert.condition === "active" ? "critical" : "muted"}>
                  {alert.condition === "active" ? "Active" : "Cleared"}
                </StatusMark>
                {alert.activated_at && <Age value={alert.activated_at} />}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No alerts</p>
      )}
    </Section>
  )
}

function RecentCommands({ org, device }: { org: string; device: DeviceDetail }) {
  const commands = useQuery({
    queryKey: ["device-commands", org, device.uuid],
    queryFn: () => api.deviceCommands(org, device.uuid),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const label = (configurationUuid: string, parameterUuid: string) => {
    const configuration = device.configurations.find((c) => c.uuid === configurationUuid)
    return configuration
      ? configurationProfile(configuration).parameters.find((p) => p.uuid === parameterUuid)
          ?.label
      : undefined
  }
  const items = (commands.data ?? []).slice(0, 3)
  return (
    <Section
      title="Recent commands"
      actions={
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link to={devicePath(org, device.uuid) + "/commands"}>Command log</Link>
        </Button>
      }
    >
      {commands.isPending ? (
        <Skeleton className="h-6 w-full" />
      ) : items.length ? (
        <ul className="flex flex-col gap-3 text-sm">
          {items.map((c) => (
            <li key={c.uuid}>
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {label(c.configuration_uuid, c.parameter_uuid) ?? "Parameter"}{" "}
                  <span className="font-mono">{formatValue(c.value)}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  <Age value={c.created_at} />
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <DeviceStatus value={c.status} />
                <span className="truncate">· {c.actor_name}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No commands yet</p>
      )}
    </Section>
  )
}
