import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCwIcon } from "lucide-react";
import type { NotificationEvent, NotificationSource } from "@iot-os/api-client";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card";
import { FilterBar, FilterSearch } from "@iot-os/ui/components/filter-bar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { StatusMark } from "@iot-os/ui/components/status-mark";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { DeviceEmpty, DevicePages, useDeviceOrganization } from "../devices/shared";
import { Inbox } from "./Inbox";
import { labels, sources, tones, variants } from "./EmailPreferences";
import { eventState } from "./model";

const severities = ["critical", "warning", "info"] as const;

/** Workflow alert events of this organization plus service monitoring and watchdog events, newest first. */
export function EventLogPage() {
  const { org } = useDeviceOrganization();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<NotificationEvent | null>(null);
  const source = params.get("source") ?? "all";
  const severity = params.get("severity") ?? "all";
  const status = params.get("status") ?? "all";
  const search = params.get("search") ?? "";
  const query = new URLSearchParams({ page: params.get("page") ?? "1", organization: org });
  if (source !== "all") query.set("source", source);
  if (severity !== "all") query.set("severity", severity);
  if (status !== "all") query.set("status", status);
  if (search) query.set("search", search);
  const events = useQuery({
    queryKey: ["notification-events", query.toString()],
    queryFn: () => api.notificationEvents(query.toString()),
    refetchInterval: 15000,
  });
  function filter(values: Record<string, string>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(values))
          if (value && value !== "all") next.set(key, value);
          else next.delete(key);
        if (!("page" in values)) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  const summary = events.data?.summary;
  return (
    <Inbox
      tab="events"
      filters={
        <FilterBar>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Event state"
            value={status}
            onValueChange={(value) => value && filter({ status: value })}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="active">Active</ToggleGroupItem>
            <ToggleGroupItem value="cleared">Cleared</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Event type"
            value={source}
            onValueChange={(value) => value && filter({ source: value })}
          >
            <ToggleGroupItem value="all">All types</ToggleGroupItem>
            {(Object.keys(sources) as NotificationSource[]).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {sources[key].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Severity"
            value={severity}
            onValueChange={(value) => value && filter({ severity: value })}
          >
            <ToggleGroupItem value="all">All severities</ToggleGroupItem>
            {severities.map((level) => (
              <ToggleGroupItem key={level} value={level}>
                {labels[level]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FilterSearch
            label="Search events"
            placeholder="Search events or services…"
            value={search}
            onChange={(event) => filter({ search: event.target.value })}
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Updates every 15 seconds</span>
            <Button variant="outline" size="sm" onClick={() => void events.refetch()} disabled={events.isFetching}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </FilterBar>
      }
    >
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {severities.map((level) => (
            <Card key={level} size="sm">
              <CardHeader>
                <CardTitle>
                  <StatusMark tone={tones[level]}>Active {labels[level].toLowerCase()}</StatusMark>
                </CardTitle>
                <CardDescription>Needing attention now</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="link"
                  className="h-auto p-0 text-3xl font-semibold tabular-nums"
                  aria-label={`Show ${summary?.[level] ?? 0} active ${labels[level].toLowerCase()} events`}
                  disabled={!summary}
                  onClick={() => filter({ status: "active", severity: level })}
                >
                  {summary ? summary[level] : "—"}
                </Button>
              </CardContent>
            </Card>
          ))}
          <Card size="sm">
            <CardHeader>
              <CardTitle>Active by type</CardTitle>
              <CardDescription>Open events per source</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1">
                {(Object.keys(sources) as NotificationSource[]).map((key) => (
                  <li key={key} className="flex items-center justify-between gap-3">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      disabled={!summary}
                      onClick={() => filter({ status: "active", source: key })}
                    >
                      {sources[key].label}
                    </Button>
                    <span className="font-semibold tabular-nums">{summary ? summary.sources[key] : "—"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <RequestError error={events.error} />
        {events.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          events.data && (
            <div>
              {events.data.data.length ? (
                <Table aria-label="Event log">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Occurred</TableHead>
                      <TableHead className="text-right">Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.data.data.map((event) => {
                      const state = eventState(event);
                      return (
                        <TableRow key={event.uuid}>
                          <TableCell className="max-w-md whitespace-normal">
                            <Button
                              variant="link"
                              className="h-auto max-w-full justify-start px-0 text-left whitespace-normal"
                              onClick={() => setSelected(event)}
                            >
                              {event.title}
                            </Button>
                            <p className="truncate text-xs text-muted-foreground">{event.summary}</p>
                          </TableCell>
                          <TableCell>
                            {sources[event.source].label}
                            <span className="block text-xs text-muted-foreground">{event.service ?? ""}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={variants[event.severity]}>{labels[event.severity]}</Badge>
                          </TableCell>
                          <TableCell>
                            <StatusMark tone={state === "Active" ? tones[event.severity] : "muted"}>{state}</StatusMark>
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">{formatDateTime(event.occurred_at)}</TableCell>
                          <TableCell className="text-right tabular-nums">{event.occurrences}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <DeviceEmpty
                  title="No matching events"
                  description="Alerts and their clears appear here even when all emails are off."
                />
              )}
              <DevicePages meta={events.data.meta} label="Events" onPage={(value) => filter({ page: String(value) })} />
            </div>
          )
        )}
      </div>
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.title ?? "Event details"}</SheetTitle>
            <SheetDescription>{selected && sources[selected.source].label}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={variants[selected.severity]}>{labels[selected.severity]}</Badge>
                <StatusMark tone={eventState(selected) === "Active" ? tones[selected.severity] : "muted"}>
                  {eventState(selected)}
                </StatusMark>
              </div>
              <p className="text-sm break-words whitespace-pre-wrap">{selected.summary}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Occurred</dt>
                <dd>{formatDateTime(selected.occurred_at)}</dd>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd>{formatDateTime(selected.last_seen_at)}</dd>
                <dt className="text-muted-foreground">Seen</dt>
                <dd>{selected.occurrences} notification envelope(s)</dd>
                {selected.environment && (
                  <>
                    <dt className="text-muted-foreground">Environment</dt>
                    <dd>{selected.environment}</dd>
                  </>
                )}
                {selected.service && (
                  <>
                    <dt className="text-muted-foreground">Service</dt>
                    <dd>{selected.service}</dd>
                  </>
                )}
              </dl>
              {selected.link && (
                <Button variant="outline" asChild>
                  <Link to={selected.link}>Open alert</Link>
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Inbox>
  );
}
