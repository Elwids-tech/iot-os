import { RelativeTime } from "@iot-os/ui/components/freshness"
import type { ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { OrganizationOverview } from "@iot-os/api-client"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status, StatusMark } from "@iot-os/ui/components/status-mark"
import { formatAge } from "@iot-os/ui/lib/format"
import { BellIcon, ChevronRightIcon, CpuIcon, LayoutGridIcon, ScanSearchIcon, StarIcon, WorkflowIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useRuntimeStatus } from "../components/RuntimeStatus"

/** The organization's front page: fleet health and what needs someone's attention. */
export default function HomePage({ organizationName }: { organizationName: string }) {
  const org = useParams().organizationUuid!
  const overview = useQuery({ queryKey: ["overview", org], queryFn: () => api.overview(org), refetchInterval: 30000 })
  const dashboards = useQuery({ queryKey: ["dashboards", org], queryFn: () => api.dashboards(org) })
  const path = (section: string) => `/organizations/${encodeURIComponent(org)}/${section}`
  const data = overview.data
  const paused = useRuntimeStatus()?.automations === "paused"
  return (
    <>
      <PageHeader title="Home" meta={`What needs attention in ${organizationName}`} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <RequestError error={overview.error} />
        <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data ? (
            <>
              <Summary to={path("devices")} icon={<CpuIcon />} title="Devices" value={data.devices.active} unit="active">
                <StatusMark tone="good">{data.devices.online} online</StatusMark>
                <StatusMark tone={data.devices.offline ? "critical" : "muted"}>{data.devices.offline} offline</StatusMark>
                <StatusMark tone="muted">{data.devices.unknown} unknown</StatusMark>
              </Summary>
              <Summary to={path("alerts")} icon={<BellIcon />} title="Alerts" value={data.alerts.active} unit="active">
                <StatusMark tone={data.alerts.active_unacknowledged ? "warning" : "muted"}>{data.alerts.active_unacknowledged} need acknowledgement</StatusMark>
                <StatusMark tone="muted">{data.alerts.last_24_hours} in the last 24 h</StatusMark>
              </Summary>
              <Summary to={path("automation")} icon={<WorkflowIcon />} title="Automations" value={data.automations.applied ?? 0} unit={paused ? "active, paused" : "running"}>
                <StatusMark tone={attentionAutomations(data) ? "critical" : "muted"}>{attentionAutomations(data)} need attention</StatusMark>
                <StatusMark tone="muted">{data.automations.inactive ?? 0} off</StatusMark>
              </Summary>
              <Summary to={path("discovery")} icon={<ScanSearchIcon />} title="New data sources" value={data.discovery.pending} unit="waiting">
                <span className="text-muted-foreground">Sending data but not added as devices yet</span>
              </Summary>
            </>
          ) : (
            Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)
          )}
        </section>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle><h2>Needs attention</h2></CardTitle>
              <CardDescription>Newest first. Acknowledged alerts stay here until they clear.</CardDescription>
            </CardHeader>
            <CardContent>
              {data ? <Attention data={data} path={path} /> : <Skeleton className="h-40" />}
            </CardContent>
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle><h2>Dashboards</h2></CardTitle>
                <CardDescription>Starred first, then recently viewed</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboards.data ? (
                  dashboards.data.length ? (
                    <ul className="-mx-2 flex flex-col">
                      {[...dashboards.data]
                        .sort((a, b) => Number(b.starred) - Number(a.starred) || (b.last_viewed_at ?? "").localeCompare(a.last_viewed_at ?? ""))
                        .slice(0, 5)
                        .map((dashboard) => (
                          <li key={dashboard.uuid}>
                            <Row to={path(`dashboards/${dashboard.uuid}`)}>
                              {dashboard.starred ? <StarIcon className="size-4 fill-current text-warning" aria-label="Starred" /> : <LayoutGridIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
                              <span className="truncate">{dashboard.name}</span>
                            </Row>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No dashboards yet. <Link className="text-primary underline underline-offset-4" to={path("dashboards")}>Create one</Link> to watch devices together.</p>
                  )
                ) : (
                  <Skeleton className="h-24" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle><h2>Recent commands</h2></CardTitle>
              </CardHeader>
              <CardContent>
                {data ? (
                  data.commands.recent.length ? (
                    <ul className="flex flex-col gap-2 text-sm">
                      {data.commands.recent.map((command) => (
                        <li key={command.uuid} className="flex items-center justify-between gap-3">
                          <span className="truncate">{command.device_name ?? "Removed device"}</span>
                          <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                            <Status value={command.status} />
                            <RelativeTime at={command.created_at} never={null} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No commands sent yet.</p>
                  )
                ) : (
                  <Skeleton className="h-24" />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}

const attentionAutomations = (data: OrganizationOverview) => (data.automations.failed ?? 0) + (data.automations.suspended ?? 0)

function Attention({ data, path }: { data: OrganizationOverview; path: (section: string) => string }) {
  const items: ReactNode[] = data.alerts.latest_active.map((alert) => (
    <Row key={alert.uuid} to={path(`alerts/${alert.uuid}`)}>
      <StatusMark tone={alert.acknowledged ? "muted" : "warning"}>
        <span className="sr-only">{alert.acknowledged ? "Acknowledged alert" : "Unacknowledged alert"}</span>
      </StatusMark>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{alert.workflow_name ?? "Alert"}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[alert.device_name && !alert.workflow_name?.includes(alert.device_name) ? alert.device_name : null, alert.activated_at && `active for ${formatAge(alert.activated_at)}`, alert.acknowledged ? "acknowledged" : "not acknowledged"].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Row>
  ))
  if (data.alerts.active > data.alerts.latest_active.length)
    items.push(<Row key="more-alerts" to={path("alerts")}><span className="text-muted-foreground">{data.alerts.active - data.alerts.latest_active.length} more active alerts</span></Row>)
  const fact = (key: string, count: number, to: string, text: string) =>
    count ? items.push(<Row key={key} to={path(to)}><StatusMark tone="warning" /><span className="flex-1">{text}</span></Row>) : null
  fact("offline", data.devices.offline, "devices", `${plural(data.devices.offline, "device is", "devices are")} offline`)
  fact("silent", data.devices.silent, "devices", `${plural(data.devices.silent, "active device has", "active devices have")} sent nothing for over a day`)
  fact("commands", data.commands.uncertain, "devices", `${plural(data.commands.uncertain, "command has", "commands have")} an uncertain outcome`)
  fact("automations", attentionAutomations(data), "automation", `${plural(attentionAutomations(data), "automation failed or was", "automations failed or were")} suspended`)
  fact("discovery", data.discovery.pending, "discovery", `${plural(data.discovery.pending, "data source is", "data sources are")} waiting to be added as devices`)
  fact("registered", data.devices.registered, "devices", `${plural(data.devices.registered, "device is", "devices are")} registered but not set up`)
  if (!items.length) return <p className="text-sm text-muted-foreground">All clear. Nothing needs attention right now.</p>
  return <ul className="-mx-2 flex flex-col">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
}

function Summary({ to, icon, title, value, unit, children }: { to: string; icon: ReactNode; title: string; value: number; unit: string; children: ReactNode }) {
  return (
    <Link to={to} className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-colors group-hover:bg-muted/40">
        <CardHeader>
          <CardDescription className="flex items-center gap-2 [&_svg]:size-4">{icon}{title}</CardDescription>
          <CardTitle className="flex items-baseline gap-2">
            <span className="font-mono text-3xl tabular-nums">{value}</span>
            <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{children}</CardContent>
      </Card>
    </Link>
  )
}

function Row({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      {children}
      <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

