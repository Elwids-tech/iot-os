import { useState, type ReactNode } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Link,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  AlertDelivery,
  Dashboard,
  WorkflowAlert,
  WorkflowAlertSource,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card";
import { Checkbox } from "@iot-os/ui/components/checkbox";
import { Field, FieldLabel } from "@iot-os/ui/components/field";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { Textarea } from "@iot-os/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format";
import { cn } from "@iot-os/ui/lib/utils";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  devicePath,
  useDeviceOrganization,
} from "../devices/shared";
import { NotificationsPage } from "./NotificationSettings";
import { EmailPreferencesPage } from "./EmailPreferences";
import { EventLogPage } from "./EventLog";
import { Inbox } from "./Inbox";
import {
  alertDuration,
  alertQuery,
  alertTitle,
  conditionOf,
  sourceKey,
} from "./model";
import { Age, InlineSelect, useWide } from "./shared";

export default function AlertRoutes() {
  return (
    <Routes>
      <Route index element={<AlertsPage />} />
      <Route path="events" element={<EventLogPage />} />
      <Route path="preferences" element={<EmailPreferencesPage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route
        path="notifications/:workflowUuid"
        element={<NotificationsPage />}
      />
      <Route path=":alertUuid" element={<AlertsPage />} />
    </Routes>
  );
}

const conditionMark = (alert: WorkflowAlert) =>
  alert.condition === "active" ? (
    <StatusMark tone="warning">Active</StatusMark>
  ) : (
    <StatusMark tone="muted">Cleared</StatusMark>
  );
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Duration, acknowledgement and assignee; the title already names workflow and device. */
function AlertMeta({ alert }: { alert: WorkflowAlert }) {
  return (
    <>
      {!alert.device_name && "Device not found · "}
      {alertDuration(alert)}
      {alert.cleared_at && (
        <>
          , <Age value={alert.cleared_at} />
        </>
      )}
      {" · "}
      {alert.acknowledged_at ? (
        "Acknowledged"
      ) : (
        <span className="text-foreground">Unacknowledged</span>
      )}
      {alert.assignee && ` · ${alert.assignee.name}`}
      {alert.execution_stopped_reason && " · Execution stopped"}
    </>
  );
}

function AlertRow({
  alert,
  to,
  current,
  select,
  children,
}: {
  alert: WorkflowAlert;
  to: string;
  current: boolean;
  select?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative flex gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/50 md:px-6",
        current && "bg-muted shadow-[inset_2px_0_0_var(--primary)]",
      )}
    >
      {select && <div className="relative z-10 flex h-6 items-center">{select}</div>}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
        <Link
          to={to}
          aria-current={current ? "page" : undefined}
          className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {alertTitle(alert)}
        </Link>
        <span className="text-xs">{conditionMark(alert)}</span>
        <span className="col-span-2 truncate text-xs text-muted-foreground">
          <AlertMeta alert={alert} />
        </span>
        {children && (
          <span className="col-span-2 truncate text-xs text-muted-foreground">
            {children}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * List and detail side by side when wide; below 1280px the detail route shows the detail alone.
 * Both layouts are one tree so crossing the breakpoint keeps the detail (and its comment draft) mounted.
 * Repeats of one workflow on one device are grouped unless the URL asks for individual alerts.
 */
function AlertsPage() {
  const { alertUuid: selected } = useParams();
  const wide = useWide();
  const narrowDetail = Boolean(selected) && !wide;
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const list = `/organizations/${org}/alerts`;
  const search = params.size ? `?${params}` : "";
  const listed = capabilities.view && !narrowDetail;
  const grouped = params.get("view") !== "individual";
  const condition = conditionOf(params);
  const mine = params.get("assignee") === "me";
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: Infinity,
    enabled: mine,
  });
  const ready = listed && (!mine || Boolean(session.data));
  // The URL keeps "assignee=me" and leaves the default condition out; the API gets ids and explicit filters.
  const server = alertQuery(params, session.data?.id);
  const sources = useQuery({
    queryKey: ["alerts", org, "sources", server.toString()],
    queryFn: () => api.alertSources(org, server.toString()),
    enabled: ready && grouped,
    refetchInterval: 5000,
  });
  const individual = useQuery({
    queryKey: ["alerts", org, server.toString()],
    queryFn: () => api.alerts(org, server.toString()),
    enabled: ready && !grouped,
    refetchInterval: 5000,
  });
  const query = grouped ? sources : individual;
  const countBase = new URLSearchParams(server);
  countBase.delete("condition");
  countBase.delete("page");
  countBase.set("per_page", "1");
  const conditions = ["active", "cleared", "all"] as const;
  const counts = useQueries({
    queries: conditions.map((value) => {
      const count = new URLSearchParams(countBase);
      if (value !== "all") count.set("condition", value);
      return {
        queryKey: ["alerts", org, "count", count.toString()],
        queryFn: () => api.alerts(org, count.toString()),
        enabled: ready,
        refetchInterval: 10000,
      };
    }),
  });
  // Shares the detail's cache entry, so the group of an older occurrence stays highlighted.
  const selectedAlert = useQuery({
    queryKey: ["alert", org, selected],
    queryFn: () => api.alert(org, selected!),
    enabled: capabilities.view && Boolean(selected),
  });
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePage, setDevicePage] = useState(1);
  const devices = useQuery({
    queryKey: ["alert-device-options", org, deviceSearch, devicePage],
    queryFn: () => api.devices(org, { search: deviceSearch, page: devicePage }),
    enabled: listed,
  });
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [workflowPage, setWorkflowPage] = useState(1);
  const workflows = useQuery({
    queryKey: ["alert-workflow-options", org, workflowSearch, workflowPage],
    queryFn: () => api.dashboardWorkflows(org, workflowSearch, workflowPage),
    enabled: listed,
  });
  // Selection belongs to one list: changing filters, page or grouping starts over.
  const listKey = `${grouped}:${server}`;
  const [picked, setPicked] = useState({ key: "", ids: [] as string[] });
  const chosen = picked.key === listKey ? picked.ids : [];
  const [confirm, setConfirm] = useState(false);
  const groups = sources.data?.data ?? [];
  const rows = individual.data?.data ?? [];
  const selectable = grouped
    ? groups.filter((group) => group.unacknowledged > 0).map(sourceKey)
    : rows.filter((alert) => !alert.acknowledged_at).map((alert) => alert.uuid);
  const pending = grouped
    ? groups
        .filter((group) => chosen.includes(sourceKey(group)))
        .reduce((total, group) => total + group.unacknowledged, 0)
    : chosen.length;
  const acknowledge = useMutation({
    mutationFn: async () => {
      if (!grouped)
        return (await api.acknowledgeAlerts(org, { alert_uuids: chosen }))
          .acknowledged;
      // Each source acknowledges what the list counted: the same condition and assignee filters.
      const assignee = server.get("assignee");
      let total = 0;
      for (const key of chosen) {
        const [workflow_uuid, device_uuid] = key.split("|");
        total += (
          await api.acknowledgeAlerts(org, {
            workflow_uuid,
            device_uuid,
            ...(condition !== "all" && { condition }),
            ...(assignee && { assignee: Number(assignee) }),
          })
        ).acknowledged;
      }
      return total;
    },
    onSuccess: () => setPicked({ key: "", ids: [] }),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["alerts", org] });
      void cache.invalidateQueries({ queryKey: ["alert", org] });
    },
  });
  const change = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const denied = !organization.isPending && !capabilities.view;
  const shown: WorkflowAlert[] = grouped ? groups.map((group) => group.latest) : rows;
  const filtered = ["acknowledged", "device", "workflow", "assignee"].some((key) =>
    params.has(key),
  );
  const deviceName =
    shown.find((alert) => alert.device_uuid === params.get("device"))
      ?.device_name ?? undefined;
  const workflowName =
    shown.find((alert) => alert.workflow_uuid === params.get("workflow"))
      ?.workflow_name ?? undefined;
  const selectedSource =
    selectedAlert.data?.uuid === selected && selectedAlert.data
      ? sourceKey(selectedAlert.data)
      : null;
  const isCurrent = (alert: WorkflowAlert) =>
    alert.uuid === selected || (grouped && selectedSource === sourceKey(alert));
  const empty = filtered
    ? ["No alerts match these filters", "Change or clear the filters to see more alerts."]
    : condition === "active"
      ? ["No active alerts", "Nothing needs attention right now. Cleared alerts stay under Cleared."]
      : condition === "cleared"
        ? ["No cleared alerts", "Alerts appear here once their condition clears."]
        : ["No alerts yet", "Alerts appear when an active workflow's condition changes."];
  const total = query.data?.meta.total;
  return (
    <Inbox
      tab="alerts"
      header={!narrowDetail || denied}
      filters={
        !denied && (
          <>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Condition"
              value={condition}
              onValueChange={(value) => {
                if (value) change("condition", value === "active" ? null : value);
              }}
            >
              {conditions.map((value, index) => (
                <ToggleGroupItem key={value} value={value}>
                  {value === "active" ? "Active" : value === "cleared" ? "Cleared" : "All"}
                  <span className="tabular-nums opacity-70">
                    {counts[index].data?.meta.total}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Repeats"
              value={grouped ? "grouped" : "individual"}
              onValueChange={(value) => {
                if (value) change("view", value === "grouped" ? null : value);
              }}
            >
              <ToggleGroupItem value="grouped">Grouped</ToggleGroupItem>
              <ToggleGroupItem value="individual">Individual</ToggleGroupItem>
            </ToggleGroup>
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id="alerts-unacknowledged"
                checked={params.get("acknowledged") === "0"}
                onCheckedChange={(checked) =>
                  change("acknowledged", checked === true ? "0" : null)
                }
              />
              <FieldLabel htmlFor="alerts-unacknowledged" className="font-normal">
                Unacknowledged only
              </FieldLabel>
            </Field>
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id="alerts-mine"
                checked={mine}
                onCheckedChange={(checked) =>
                  change("assignee", checked === true ? "me" : null)
                }
              />
              <FieldLabel htmlFor="alerts-mine" className="font-normal">
                Assigned to me
              </FieldLabel>
            </Field>
            <InlineSelect
              label="Device"
              value={params.get("device") ?? ""}
              selectedLabel={params.get("device") ? deviceName : "All devices"}
              options={[
                { value: "", label: "All devices" },
                ...(devices.data?.data ?? []).map((device) => ({
                  value: device.uuid,
                  label: device.name,
                })),
              ]}
              search={deviceSearch}
              onSearchChange={(value) => {
                setDeviceSearch(value);
                setDevicePage(1);
              }}
              page={devicePage}
              onPageChange={setDevicePage}
              hasNextPage={devicePage < (devices.data?.meta.last_page ?? 1)}
              loading={devices.isFetching}
              onChange={(value) => change("device", value)}
            />
            <InlineSelect
              label="Workflow"
              value={params.get("workflow") ?? ""}
              selectedLabel={params.get("workflow") ? workflowName : "All workflows"}
              options={[
                { value: "", label: "All workflows" },
                ...(workflows.data?.data ?? []).map((workflow) => ({
                  value: workflow.uuid,
                  label: workflow.name,
                })),
              ]}
              search={workflowSearch}
              onSearchChange={(value) => {
                setWorkflowSearch(value);
                setWorkflowPage(1);
              }}
              page={workflowPage}
              onPageChange={setWorkflowPage}
              hasNextPage={workflowPage < (workflows.data?.meta.last_page ?? 1)}
              loading={workflows.isFetching}
              onChange={(value) => change("workflow", value)}
            />
            {total !== undefined && (
              <span
                className="ml-auto text-sm text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {grouped ? plural(total, "source") : plural(total, "alert")}
              </span>
            )}
          </>
        )
      }
    >
      {denied ? (
        <div className="p-4 md:p-6">
          <DeviceEmpty
            title="Alerts unavailable"
            description="You need device viewing access in this organization."
          />
        </div>
      ) : (
        <div className="flex-1 xl:grid xl:grid-cols-[440px_minmax(0,1fr)]">
          {!narrowDetail && (
            <div className="min-w-0 xl:border-r">
              {(organization.error || query.error) && (
                <div className="p-4">
                  <RequestError error={organization.error ?? query.error} />
                </div>
              )}
              {capabilities.manage && (grouped ? groups : rows).length > 0 && (
                <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 md:px-6">
                  <Checkbox
                    aria-label={grouped ? "Select every source on this page" : "Select every alert on this page"}
                    disabled={!selectable.length || acknowledge.isPending}
                    checked={
                      selectable.length > 0 && chosen.length === selectable.length
                        ? true
                        : chosen.length
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      setPicked({ key: listKey, ids: checked === true ? selectable : [] })
                    }
                  />
                  <span role="status" className="mr-auto text-sm text-muted-foreground">
                    {acknowledge.isPending
                      ? "Acknowledging…"
                      : chosen.length
                        ? `${plural(chosen.length, grouped ? "source" : "alert")} selected`
                        : acknowledge.isSuccess
                          ? `Acknowledged ${plural(acknowledge.data, "alert")}.`
                          : "None selected"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pending || acknowledge.isPending}
                    onClick={() => (pending > 1 ? setConfirm(true) : acknowledge.mutate())}
                  >
                    Acknowledge selected{pending ? ` (${pending.toLocaleString()})` : ""}
                  </Button>
                </div>
              )}
              {!confirm && <RequestError error={acknowledge.error} />}
              {query.isPending || organization.isPending ? (
                <div className="p-4">
                  <Skeleton className="h-48 w-full" />
                </div>
              ) : shown.length ? (
                <ul aria-label={grouped ? "Alert sources" : "Alerts"} className="border-b">
                  {grouped
                    ? groups.map((group) => {
                        const key = sourceKey(group);
                        return (
                          <SourceRow
                            key={key}
                            group={group}
                            to={`${list}/${group.latest.uuid}${search}`}
                            current={isCurrent(group.latest)}
                            select={
                              capabilities.manage && (
                                <Checkbox
                                  aria-label={`Select ${alertTitle(group.latest)}`}
                                  disabled={!group.unacknowledged || acknowledge.isPending}
                                  checked={chosen.includes(key)}
                                  onCheckedChange={(checked) =>
                                    setPicked({
                                      key: listKey,
                                      ids: checked === true ? [...chosen, key] : chosen.filter((id) => id !== key),
                                    })
                                  }
                                />
                              )
                            }
                          />
                        );
                      })
                    : rows.map((alert) => (
                        <AlertRow
                          key={alert.uuid}
                          alert={alert}
                          to={`${list}/${alert.uuid}${search}`}
                          current={isCurrent(alert)}
                          select={
                            capabilities.manage && (
                              <Checkbox
                                aria-label={`Select ${alertTitle(alert)}, occurrence ${alert.episode}`}
                                disabled={Boolean(alert.acknowledged_at) || acknowledge.isPending}
                                checked={chosen.includes(alert.uuid)}
                                onCheckedChange={(checked) =>
                                  setPicked({
                                    key: listKey,
                                    ids: checked === true ? [...chosen, alert.uuid] : chosen.filter((id) => id !== alert.uuid),
                                  })
                                }
                              />
                            )
                          }
                        />
                      ))}
                </ul>
              ) : !query.error ? (
                <div className="p-4">
                  <DeviceEmpty title={empty[0]} description={empty[1]} />
                  {filtered && (
                    <div className="flex justify-center">
                      <Button variant="outline" onClick={() => setParams({})}>
                        Clear filters
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="px-4 pb-4 md:px-6">
                <DevicePages
                  meta={query.data?.meta}
                  label="Alerts"
                  onPage={(page) => {
                    const next = new URLSearchParams(params);
                    next.set("page", String(page));
                    setParams(next);
                  }}
                />
              </div>
              <Confirm
                open={confirm}
                title={`Acknowledge ${plural(pending, "alert")}?`}
                description={
                  grouped
                    ? `Acknowledges every unacknowledged ${condition === "all" ? "" : `${condition} `}alert of the ${plural(chosen.length, "selected source")}. This records that you have seen them; it does not clear active conditions.`
                    : "This records that you have seen the selected alerts; it does not clear active conditions."
                }
                action="Acknowledge"
                destructive={false}
                onClose={() => setConfirm(false)}
                onConfirm={() => acknowledge.mutateAsync()}
              />
            </div>
          )}
          {selected ? (
            <AlertDetail
              key={`${org}:${selected}`}
              id={selected}
              search={search}
              back={narrowDetail ? list + search : undefined}
            />
          ) : wide ? (
            <AlertsSummary />
          ) : null}
        </div>
      )}
    </Inbox>
  );
}

function SourceRow({
  group,
  ...props
}: {
  group: WorkflowAlertSource;
  to: string;
  current: boolean;
  select?: ReactNode;
}) {
  return (
    <AlertRow alert={group.latest} {...props}>
      {group.occurrences > 1 && (
        <>
          {plural(group.occurrences, "occurrence")}
          {group.first_activated_at && ` over ${formatAge(group.first_activated_at)}`}
          {" · "}
          {group.unacknowledged
            ? `${group.unacknowledged.toLocaleString()} unacknowledged`
            : "all acknowledged"}
        </>
      )}
    </AlertRow>
  );
}

/** What needs attention when no alert is selected, each figure a shortcut to its list. */
function AlertsSummary() {
  const { org, capabilities } = useDeviceOrganization();
  const list = `/organizations/${org}/alerts`;
  const figures = [
    { label: "Active now", filter: "condition=active", to: list, hint: "Conditions currently true" },
    { label: "Active, unacknowledged", filter: "condition=active&acknowledged=0", to: `${list}?acknowledged=0`, hint: "Nobody has confirmed seeing these" },
    { label: "Cleared, unacknowledged", filter: "condition=cleared&acknowledged=0", to: `${list}?condition=cleared&acknowledged=0`, hint: "History waiting for review" },
  ];
  const counts = useQueries({
    queries: figures.map(({ filter }) => ({
      queryKey: ["alerts", org, "count", `${filter}&per_page=1`],
      queryFn: () => api.alerts(org, `${filter}&per_page=1`),
      enabled: capabilities.view,
      refetchInterval: 10000,
    })),
  });
  return (
    <section aria-labelledby="alerts-summary" className="flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <h2 id="alerts-summary" className="text-base font-semibold">
        Summary
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {figures.map((figure, index) => (
          <Card key={figure.label} size="sm">
            <CardHeader>
              <CardTitle>{figure.label}</CardTitle>
              <CardDescription>{figure.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to={figure.to}
                className="text-3xl font-semibold tabular-nums underline-offset-4 hover:underline"
                aria-label={`${figure.label}: ${counts[index].data?.meta.total ?? "loading"}`}
              >
                {counts[index].data?.meta.total.toLocaleString() ?? "—"}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Select an alert to see its timeline, acknowledge it or assign it.
        Repeats of one workflow on one device are grouped:
        {capabilities.manage
          ? " select sources and choose Acknowledge selected, or open an alert and acknowledge every cleared occurrence of its source at once."
          : " open an alert to see the other occurrences of its source."}
      </p>
    </section>
  );
}

/** Other occurrences of the alert's workflow on its device, with acknowledging every cleared one at once. */
function SourceOccurrences({
  alert,
  search,
  Heading,
}: {
  alert: WorkflowAlert;
  search: string;
  Heading: "h2" | "h3";
}) {
  const { org, capabilities } = useDeviceOrganization();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const source = new URLSearchParams({
    workflow: alert.workflow_uuid,
    device: alert.device_uuid,
  });
  const recent = `${source}&per_page=5`;
  const occurrences = useQuery({
    queryKey: ["alerts", org, recent],
    queryFn: () => api.alerts(org, recent),
    refetchInterval: 10000,
  });
  const waitingQuery = `${source}&condition=cleared&acknowledged=0&per_page=1`;
  const waiting = useQuery({
    queryKey: ["alerts", org, "count", waitingQuery],
    queryFn: () => api.alerts(org, waitingQuery),
    enabled: capabilities.manage,
    refetchInterval: 10000,
  });
  const acknowledge = useMutation({
    mutationFn: () =>
      api.acknowledgeAlerts(org, {
        workflow_uuid: alert.workflow_uuid,
        device_uuid: alert.device_uuid,
        condition: "cleared",
      }),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["alerts", org] });
      void cache.invalidateQueries({ queryKey: ["alert", org] });
    },
  });
  const total = occurrences.data?.meta.total ?? 0;
  if (total < 2) return null;
  const cleared = waiting.data?.meta.total ?? 0;
  const list = `/organizations/${org}/alerts`;
  const all = new URLSearchParams({ view: "individual", condition: "all", ...Object.fromEntries(source) });
  return (
    <section aria-labelledby="alert-occurrences" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id="alert-occurrences" className="text-sm font-semibold">
          Occurrences
        </Heading>
        <Link className="text-sm underline underline-offset-4" to={`${list}?${all}`}>
          Show all {total.toLocaleString()}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        This workflow has alerted {plural(total, "time")} on this device
        {capabilities.manage && cleared
          ? `; ${cleared.toLocaleString()} cleared ${cleared === 1 ? "occurrence is" : "occurrences are"} unacknowledged.`
          : "."}
      </p>
      {capabilities.manage && cleared > 0 && (
        <Button
          variant="outline"
          className="self-start"
          disabled={acknowledge.isPending}
          onClick={() => (cleared > 1 ? setConfirm(true) : acknowledge.mutate())}
        >
          {acknowledge.isPending
            ? "Acknowledging…"
            : `Acknowledge all cleared (${cleared.toLocaleString()})`}
        </Button>
      )}
      {acknowledge.isSuccess && !acknowledge.isPending && (
        <p role="status" className="text-sm">
          Acknowledged {plural(acknowledge.data.acknowledged, "cleared alert")}.
        </p>
      )}
      {!confirm && <RequestError error={acknowledge.error} />}
      <ol aria-label="Recent occurrences" className="flex flex-col text-sm">
        {(occurrences.data?.data ?? []).map((item) => (
          <li
            key={item.uuid}
            className="flex flex-wrap items-baseline gap-x-3 border-b py-1.5 last:border-b-0"
          >
            {item.uuid === alert.uuid ? (
              <span className="font-medium">Occurrence {item.episode} (this alert)</span>
            ) : (
              <Link className="underline underline-offset-4" to={`${list}/${item.uuid}${search}`}>
                Occurrence {item.episode}
              </Link>
            )}
            <span className="text-xs">{conditionMark(item)}</span>
            <span className="text-xs text-muted-foreground">
              {alertDuration(item)} ·{" "}
              {item.acknowledged_at ? "Acknowledged" : "Unacknowledged"}
            </span>
          </li>
        ))}
      </ol>
      <Confirm
        open={confirm}
        title={`Acknowledge ${plural(cleared, "cleared alert")}?`}
        description="Records that you have seen every cleared, unacknowledged occurrence of this workflow on this device. Active occurrences stay unacknowledged for review."
        action="Acknowledge"
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={() => acknowledge.mutateAsync()}
      />
    </section>
  );
}

const deliveryTones: Record<string, StatusTone> = {
  sent: "good",
  failed: "critical",
  pending: "info",
  cancelled: "muted",
};
const sentence = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
/** Clock time for today, date and time otherwise. */
const clock = (iso: string) => {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    undefined,
    today
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  );
};
const usesDevice = (dashboard: Dashboard, device: string) =>
  dashboard.widgets.some(
    (widget) =>
      widget.config.sources?.some((source) => source.device_uuid === device) ||
      widget.config.devices?.some((item) => item.device_uuid === device),
  );

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function AlertDetail({
  id,
  search,
  back,
}: {
  id: string;
  search: string;
  back?: string;
}) {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const cache = useQueryClient();
  const [comment, setComment] = useState({
    uuid: crypto.randomUUID(),
    body: "",
  });
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState<AlertDelivery | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  useUnsavedContribution(Boolean(comment.body));
  const query = useQuery({
    queryKey: ["alert", org, id],
    queryFn: () => api.alert(org, id),
    enabled: capabilities.view,
    refetchInterval: 5000,
  });
  const alert = query.data;
  const comments = useQuery({
    queryKey: ["alert-comments", org, id, page],
    queryFn: () => api.alertComments(org, id, page),
    enabled: capabilities.view,
  });
  const deliveries = useQuery({
    queryKey: ["alert-deliveries", org, id],
    queryFn: () => api.alertDeliveries(org, id),
    enabled: capabilities.manage,
    refetchInterval: 5000,
  });
  const dashboards = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
    enabled: capabilities.view && Boolean(alert),
    staleTime: 60000,
  });
  const members = useQuery({
    queryKey: [
      "notification-recipients",
      org,
      alert?.workflow_uuid,
      memberSearch,
      memberPage,
    ],
    queryFn: () =>
      api.notificationRecipients(
        org,
        alert!.workflow_uuid,
        memberSearch,
        memberPage,
      ),
    enabled: capabilities.manage && Boolean(alert),
  });
  const updated = (data: WorkflowAlert) => {
    cache.setQueryData(["alert", org, id], data);
    void cache.invalidateQueries({ queryKey: ["alerts", org] });
  };
  const acknowledge = useMutation({
    mutationFn: () => api.acknowledgeAlert(org, id),
    onSuccess: updated,
  });
  const assign = useMutation({
    mutationFn: (user: number | null) => api.assignAlert(org, id, user),
    onSuccess: updated,
  });
  const addComment = useMutation({
    mutationFn: () => api.addAlertComment(org, id, comment),
    onSuccess: () => {
      setComment({ uuid: crypto.randomUUID(), body: "" });
      void cache.invalidateQueries({ queryKey: ["alert-comments", org, id] });
    },
  });
  const title = alert ? alertTitle(alert) : "Alert";
  const occurrence = alert ? `Occurrence ${alert.episode}` : undefined;
  // Sections sit under the page h1 when narrow and under the pane's h2 when wide.
  const Heading = back ? "h2" : "h3";
  const settings = alert
    ? `/organizations/${org}/alerts/notifications/${alert.workflow_uuid}`
    : "";
  const usedIn =
    alert && dashboards.data
      ? dashboards.data.filter((dashboard) =>
          usesDevice(dashboard, alert.device_uuid),
        )
      : [];
  const timeline: {
    key: string;
    at: string;
    tone: StatusTone;
    text: string;
    detail?: string;
  }[] = [];
  if (alert?.activated_at)
    timeline.push({
      key: "activated",
      at: alert.activated_at,
      tone: "warning",
      text: "Activated",
    });
  for (const delivery of deliveries.data?.data ?? [])
    for (const attempt of delivery.history)
      timeline.push({
        key: `${delivery.uuid}-${attempt.attempt}`,
        at: attempt.created_at,
        tone: attempt.status === "accepted" ? "good" : "critical",
        text: `${delivery.type === "activated" ? "Activation" : "Recovery"} email to ${delivery.recipient_name}`,
        detail: `Attempt ${attempt.attempt} · ${attempt.status === "accepted" ? "accepted by mail server" : "transport failed, outcome uncertain"}`,
      });
  if (alert?.acknowledged_at)
    timeline.push({
      key: "acknowledged",
      at: alert.acknowledged_at,
      tone: "good",
      text: `Acknowledged by ${alert.acknowledged_by_name ?? "a former member"}`,
    });
  if (alert?.assigned_at && alert.assignee)
    timeline.push({
      key: "assigned",
      at: alert.assigned_at,
      tone: "info",
      text: `Assigned to ${alert.assignee.name}`,
    });
  for (const item of comments.data?.data ?? [])
    timeline.push({
      key: item.uuid,
      at: item.created_at,
      tone: "muted",
      text: `Comment by ${item.author_name}`,
      detail: item.body,
    });
  if (alert?.cleared_at)
    timeline.push({
      key: "cleared",
      at: alert.cleared_at,
      tone: "muted",
      text: "Cleared",
    });
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const body = (
    <div className="flex min-w-0 flex-col gap-6">
      <RequestError error={organization.error ?? query.error} />
      {query.isPending && capabilities.view ? (
        <Skeleton className="h-48 w-full" />
      ) : null}
      {!organization.isPending && !capabilities.view ? (
        <DeviceEmpty
          title="Alert unavailable"
          description="You need device viewing access in this organization."
        />
      ) : null}
      {alert ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!back && (
              <div className="mr-auto flex min-w-0 flex-wrap items-baseline gap-x-3">
                <h2 className="min-w-0 text-base font-semibold">{title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {occurrence}
                </span>
              </div>
            )}
            {capabilities.manage && (
              <InlineSelect
                label="Assignee"
                value={alert.assignee ? String(alert.assignee.id) : ""}
                selectedLabel={alert.assignee?.name ?? "Unassigned"}
                options={[
                  { value: "", label: "Unassigned" },
                  ...(members.data?.data ?? []).map((member) => ({
                    value: String(member.id),
                    label: member.name,
                  })),
                ]}
                search={memberSearch}
                onSearchChange={(value) => {
                  setMemberSearch(value);
                  setMemberPage(1);
                }}
                page={memberPage}
                onPageChange={setMemberPage}
                hasNextPage={memberPage < (members.data?.meta.last_page ?? 1)}
                loading={members.isFetching}
                disabled={assign.isPending}
                onChange={(value) => assign.mutate(value ? Number(value) : null)}
              />
            )}
            {capabilities.manage && !alert.acknowledged_at && (
              <Button
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate()}
              >
                {acknowledge.isPending ? "Acknowledging…" : "Acknowledge alert"}
              </Button>
            )}
          </div>
          <RequestError error={acknowledge.error ?? assign.error} />
          {alert.execution_stopped_reason ? (
            <Alert>
              <AlertTitle>Execution stopped</AlertTitle>
              <AlertDescription>
                {sentence(alert.execution_stopped_reason)}. This alert keeps
                its last condition; stopping execution does not clear it.
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 border-y py-4 text-sm">
            <Fact label="Condition">{conditionMark(alert)}</Fact>
            <Fact label="Acknowledgement">
              {alert.acknowledged_at ? (
                <>
                  <StatusMark tone="good">Acknowledged</StatusMark>
                  <span className="block text-xs text-muted-foreground">
                    {alert.acknowledged_by_name ?? "A former member"} ·{" "}
                    <Age value={alert.acknowledged_at} />
                  </span>
                </>
              ) : (
                <StatusMark tone="info">Unacknowledged</StatusMark>
              )}
            </Fact>
            {!capabilities.manage && (
              <Fact label="Assignee">
                {alert.assignee ? alert.assignee.name : "Unassigned"}
              </Fact>
            )}
            <Fact label="Activated">
              {alert.activated_at ? (
                <>
                  {formatDateTime(alert.activated_at)}
                  <span className="block text-xs text-muted-foreground">
                    <Age value={alert.activated_at} />
                  </span>
                </>
              ) : (
                "Not recorded"
              )}
            </Fact>
            <Fact label="Cleared">
              {alert.cleared_at ? formatDateTime(alert.cleared_at) : "Not cleared"}
            </Fact>
            <Fact label="Workflow">
              {capabilities.manage ? (
                <Link className="underline underline-offset-4" to={settings}>
                  {alert.workflow_name}
                </Link>
              ) : (
                alert.workflow_name
              )}
            </Fact>
            <Fact label="Device">
              {alert.device_name ? (
                <Link
                  className="underline underline-offset-4"
                  to={devicePath(org, alert.device_uuid)}
                >
                  {alert.device_name}
                </Link>
              ) : (
                "Device not found"
              )}
            </Fact>
            <Fact label="Dashboards">
              {usedIn.length
                ? usedIn.map((dashboard, index) => (
                    <span key={dashboard.uuid}>
                      {index > 0 && ", "}
                      <Link
                        className="underline underline-offset-4"
                        to={`/organizations/${org}/dashboards/${dashboard.uuid}`}
                      >
                        {dashboard.name}
                      </Link>
                    </span>
                  ))
                : dashboards.isPending
                  ? "Loading…"
                  : "None"}
            </Fact>
          </dl>
          <SourceOccurrences alert={alert} search={search} Heading={Heading} />
          <section aria-labelledby="alert-timeline" className="flex flex-col gap-3">
            <Heading id="alert-timeline" className="text-sm font-semibold">
              Timeline
            </Heading>
            <RequestError error={comments.error ?? deliveries.error} />
            <ol className="flex flex-col gap-3 text-sm">
              {timeline.map((entry) => (
                <li
                  key={entry.key}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3"
                >
                  <time
                    dateTime={entry.at}
                    title={formatDateTime(entry.at)}
                    className="text-xs leading-5 text-muted-foreground tabular-nums"
                  >
                    {clock(entry.at)}
                  </time>
                  <div className="min-w-0">
                    <StatusMark tone={entry.tone} className="whitespace-normal">
                      {entry.text}
                    </StatusMark>
                    {entry.detail && (
                      <p className="mt-0.5 text-xs whitespace-pre-wrap break-words text-muted-foreground">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <DevicePages
              meta={comments.data?.meta}
              label="Comments"
              onPage={setPage}
            />
          </section>
          {capabilities.manage && (
            <section
              aria-labelledby="alert-email"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Heading id="alert-email" className="text-sm font-semibold">
                  Email delivery
                </Heading>
                <Link
                  className="text-sm underline underline-offset-4"
                  to={settings}
                >
                  Notification settings
                </Link>
              </div>
              {deliveries.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : deliveries.data?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="text-right">Last attempt</TableHead>
                      <TableHead>
                        <span className="sr-only">Action</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.data.data.map((item) => {
                      const last = item.history.at(-1)?.created_at ?? null;
                      return (
                        <TableRow key={item.uuid}>
                          <TableCell>{item.recipient_name}</TableCell>
                          <TableCell>
                            {item.type === "activated" ? "Activation" : "Recovery"}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <StatusMark tone={deliveryTones[item.status] ?? "muted"}>
                              {sentence(item.status)}
                            </StatusMark>
                            {item.diagnostic && (
                              <span className="block text-xs text-muted-foreground">
                                {item.diagnostic}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.attempts}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {last ? <Age value={last} /> : "None"}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.status === "failed" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRetry(item)}
                              >
                                Retry email
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : !deliveries.error ? (
                <p className="text-sm text-muted-foreground">
                  No email was requested for this alert.
                </p>
              ) : null}
            </section>
          )}
          {capabilities.manage && (
            <section aria-labelledby="alert-comments">
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  addComment.mutate();
                }}
              >
                <Heading id="alert-comments" className="text-sm font-semibold">
                  Comments
                </Heading>
                <label htmlFor="alert-comment" className="sr-only">
                  Add a comment
                </label>
                <Textarea
                  id="alert-comment"
                  required
                  maxLength={5000}
                  rows={3}
                  placeholder="Add a comment for the team"
                  disabled={addComment.isPending}
                  value={comment.body}
                  onChange={(event) =>
                    setComment({
                      uuid: crypto.randomUUID(),
                      body: event.target.value,
                    })
                  }
                />
                <RequestError error={addComment.error} />
                <Button
                  variant="outline"
                  className="self-end"
                  disabled={addComment.isPending || !comment.body.trim()}
                >
                  {addComment.isPending ? "Adding…" : "Add comment"}
                </Button>
              </form>
            </section>
          )}
          <Confirm
            open={Boolean(retry)}
            title="Retry failed email?"
            description={`Retry delivery to ${retry?.recipient_name ?? "this recipient"}. A previous attempt may have reached the mail server, so another email could be received. Current access and notification preferences are checked again.`}
            action="Retry email"
            destructive={false}
            onClose={() => setRetry(null)}
            onConfirm={async () => {
              if (!retry) return;
              try {
                await api.retryAlertDelivery(
                  org,
                  id,
                  retry.uuid,
                  retry.retry_generation,
                );
              } finally {
                await cache.invalidateQueries({
                  queryKey: ["alert-deliveries", org, id],
                });
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
  // The header comes and goes with the layout; the section stays so its subtree keeps its state.
  return (
    <>
      {back && (
        <PageHeader
          title={title}
          meta={occurrence}
          back={{ to: back, label: "Alerts" }}
        />
      )}
      <section aria-label="Alert detail" className="min-w-0 p-4 md:p-6">
        {body}
      </section>
    </>
  );
}
