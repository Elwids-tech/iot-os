import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCwIcon } from "lucide-react";
import type { NotificationEvent, NotificationSource } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card";
import { FilterBar, FilterSearch } from "@iot-os/ui/components/filter-bar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet";
import { StatusMark } from "@iot-os/ui/components/status-mark";
import { DataTable } from "@iot-os/ui/components/data-table";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { useDeviceOrganization } from "../devices/shared";
import { Inbox } from "./Inbox";
import { labels, sources, tones } from "./EmailPreferences";
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
        <DataTable
          id="event-log"
          label="Event log"
          noun={["event", "events"]}
          rows={events.data?.data}
          rowKey={(event) => event.uuid}
          columns={[
            {
              id: "event",
              header: "Event",
              mobile: "title",
              className: "max-w-md whitespace-normal",
              value: (event) => event.title,
              cell: (event) => (
                <>
                  <Button
                    variant="link"
                    className="relative z-10 h-auto max-w-full justify-start px-0 text-left font-medium whitespace-normal text-foreground"
                    onClick={() => setSelected(event)}
                  >
                    {event.title}
                  </Button>
                  <p className="truncate text-meta text-muted-foreground">{event.summary}</p>
                </>
              ),
            },
            {
              id: "type",
              header: "Type",
              value: (event) => sources[event.source].label,
              cell: (event) => (
                <>
                  {sources[event.source].label}
                  <span className="block text-meta text-muted-foreground">{event.service ?? ""}</span>
                </>
              ),
            },
            {
              id: "severity",
              header: "Severity",
              mobile: "badge",
              value: (event) => labels[event.severity],
              cell: (event) => <StatusMark tone={tones[event.severity]}>{labels[event.severity]}</StatusMark>,
            },
            {
              id: "state",
              header: "State",
              value: (event) => eventState(event),
              cell: (event) => {
                const state = eventState(event);
                return <StatusMark tone={state === "Active" ? tones[event.severity] : "muted"}>{state}</StatusMark>;
              },
            },
            {
              id: "occurred",
              header: "Occurred",
              value: (event) => event.occurred_at,
              cell: (event) => <span className="text-meta tabular-nums">{formatDateTime(event.occurred_at)}</span>,
            },
            {
              id: "seen",
              header: "Seen",
              align: "end",
              value: (event) => event.occurrences,
              cell: (event) => <span className="tabular-nums">{event.occurrences}</span>,
            },
          ]}
          error={events.error ? <RequestError error={events.error} /> : undefined}
          filtered={source !== "all" || severity !== "all" || status !== "all" || Boolean(search)}
          onReset={() => filter({ source: "", severity: "", status: "", search: "" })}
          pagination={{
            page: Number(params.get("page") ?? 1),
            pageSize: 25,
            total: events.data?.meta.total ?? 0,
            pageCount: events.data?.meta.last_page,
            onPageChange: (value) => filter({ page: String(value) }),
          }}
          refreshSeconds={15}
          empty={
            <EmptyState
              inset
              title="No events yet"
              description="Alerts and their clears appear here even when all emails are off."
            />
          }
        />
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
                <StatusMark tone={tones[selected.severity]}>{labels[selected.severity]}</StatusMark>
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
