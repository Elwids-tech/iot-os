import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react"
import { Badge } from "@iot-os/ui/components/badge"
import { Link } from "react-router-dom"
import { useQueries, useQuery } from "@tanstack/react-query"
import {
  configurationProfile,
  type Dashboard,
  type DeviceDetail,
  type LocationMapDevice,
  type Measurement,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { EChart, timeSeriesOption, useChartTheme, type TimeLine } from "@iot-os/charts"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@iot-os/ui/components/tooltip"
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
import { LayoutDashboardIcon } from "lucide-react"
import { api } from "../lib/api"
import { dashboardPath } from "../dashboards/model"
import { telemetryRequest } from "../dashboards/requests"
import {
  configurationSummary,
  groupAlerts,
  lastPosition,
  locationParameters,
} from "./model"
import {
  deviceProfile,
  devicePath,
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
const LocationMap = lazy(() =>
  import("../geospatial/LocationMap").then((module) => ({ default: module.LocationMap })),
)

/** Latest readings of the applied (else last working) configuration; one shared request. */
function useLatest(org: string, device: DeviceDetail) {
  const configuration =
    device.applied_configuration_uuid ?? device.last_applied_configuration_uuid
  return useQuery({
    queryKey: ["device-latest", org, device.uuid, configuration, device.lifecycle],
    queryFn: () => api.deviceLatest(org, device.uuid),
    enabled: Boolean(configuration),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
}
const newest = (readings: Measurement[]) =>
  readings.reduce<string | null>(
    (latest, r) =>
      !latest || Date.parse(r.observed_at) > Date.parse(latest) ? r.observed_at : latest,
    null,
  )

export function DeviceOverview({
  org,
  device,
  editable,
  onAddToDashboard,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
  /** Starts Add to dashboard with this parameter selected. */
  onAddToDashboard?: (parameterUuid: string) => void
}) {
  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6">
      <LatestReadout org={org} device={device} editable={editable} onAdd={onAddToDashboard} />
      <aside
        aria-label="Device summary"
        className="flex min-w-0 flex-col gap-6 xl:border-l xl:pl-6"
      >
        <DeviceLocation org={org} device={device} />
        <DeviceDetails org={org} device={device} />
        {!!device.installations?.length && <Section title="Physical installation"><p className="text-sm text-muted-foreground">Readings belong to virtual device <code className="break-all">{device.uuid}</code>.</p>{device.installations.map(installation => <div key={installation.uuid} className="mt-3 flex flex-col gap-1 text-sm"><p>{installation.manufacturer_serial} · {installation.ended_at ? "Previous installation" : "Current hardware"}</p><p className="text-muted-foreground">Installed {formatDateTime(installation.started_at)}</p><code className="break-all text-xs">{installation.uuid}</code></div>)}</Section>}
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
  onAdd,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
  onAdd?: (parameterUuid: string) => void
}) {
  const configured = Boolean(
    device.applied_configuration_uuid || device.last_applied_configuration_uuid,
  )
  const [range, setRange] = useState<Range>("1h")
  const latest = useLatest(org, device)
  const readings = latest.data?.data ?? []
  const lastReading = newest(readings) ?? device.last_seen_at
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
          device.lifecycle === "deactivated" ? (
            "Retained readings, ingestion is off"
          ) : readings.length && lastReading ? (
            <>
              Last reading <RelativeTime at={lastReading} />
            </>
          ) : undefined
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
        {latest.isError && (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            Live values are unavailable right now.
            {lastReading && (
              <>
                {" "}
                Last reading <RelativeTime at={lastReading} />.
              </>
            )}
          </p>
        )}
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
                {onAdd && <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>}
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
                    <Status value={r.quality} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RelativeTime at={r.observed_at} />
                  </TableCell>
                  {onAdd && (
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Add ${r.label} to a dashboard`}
                        title="Add to dashboard"
                        onClick={() => onAdd(r.parameter_uuid)}
                      >
                        <LayoutDashboardIcon />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : latest.isError ? null : device.last_seen_at ? (
          <p className="text-sm text-muted-foreground">
            No current readings. Last seen <RelativeTime at={device.last_seen_at} />.
          </p>
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

/** The lines of the trend chart; split out so the hooks run after TrendChart's early returns. */
function TrendPlot({
  lines,
  unit,
  precision,
  formatTick,
}: {
  lines: TimeLine[]
  unit: string | null | undefined
  precision: Map<string, number | undefined>
  formatTick: (time: number) => string
}) {
  const theme = useChartTheme()
  const option = useMemo(
    () =>
      timeSeriesOption(theme, {
        lines,
        formatTick,
        formatTime: (time) => formatDateTime(new Date(time).toISOString()),
        formatValue: (value, line) => `${formatNumber(value, precision.get(line.key))}${unit ? ` ${unit}` : ""}`,
      }),
    [theme, JSON.stringify(lines), unit],
  )
  return <EChart option={option} label={`Readings${unit ? ` in ${unit}` : ""} over time`} className="h-64 w-full" />
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
  return (
    <Section title={unit ? `Readings in ${unit}` : "Readings"} meta={`Last ${range}`}>
      <TrendPlot
        lines={group.map((r, index) => ({
          key: r.parameter_uuid,
          name: r.label,
          color: `var(--series-${index + 1})`,
          points: points.get(r.parameter_uuid) ?? [],
          connectNulls: true,
        }))}
        unit={unit}
        precision={precision}
        formatTick={tick}
      />
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
  const configuration = configurationSummary(device)
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
        <Detail label="Site">
          {device.site ? (
            <span title="Daily, monthly and shift totals use this time zone.">
              {device.site.name} · {device.site.timezone.replaceAll("_", " ")}
            </span>
          ) : (
            <span className="text-muted-foreground">None (organization time zone)</span>
          )}
        </Detail>
        {(device.tags?.length ?? 0) > 0 && (
          <Detail label="Tags">
            <span className="flex flex-wrap gap-1">
              {device.tags!.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </span>
          </Detail>
        )}
        {Object.entries(device.attributes ?? {}).map(([key, value]) => (
          <Detail key={key} label={key}>
            <span className="font-mono">{value === null ? "—" : String(value)}</span>
          </Detail>
        ))}
        <Detail label="Configuration">
          {configuration.details.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="cursor-help underline decoration-dotted underline-offset-4"
                >
                  {configuration.label}
                </span>
              </TooltipTrigger>
              <TooltipContent>{configuration.details.join(" · ")}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground">{configuration.label}</span>
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

/** Episodes grouped by workflow so a repeating alert reads as one line with its count. */
function DeviceAlerts({ org, device }: { org: string; device: DeviceDetail }) {
  const filter = `device=${encodeURIComponent(device.uuid)}`
  const alerts = useQuery({
    queryKey: ["alerts", org, filter + "&per_page=50"],
    queryFn: () => api.alerts(org, filter + "&per_page=50"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const groups = groupAlerts(alerts.data?.data ?? []).slice(0, 5)
  // Exact per-workflow counts only when the device has more episodes than one page.
  const truncated = (alerts.data?.meta.total ?? 0) > (alerts.data?.data.length ?? 0)
  const totals = useQueries({
    queries: groups.map((group) => {
      const query = `${filter}&workflow=${encodeURIComponent(group.workflow_uuid)}&per_page=1`
      return {
        queryKey: ["alerts", org, query],
        queryFn: () => api.alerts(org, query),
        enabled: truncated,
        staleTime: 30_000,
      }
    }),
  })
  const active = groups.filter((group) => group.active).length
  const base = `/organizations/${encodeURIComponent(org)}/alerts`
  return (
    <Section
      title="Alerts"
      meta={alerts.data ? (active ? `${active} active` : "None active") : undefined}
      actions={
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link to={`${base}?${filter}`}>All alerts</Link>
        </Button>
      }
    >
      {alerts.isPending ? (
        <Skeleton className="h-6 w-full" />
      ) : alerts.error ? (
        <p className="text-sm text-muted-foreground">Alerts could not be loaded.</p>
      ) : groups.length ? (
        <ul className="flex flex-col gap-3 text-sm">
          {groups.map((group, index) => {
            const count = totals[index]?.data?.meta.total ?? group.count
            const latest = group.latest
            return (
              <li key={group.workflow_uuid}>
                <div className="flex items-center justify-between gap-3">
                  <Link
                    className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                    to={
                      count === 1
                        ? `${base}/${encodeURIComponent(latest.uuid)}`
                        : `${base}?${filter}&workflow=${encodeURIComponent(group.workflow_uuid)}`
                    }
                  >
                    {group.workflow_name}
                  </Link>
                  <StatusMark
                    tone={group.active ? "critical" : "muted"}
                    className="shrink-0 text-muted-foreground"
                  >
                    {group.active ? "Active" : "Cleared"}
                  </StatusMark>
                </div>
                <p className="text-muted-foreground">
                  {count === 1 ? "1 occurrence" : `${count.toLocaleString()} occurrences`}
                  {latest.condition === "active" && latest.activated_at ? (
                    <>
                      {" "}· active since <RelativeTime at={latest.activated_at} />
                    </>
                  ) : latest.cleared_at ? (
                    <>
                      {" "}· last cleared <RelativeTime at={latest.cleared_at} />
                    </>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No alerts</p>
      )}
    </Section>
  )
}

/** Last known position on a small map, from the location binding or the profile's latitude/longitude. */
function DeviceLocation({ org, device }: { org: string; device: DeviceDetail }) {
  const bindings = useQuery({
    queryKey: ["location-bindings", org],
    queryFn: () => api.locationBindings(org),
    staleTime: 60_000,
  })
  const parameters = useMemo(() => {
    const id =
      device.applied_configuration_uuid ?? device.last_applied_configuration_uuid
    const configuration = device.configurations?.find((c) => c.uuid === id)
    return configuration ? configurationProfile(configuration).parameters : []
  }, [device])
  const where = locationParameters(
    bindings.data?.data.find((binding) => binding.device_uuid === device.uuid),
    parameters,
  )
  const latest = useLatest(org, device)
  const position = where ? lastPosition(latest.data?.data ?? [], where) : null
  const key = position && JSON.stringify(position)
  const marker = useMemo<LocationMapDevice[]>(
    () =>
      position
        ? [
            {
              device_uuid: device.uuid,
              device_name: device.name,
              binding_uuid: "",
              // The overview has no geofence, so membership stays unknown (grey marker).
              condition: "unknown",
              active: false,
              wandering: false,
              active_alert: null,
              assignment_status: null,
              deployment_status: null,
              latest: {
                event_id: "",
                status: "valid",
                reason: position.stale ? "stale" : "eligible",
                observed_at: position.observed_at,
                received_at: position.received_at,
                historical: false,
                live_eligible: !position.stale,
                point: {
                  latitude: position.latitude,
                  longitude: position.longitude,
                  accuracy_metres: position.accuracy,
                },
              },
              trail: { segments: [], sampled: false },
            },
          ]
        : [],
    // Rebuild only when the position changes, not on every 5 s poll.
    [device.uuid, device.name, key],
  )
  if (!where) return null
  return (
    <Section
      title="Location"
      meta={
        position ? (
          <>
            {position.stale ? "Stale position" : "Last position"}{" "}
            <RelativeTime at={position.observed_at} />
          </>
        ) : undefined
      }
    >
      {position ? (
        <div className="flex flex-col gap-1">
          <div className="h-48">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <LocationMap devices={marker} showLabels={false} />
            </Suspense>
          </div>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
            {position.accuracy !== null && ` · ±${formatNumber(position.accuracy, 0)} m`}
          </p>
        </div>
      ) : latest.isPending && latest.fetchStatus !== "idle" ? (
        <Skeleton className="h-6 w-full" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {latest.isError ? "Position unavailable right now." : "No position reported yet."}
        </p>
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
                  <RelativeTime at={c.created_at} />
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Status value={c.status} />
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
