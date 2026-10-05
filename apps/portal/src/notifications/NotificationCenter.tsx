import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { BellIcon, MailXIcon, RefreshCwIcon } from "lucide-react"
import { ApiError, type NotificationEvent, type NotificationLevel, type NotificationPreferences, type NotificationSource } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { Switch } from "@iot-os/ui/components/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { DeviceEmpty, DevicePages } from "../devices/shared"

const sources: Record<NotificationSource, { label: string; description: string }> = {
  workflow: { label: "Workflow alerts", description: "Device and automation conditions in your organizations." },
  service: { label: "Service monitoring", description: "Grafana / Prometheus service, resource, and log alerts." },
  watchdog: { label: "Host watchdog", description: "Independent checks of the application host, API, and MQTT." },
}
const levels: NotificationLevel[] = ["critical", "warning", "info", "recovery"]
const labels: Record<NotificationLevel, string> = { critical: "Critical", warning: "Warning", info: "Information", recovery: "Recovery" }
const variants = { critical: "destructive", warning: "warning", info: "info", recovery: "success" } as const
const tones = { critical: "critical", warning: "warning", info: "info", recovery: "good" } as const
const preferenceKey = ["notification-preferences"]

export default function NotificationCenter() {
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "preferences" ? "preferences" : "events"
  const cache = useQueryClient()
  const prefs = useQuery({ queryKey: preferenceKey, queryFn: () => api.notificationPreferences() })
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) => api.updateNotificationPreferences(next),
    onSuccess: (data) => cache.setQueryData(preferenceKey, data),
    onError: (error) => { if (error instanceof ApiError && error.status === 409) void cache.invalidateQueries({ queryKey: preferenceKey }) },
  })
  function master(enabled: boolean) {
    if (prefs.data) save.mutate({ ...prefs.data, email_enabled: enabled })
  }
  return <>
    <PageHeader title="Notification center" meta="Your alerts and email preferences" actions={
      <Button variant="outline" disabled={!prefs.data || save.isPending || !prefs.data.email_enabled} onClick={() => master(false)}>
        <MailXIcon data-icon="inline-start" />Turn off all emails
      </Button>
    } />
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <RequestError error={prefs.error ?? save.error} />
      {prefs.data && <Alert>
        <BellIcon />
        <AlertTitle>{prefs.data.email_enabled ? "Email delivery follows your preferences" : "All alert emails are off"}</AlertTitle>
        <AlertDescription>
          {prefs.data.email_enabled ? "Choose which alerts reach your inbox in Email preferences." : "Workflow, service monitoring, and watchdog emails are muted. Events continue to appear here."}
          {save.isPending && <span role="status"> Saving…</span>}
        </AlertDescription>
      </Alert>}
      <Tabs value={tab} onValueChange={(value) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", value); return next })}>
        <TabsList variant="line" aria-label="Notification center views">
          <TabsTrigger value="events">Events dashboard</TabsTrigger>
          <TabsTrigger value="preferences">Email preferences</TabsTrigger>
        </TabsList>
        <TabsContent value="events"><EventsDashboard /></TabsContent>
        <TabsContent value="preferences">
          {prefs.isPending ? <Skeleton className="h-64 w-full" /> : prefs.data && <PreferencesGrid prefs={prefs.data} pending={save.isPending} change={(next) => save.mutate(next)} />}
        </TabsContent>
      </Tabs>
    </div>
  </>
}

function PreferencesGrid({ prefs, pending, change }: { prefs: NotificationPreferences; pending: boolean; change: (next: NotificationPreferences) => void }) {
  return <Card>
    <CardHeader>
      <CardTitle>Email preferences</CardTitle>
      <CardDescription>These settings apply to your account across all organizations. Changes save immediately.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="all-alert-emails">Allow alert emails</FieldLabel>
          <FieldDescription>The master switch overrides every email subscription, including queued alert emails.</FieldDescription>
        </FieldContent>
        <Switch id="all-alert-emails" checked={prefs.email_enabled} disabled={pending} onCheckedChange={(email_enabled) => change({ ...prefs, email_enabled })} />
      </Field>
      <Table aria-label="Notification preferences grid">
        <TableHeader><TableRow>
          <TableHead>Alert type</TableHead>
          {levels.map((level) => <TableHead key={level} className="text-center"><Badge variant={variants[level]}>{labels[level]}</Badge></TableHead>)}
          <TableHead className="text-center">In app</TableHead>
        </TableRow></TableHeader>
        <TableBody>{(Object.keys(sources) as NotificationSource[]).map((source) => {
          const available = source === "workflow" || prefs.operations_access
          return <TableRow key={source}>
            <TableCell className="min-w-52 whitespace-normal">
              <FieldTitle>{sources[source].label}</FieldTitle>
              <p className="mt-1 text-sm text-muted-foreground">{sources[source].description}</p>
              {!available && <p className="mt-1 text-xs text-muted-foreground">Platform operator access required.</p>}
            </TableCell>
            {levels.map((level) => <TableCell key={level} className="text-center">
              <Switch aria-label={`${sources[source].label}: ${labels[level]} emails`} checked={prefs.grid[source][level]} disabled={pending || !available} onCheckedChange={(enabled) => change({ ...prefs, grid: { ...prefs.grid, [source]: { ...prefs.grid[source], [level]: enabled } } })} />
            </TableCell>)}
            <TableCell className="text-center"><StatusMark tone={available ? "good" : "muted"}>{available ? "Always on" : "Restricted"}</StatusMark></TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">Email choices are retained while the master switch is off. Workflow emails also require a workflow subscription. Password reset and account invitation emails are separate.</p>
      <p className="text-xs text-muted-foreground">The independent watchdog refreshes these settings every minute and uses its last saved settings during an outage.</p>
    </CardContent>
  </Card>
}

function EventsDashboard() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<NotificationEvent | null>(null)
  const source = params.get("source") ?? "all"
  const severity = params.get("severity") ?? "all"
  const status = params.get("status") ?? "all"
  const search = params.get("search") ?? ""
  const page = params.get("page") ?? "1"
  const query = new URLSearchParams({ page })
  if (source !== "all") query.set("source", source)
  if (severity !== "all") query.set("severity", severity)
  if (status !== "all") query.set("status", status)
  if (search) query.set("search", search)
  const events = useQuery({ queryKey: ["notification-events", query.toString()], queryFn: () => api.notificationEvents(query.toString()), refetchInterval: 15000 })
  function filter(key: string, value: string) {
    setParams((prev) => { const next = new URLSearchParams(prev); value && value !== "all" ? next.set(key, value) : next.delete(key); if (key !== "page") next.delete("page"); return next }, { replace: true })
  }
  return <div className="flex flex-col gap-6 pt-4">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {levels.map((level) => <Card key={level}>
        <CardHeader><CardTitle><StatusMark tone={tones[level]}>{level === "recovery" ? "Recoveries" : `Active ${labels[level].toLowerCase()}`}</StatusMark></CardTitle><CardDescription>{level === "recovery" ? "Recorded recovery events" : "Incidents needing attention"}</CardDescription></CardHeader>
        <CardContent><p className="text-3xl font-semibold tabular-nums">{events.data ? events.data.summary[level === "recovery" ? "resolved" : level] : "—"}</p></CardContent>
      </Card>)}
    </div>
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search alert events" placeholder="Search events or services…" value={search} onChange={(event) => filter("search", event.target.value)} className="max-w-sm" />
        <Button variant="outline" size="sm" onClick={() => void events.refetch()} disabled={events.isFetching}><RefreshCwIcon data-icon="inline-start" />Refresh</Button>
        <span className="text-xs text-muted-foreground">Updates every 15 seconds</span>
      </div>
      <ToggleGroup type="single" value={source} onValueChange={(value) => value && filter("source", value)} variant="outline" aria-label="Filter event type" className="flex-wrap justify-start">
        <ToggleGroupItem value="all">All types</ToggleGroupItem>
        {(Object.keys(sources) as NotificationSource[]).map((key) => <ToggleGroupItem key={key} value={key}>{sources[key].label}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="flex flex-wrap gap-3">
        <ToggleGroup type="single" value={severity} onValueChange={(value) => value && filter("severity", value)} variant="outline" aria-label="Filter severity">
          <ToggleGroupItem value="all">All severities</ToggleGroupItem>
          {levels.filter((level) => level !== "recovery").map((level) => <ToggleGroupItem key={level} value={level}><StatusMark tone={tones[level]}>{labels[level]}</StatusMark></ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup type="single" value={status} onValueChange={(value) => value && filter("status", value)} variant="outline" aria-label="Filter event state">
          <ToggleGroupItem value="all">All history</ToggleGroupItem><ToggleGroupItem value="active">Active</ToggleGroupItem><ToggleGroupItem value="resolved">Recoveries</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
    <RequestError error={events.error} />
    {events.isPending ? <Skeleton className="h-64 w-full" /> : events.data && <>
      {events.data.data.length ? <Table aria-label="Alert event history">
        <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>State</TableHead><TableHead>Occurred</TableHead><TableHead className="text-right">Seen</TableHead></TableRow></TableHeader>
        <TableBody>{events.data.data.map((event) => <TableRow key={event.uuid}>
          <TableCell className="max-w-md whitespace-normal"><Button variant="link" className="h-auto max-w-full justify-start px-0 whitespace-normal text-left" onClick={() => setSelected(event)}>{event.title}</Button><p className="truncate text-xs text-muted-foreground">{event.summary}</p></TableCell>
          <TableCell>{sources[event.source].label}<span className="block text-xs text-muted-foreground">{event.service ?? ""}</span></TableCell>
          <TableCell><Badge variant={variants[event.status === "resolved" ? "recovery" : event.severity]}>{labels[event.status === "resolved" ? "recovery" : event.severity]}</Badge></TableCell>
          <TableCell><StatusMark tone={event.active ? tones[event.severity] : "good"}>{event.status === "resolved" ? "Resolved" : event.active ? "Active" : "Recovered"}</StatusMark></TableCell>
          <TableCell className="text-xs tabular-nums">{formatDateTime(event.occurred_at)}</TableCell>
          <TableCell className="text-right tabular-nums">{event.occurrences}</TableCell>
        </TableRow>)}</TableBody>
      </Table> : <DeviceEmpty title="No matching events" description="New alerts and recoveries appear here even when all emails are off." />}
      <DevicePages meta={events.data.meta} label="Events" onPage={(value) => filter("page", String(value))} />
    </>}
    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader><SheetTitle>{selected?.title ?? "Event details"}</SheetTitle><SheetDescription>{selected && sources[selected.source].label}</SheetDescription></SheetHeader>
        {selected && <div className="flex flex-col gap-4 p-4">
          <Badge variant={variants[selected.status === "resolved" ? "recovery" : selected.severity]}>{labels[selected.status === "resolved" ? "recovery" : selected.severity]}</Badge>
          <p className="whitespace-pre-wrap break-words text-sm">{selected.summary}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Occurred</dt><dd>{formatDateTime(selected.occurred_at)}</dd>
            <dt className="text-muted-foreground">Last seen</dt><dd>{formatDateTime(selected.last_seen_at)}</dd>
            <dt className="text-muted-foreground">Seen</dt><dd>{selected.occurrences} notification envelope(s)</dd>
            {selected.environment && <><dt className="text-muted-foreground">Environment</dt><dd>{selected.environment}</dd></>}
            {selected.service && <><dt className="text-muted-foreground">Service</dt><dd>{selected.service}</dd></>}
          </dl>
          {selected.link && <Button variant="outline" asChild><Link to={selected.link}>Open workflow alert</Link></Button>}
        </div>}
      </SheetContent>
    </Sheet>
  </div>
}
