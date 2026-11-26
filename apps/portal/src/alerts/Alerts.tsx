import { RelativeTime } from "@iot-os/ui/components/freshness";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ApiError,
  type Alert as AlertItem,
  type AlertDelivery,
  type AlertSource,
  type ConnectivityAlert,
  type Dashboard,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Checkbox } from "@iot-os/ui/components/checkbox";
import { DataTable, RowLink, ToolbarButton, type DataColumn } from "@iot-os/ui/components/data-table";
import { Field, FieldLabel } from "@iot-os/ui/components/field";
import { FilterSheet } from "@iot-os/ui/components/filter-sheet";
import { keepToastsAbove } from "@iot-os/ui/components/sonner";
import { useIsMobile } from "@iot-os/ui/hooks/use-mobile";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { InboxItem, InboxList, InboxPage } from "@iot-os/ui/templates/inbox-page";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { Panel, PanelContent } from "@iot-os/ui/components/panel";
import { Popover, PopoverContent, PopoverTrigger } from "@iot-os/ui/components/popover";
import { SearchableMultiSelect, SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { Status, StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark";
import { Textarea } from "@iot-os/ui/components/textarea";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@iot-os/ui/components/segmented-control";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format";
import { statusOf } from "@iot-os/ui/lib/status";
import { cn } from "@iot-os/ui/lib/utils";
import { api } from "../lib/api";
import { EntityPicker } from "../hierarchy/EntityPicker";
import { alertBellKeys } from "./bell/model";
import { useDashboardCapabilities } from "../dashboards/access";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, LoadError, RequestError } from "../components/forms";
import {
  DeviceEmpty,
  DevicePages,
  devicePath,
  gatewayPath,
  useDeviceOrganization,
} from "../devices/shared";
import { formatDuration } from "../devices/model";
import { notificationsPath } from "./NotificationSettings";
import { EventLogPage } from "./EventLog";
import { Inbox } from "./Inbox";
import { ChevronDownIcon, ListFilterIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible";
import {
  alertCause,
  alertCondition,
  alertDuration,
  alertKinds,
  alertQuery,
  alertSpan,
  alertTitle,
  conditionOf,
  isAlertId,
  kindLabel,
  kindsOf,
  sameSubject,
  sourceKey,
  subjectQuery,
  thresholdSource,
  thresholdText,
} from "./model";
import { useWide } from "./shared";
import { TriggerSummary } from "./Trigger";

export default function AlertRoutes() {
  return (
    <Routes>
      <Route index element={<AlertsPage />} />
      <Route path="events" element={<EventLogPage />} />
      <Route path="preferences" element={<MovedToSettings section="email" />} />
      <Route path="notifications" element={<MovedToSettings section="notifications" />} />
      <Route path="notifications/:workflowUuid" element={<MovedToSettings section="notifications" />} />
      {/* A guessed alerts/settings link would otherwise be read as an alert id. */}
      <Route path="settings" element={<MovedToSettings section="notifications" />} />
      <Route path=":alertUuid" element={<AlertsPage />} />
    </Routes>
  );
}

/** Notification settings and email preferences moved to Settings; old links keep working. */
function MovedToSettings({ section }: { section: "notifications" | "email" }) {
  const { org } = useDeviceOrganization();
  const { workflowUuid } = useParams();
  const rest = workflowUuid ? `/${encodeURIComponent(workflowUuid)}` : "";
  return <Navigate replace to={`/organizations/${org}/settings/${section}${rest}`} />;
}

const conditionMark = (alert: AlertItem) => {
  const { tone, label } = statusOf(alertCondition(alert), "alert");
  return <StatusMark tone={tone}>{label}</StatusMark>;
};
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
const alertPath = (org: string, uuid: string) =>
  `/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(uuid)}`;

/**
 * Every alert of a connectivity alert's source (its kind and subject) that matches `filters`.
 * The alerts API filters by device, so the subject is matched here.
 */
async function subjectAlerts(org: string, alert: ConnectivityAlert, filters: Record<string, string> = {}) {
  const found: AlertItem[] = [];
  for (let page = 1, last = 1; page <= last; page++) {
    const query = subjectQuery(alert);
    for (const [key, value] of Object.entries(filters)) query.set(key, value);
    query.set("per_page", "100");
    query.set("page", String(page));
    const result = await api.alerts(org, query.toString());
    found.push(...result.data.filter((item) => sameSubject(item, alert)));
    last = result.meta.last_page;
  }
  return found;
}
/** Acknowledges listed alerts, 500 at a time as the API allows; resolves to how many were new. */
async function acknowledgeListed(org: string, uuids: string[]) {
  let total = 0;
  for (let index = 0; index < uuids.length; index += 500)
    total += (await api.acknowledgeAlerts(org, { alert_uuids: uuids.slice(index, index + 500) })).acknowledged;
  return total;
}
/** Gone, or no longer yours to see: either way the alert page shows nothing about it. */
const isNotFound = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 403);

/** Cause (connectivity), duration, acknowledgement and assignee; the title already names the source. */
function AlertMeta({ alert }: { alert: AlertItem }) {
  const cause = alertCause(alert);
  return (
    <>
      {alert.kind === "workflow" && !alert.device_name && "Device not found · "}
      {cause && `${cause} · `}
      {alertDuration(alert)}
      {alert.cleared_at && (
        <>
          , <RelativeTime at={alert.cleared_at} never={null} />
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
  mixed,
  children,
}: {
  alert: AlertItem;
  to: string;
  current: boolean;
  select?: ReactNode;
  /** The list shows active and cleared alerts together, so each row says which it is. */
  mixed: boolean;
  children?: ReactNode;
}) {
  return (
    <InboxItem
      to={to}
      title={alertTitle(alert)}
      tone={alert.cleared_at ? "muted" : alert.acknowledged_at ? "info" : "warning"}
      current={current}
      mark={mixed ? conditionMark(alert) : undefined}
      meta={<AlertMeta alert={alert} />}
      extra={children}
      select={select}
    />
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
  const phone = useIsMobile();
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
    enabled: capabilities.view && Boolean(selected) && isAlertId(selected!),
  });
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePage, setDevicePage] = useState(1);
  const devices = useQuery({
    queryKey: ["alert-device-options", org, deviceSearch, devicePage],
    queryFn: () => api.devices(org, { search: deviceSearch, page: devicePage }),
    enabled: listed,
  });
  const placeEntity = useQuery({
    queryKey: ["entity", org, params.get("entity")],
    queryFn: () => api.entity(org, params.get("entity")!),
    enabled: listed && Boolean(params.get("entity")),
  });
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [workflowPage, setWorkflowPage] = useState(1);
  const workflows = useQuery({
    queryKey: ["alert-workflow-options", org, workflowSearch, workflowPage],
    queryFn: () => api.dashboardWorkflows(org, workflowSearch, workflowPage, "all"),
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
      for (const group of groups.filter((item) => chosen.includes(sourceKey(item)))) {
        if (group.kind === "workflow") {
          total += (
            await api.acknowledgeAlerts(org, {
              workflow_uuid: group.workflow_uuid,
              device_uuid: group.device_uuid,
              ...(condition !== "all" && { condition }),
              ...(assignee && { assignee: Number(assignee) }),
            })
          ).acknowledged;
          continue;
        }
        // Connectivity sources have no workflow: acknowledge their alerts by id.
        const items = await subjectAlerts(org, group.latest, {
          acknowledged: "0",
          ...(condition !== "all" && { condition }),
          ...(assignee && { assignee }),
        });
        total += await acknowledgeListed(org, items.map((item) => item.uuid));
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
  const shown: AlertItem[] = grouped ? groups.map((group) => group.latest) : rows;
  const kinds = kindsOf(params);
  const filtered = ["acknowledged", "device", "entity", "workflow", "assignee", "kind"].some((key) =>
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
  const isCurrent = (alert: AlertItem) =>
    alert.uuid === selected || (grouped && selectedSource === sourceKey(alert));
  const empty = filtered
    ? ["No alerts match these filters", "Change or clear the filters to see more alerts."]
    : condition === "active"
      ? ["No active alerts", "Nothing needs attention right now. Cleared alerts stay under Cleared."]
      : condition === "cleared"
        ? ["No cleared alerts", "Alerts appear here once their condition clears."]
        : ["No alerts yet", "Alerts appear when an active workflow's condition changes or a device goes offline."];
  const total = query.data?.meta.total;
  const activeFilters = [params.get("device") && deviceName, params.get("entity"), params.get("workflow") && workflowName, kinds.length > 0].filter(Boolean).length;
  const changeKinds = (values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    next.delete("kind");
    for (const kind of alertKinds) if (values.includes(kind)) next.append("kind", kind);
    setParams(next);
  };
  // The filter controls, shared by the toolbar (768 px and up) and the phone filter sheet.
  const conditionFilter = (
    <SegmentedControl
      aria-label="Condition"
      value={condition}
      onValueChange={(value) => {
        if (value) change("condition", value === "active" ? null : value);
      }}
    >
      {conditions.map((value, index) => (
        <SegmentedControlItem key={value} value={value} count={counts[index].data?.meta.total}>
          {value === "active" ? "Active" : value === "cleared" ? "Cleared" : "All"}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
  const repeatsFilter = (
    <SegmentedControl
      aria-label="Repeats"
      value={grouped ? "grouped" : "individual"}
      onValueChange={(value) => {
        if (value) change("view", value === "grouped" ? null : value);
      }}
    >
      <SegmentedControlItem value="grouped">Grouped</SegmentedControlItem>
      <SegmentedControlItem value="individual">Individual</SegmentedControlItem>
    </SegmentedControl>
  );
  const unacknowledgedFilter = (
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
  );
  const mineFilter = (
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
  );
  const moreFilters = (
    <>
      <SearchableMultiSelect
        label="Kind"
        className="w-full"
        values={kinds}
        options={alertKinds.map((kind) => ({ value: kind, label: kindLabel(kind) }))}
        placeholder="All kinds"
        maximum={alertKinds.length}
        onChange={changeKinds}
      />
      <SearchableSelect
        label="Device"
        className="w-full"
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
      <EntityPicker
        org={org}
        label="Place"
        className="w-full"
        value={params.get("entity") ?? ""}
        selectedLabel={placeEntity.data?.path}
        none="Anywhere"
        placeholder="Anywhere"
        help="Alerts of devices placed here or below."
        onChange={(value) => change("entity", value || null)}
      />
      <SearchableSelect
        label="Workflow"
        className="w-full"
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
    </>
  );
  const countStatus = total !== undefined && (
    <span role="status" className="text-meta text-muted-foreground tabular-nums">
      {grouped ? plural(total, "source") : plural(total, "alert")}
    </span>
  );
  // Bulk acknowledge: a row above the list from 768 px; on phones, once something is
  // selected, a bar stuck to the bottom of the screen, under the toasts.
  const bulkBar = capabilities.manage && (grouped ? groups : rows).length > 0 && (!phone || chosen.length > 0 || acknowledge.isPending) && (
    <div
      ref={phone ? keepToastsAbove : undefined}
      data-sticky-bar={phone ? "" : undefined}
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 bg-sunken px-4 py-1.5",
        phone ? "sticky bottom-0 z-10 border-t" : "border-b",
      )}
    >
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
        variant={phone ? "default" : "outline"}
        disabled={!pending || acknowledge.isPending}
        onClick={() => (pending > 1 ? setConfirm(true) : acknowledge.mutate())}
      >
        Acknowledge selected{pending ? ` (${pending.toLocaleString()})` : ""}
      </Button>
    </div>
  );
  // The Filters button counts what it holds: grouping and "mine" sit there with kind, device and workflow.
  const popoverFilters = activeFilters + Number(!grouped) + Number(mine);
  // Phones count every choice that differs from the default view, since all of them sit in the sheet.
  const phoneFilters =
    activeFilters +
    Number(condition !== "active") +
    Number(!grouped) +
    Number(params.get("acknowledged") === "0") +
    Number(mine);
  return (
    <Inbox tab="alerts" header={!narrowDetail || denied}>
      {denied ? (
        <div className="p-4 md:p-6">
          <DeviceEmpty
            title="Alerts unavailable"
            description="You need device viewing access in this organization."
          />
        </div>
      ) : (
        <InboxPage
          title="Alerts"
          header={false}
          wide={wide}
          showDetail={Boolean(selected)}
          toolbar={
            phone ? (
              <>
                <FilterSheet title="Filter alerts" count={phoneFilters} onReset={() => setParams({})}>
                  <div className="flex flex-col gap-1.5">
                    <span aria-hidden="true" className="text-sm leading-snug font-medium">Condition</span>
                    {conditionFilter}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span aria-hidden="true" className="text-sm leading-snug font-medium">Repeats</span>
                    {repeatsFilter}
                  </div>
                  {unacknowledgedFilter}
                  {mineFilter}
                  {moreFilters}
                </FilterSheet>
                <div className="ml-auto">{countStatus}</div>
              </>
            ) : (
            <>
              {conditionFilter}
              {unacknowledgedFilter}
              <div className="ml-auto flex items-center gap-2">
                {countStatus}
                <Popover>
                  <PopoverTrigger asChild>
                    <ToolbarButton
                      icon={<ListFilterIcon />}
                      label="Filters"
                      name={popoverFilters ? `Filters, ${popoverFilters} active` : "Filters"}
                    >
                      {popoverFilters > 0 && (
                        <span className="grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-micro leading-4.5 font-semibold text-primary-foreground tabular-nums">
                          {popoverFilters}
                        </span>
                      )}
                    </ToolbarButton>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 gap-3 p-3" aria-label="Filter alerts">
                    <div className="flex flex-col gap-1.5">
                      <span aria-hidden="true" className="text-sm leading-snug font-medium">Repeats</span>
                      {repeatsFilter}
                    </div>
                    {mineFilter}
                    {moreFilters}
                  </PopoverContent>
                </Popover>
              </div>
            </>
            )
          }
          notices={
            <>
              {(organization.error || query.error) && (
                <RequestError error={organization.error ?? query.error} />
              )}
              {!confirm && <RequestError error={acknowledge.error} />}
            </>
          }
          list={
            <>
              {!phone && bulkBar}
              {query.isPending || organization.isPending ? (
                <div className="p-4">
                  <Skeleton className="h-48 w-full" />
                </div>
              ) : shown.length ? (
                <InboxList label={grouped ? "Alert sources" : "Alerts"}>
                  {grouped
                    ? groups.map((group) => {
                        const key = sourceKey(group);
                        return (
                          <SourceRow
                            key={key}
                            group={group}
                            to={`${list}/${group.latest.uuid}${search}`}
                            current={isCurrent(group.latest)}
                            mixed={condition === "all"}
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
                          mixed={condition === "all"}
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
                </InboxList>
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
              <div className="border-t px-4 empty:hidden">
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
              {phone && bulkBar}
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
            </>
          }
          detail={
            selected ? (
              <AlertDetail
                key={`${org}:${selected}`}
                id={selected}
                search={search}
                back={narrowDetail ? list + search : undefined}
              />
            ) : wide ? (
              <AlertsSummary />
            ) : null
          }
        />
      )}
    </Inbox>
  );
}

function SourceRow({
  group,
  ...props
}: {
  group: AlertSource;
  to: string;
  current: boolean;
  select?: ReactNode;
  mixed: boolean;
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
      <h2 id="alerts-summary" className="text-heading">
        Summary
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {figures.map((figure, index) => (
          <div key={figure.label} className="flex flex-col gap-1 rounded-lg bg-sunken p-3 shadow-[inset_0_0_0_1px_var(--border)]">
            <span className="text-heading">{figure.label}</span>
            <span className="text-meta text-muted-foreground">{figure.hint}</span>
            <Link
              to={figure.to}
              className="text-display underline-offset-4 hover:underline"
              aria-label={`${figure.label}: ${counts[index].data?.meta.total ?? "loading"}`}
            >
              {counts[index].data?.meta.total.toLocaleString() ?? "—"}
            </Link>
          </div>
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

/** Other occurrences of the alert's source (its workflow on its device, or its offline subject), with acknowledging every cleared one at once. */
function SourceOccurrences({
  alert,
  search,
  Heading,
}: {
  alert: AlertItem;
  search: string;
  Heading: "h2" | "h3";
}) {
  const { org, capabilities } = useDeviceOrganization();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const workflow = alert.kind === "workflow";
  // Connectivity sources are found through a device they list and matched by subject here.
  const source = workflow
    ? new URLSearchParams({ workflow: alert.workflow_uuid, device: alert.device_uuid })
    : subjectQuery(alert);
  const recent = `${source}&per_page=${workflow ? 5 : 100}`;
  const occurrences = useQuery({
    queryKey: ["alerts", org, recent],
    queryFn: () => api.alerts(org, recent),
    refetchInterval: 10000,
  });
  const waitingQuery = `${source}&condition=cleared&acknowledged=0&per_page=1`;
  const waiting = useQuery({
    queryKey: ["alerts", org, "count", waitingQuery],
    queryFn: () => api.alerts(org, waitingQuery),
    enabled: capabilities.manage && workflow,
    refetchInterval: 10000,
  });
  const matching = workflow
    ? (occurrences.data?.data ?? [])
    : (occurrences.data?.data ?? []).filter((item) => sameSubject(item, alert));
  const clearedWaiting = matching.filter((item) => item.condition === "cleared" && !item.acknowledged_at);
  const acknowledge = useMutation({
    mutationFn: async () =>
      alert.kind === "workflow"
        ? (
            await api.acknowledgeAlerts(org, {
              workflow_uuid: alert.workflow_uuid,
              device_uuid: alert.device_uuid,
              condition: "cleared",
            })
          ).acknowledged
        : acknowledgeListed(org, clearedWaiting.map((item) => item.uuid)),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["alerts", org] });
      void cache.invalidateQueries({ queryKey: ["alert", org] });
    },
  });
  const total = workflow ? (occurrences.data?.meta.total ?? 0) : matching.length;
  if (total < 2) return null;
  const cleared = workflow ? (waiting.data?.meta.total ?? 0) : clearedWaiting.length;
  const list = `/organizations/${org}/alerts`;
  const all = new URLSearchParams({ view: "individual", condition: "all" });
  if (workflow) {
    all.set("workflow", alert.workflow_uuid);
    all.set("device", alert.device_uuid);
  } else {
    all.set("kind", alert.kind);
    if (source.get("device")) all.set("device", source.get("device")!);
  }
  const subject = workflow ? null : alert.subject.type === "adapter" ? "connection" : alert.subject.type;
  return (
    <Collapsible asChild>
    <section
      aria-labelledby="alert-occurrences"
      className="flex flex-col rounded-lg px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto flex min-w-0 flex-col items-start gap-0.5">
          <Heading id="alert-occurrences" className="text-body font-medium">
            <CollapsibleTrigger asChild>
              <Button
                variant="link"
                className="link-target group/occurrences h-auto gap-1 p-0 text-foreground whitespace-normal text-start"
              >
                {workflow
                  ? `Raised ${plural(total, "time")} on this device`
                  : `This ${subject} has gone offline ${plural(total, "time")}`}
                <ChevronDownIcon
                  aria-hidden="true"
                  className="transition-transform group-data-[state=open]/occurrences:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
          </Heading>
          {capabilities.manage && cleared > 0 && (
            <p className="text-meta text-muted-foreground">
              {cleared.toLocaleString()} cleared {cleared === 1 ? "occurrence is" : "occurrences are"} unacknowledged.
            </p>
          )}
          {acknowledge.isSuccess && !acknowledge.isPending && (
            <p role="status" className="text-meta">
              Acknowledged {plural(acknowledge.data, "cleared alert")}.
            </p>
          )}
        </div>
        <Link className="text-body underline underline-offset-4 link-target" to={`${list}?${all}`}>
          Show all {workflow ? total.toLocaleString() : ""}
        </Link>
        {capabilities.manage && cleared > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={acknowledge.isPending}
            onClick={() => (cleared > 1 ? setConfirm(true) : acknowledge.mutate())}
          >
            {acknowledge.isPending
              ? "Acknowledging…"
              : `Acknowledge all cleared (${cleared.toLocaleString()})`}
          </Button>
        )}
      </div>
      {!confirm && <RequestError error={acknowledge.error} />}
      <CollapsibleContent>
        <ol aria-label="Recent occurrences" className="mt-3 flex flex-col border-t pt-1 text-body">
          {matching.slice(0, 5).map((item) => (
            <li
              key={item.uuid}
              className="flex flex-wrap items-baseline gap-x-3 border-b py-1.5 last:border-b-0"
            >
              {item.uuid === alert.uuid ? (
                <span className="font-medium">Occurrence {item.episode} (this alert)</span>
              ) : (
                <Link className="underline underline-offset-4 link-target" to={`${list}/${item.uuid}${search}`}>
                  Occurrence {item.episode}
                </Link>
              )}
              <span className="text-meta">{conditionMark(item)}</span>
              <span className="text-meta text-muted-foreground">
                {alertDuration(item)} ·{" "}
                {item.acknowledged_at ? "Acknowledged" : "Unacknowledged"}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
      <Confirm
        open={confirm}
        title={`Acknowledge ${plural(cleared, "cleared alert")}?`}
        description={
          workflow
            ? "Records that you have seen every cleared, unacknowledged occurrence of this workflow on this device. Active occurrences stay unacknowledged for review."
            : `Records that you have seen every cleared, unacknowledged occurrence of this ${subject} going offline. Active occurrences stay unacknowledged for review.`
        }
        action="Acknowledge"
        destructive={false}
        onClose={() => setConfirm(false)}
        onConfirm={() => acknowledge.mutateAsync()}
      />
    </section>
    </Collapsible>
  );
}

/**
 * Where a connectivity alert's subject lives in the portal; null for another organization's
 * gateway that serves the alert's devices, which is named only (spec 031).
 */
const subjectPath = (org: string, subject: ConnectivityAlert["subject"]) =>
  subject.uuid === null
    ? null
    : subject.type === "device"
      ? devicePath(org, subject.uuid)
      : subject.type === "gateway"
        ? gatewayPath(org, subject.uuid)
        : `/organizations/${encodeURIComponent(org)}/adapters/${encodeURIComponent(subject.uuid)}`;

/** A connectivity alert's subject, linked where it lives in the portal. */
function SubjectName({ org, subject }: { org: string; subject: ConnectivityAlert["subject"] }) {
  const path = subjectPath(org, subject);
  return path ? (
    <Link className="underline underline-offset-4 link-target" to={path}>
      {subject.name}
    </Link>
  ) : (
    <>{subject.name}</>
  );
}

/**
 * What a connectivity alert knows about going offline (spec 018): cause, last heard and observed,
 * the threshold and where it came from; a gateway alert lists the devices behind it.
 */
function OfflineDetails({ alert, Heading }: { alert: ConnectivityAlert; Heading: "h2" | "h3" }) {
  const { org } = useDeviceOrganization();
  const columns: DataColumn<{ uuid: string; name: string }>[] = [
    {
      id: "device",
      header: "Device",
      mobile: "title",
      sortable: true,
      value: (device) => device.name,
      cell: (device) => <RowLink to={devicePath(org, device.uuid)}>{device.name}</RowLink>,
    },
  ];
  const time = (at: string | null, never: string) =>
    at ? (
      <>
        {formatDateTime(at)}
        <span className="block text-xs text-muted-foreground">
          <RelativeTime at={at} never={null} />
        </span>
      </>
    ) : (
      <span className="text-muted-foreground">{never}</span>
    );
  const threshold = thresholdText(alert);
  const since = alert.offline_since ?? alert.activated_at;
  return (
    <>
      <Panel>
        <PanelContent className="flex flex-col gap-3">
          <p className="text-heading font-normal">
            {alert.condition === "active"
              ? `${alert.subject.name} has been offline${since ? ` since ${formatDateTime(since)}` : ""}.`
              : `${alert.subject.name} was offline${since ? ` from ${formatDateTime(since)}` : ""}${alert.cleared_at ? ` to ${formatDateTime(alert.cleared_at)}` : ""}.`}
          </p>
          <p className="flex flex-wrap gap-x-2 text-body text-muted-foreground">
            {alert.cause && <span>{statusOf(alert.cause, "offline_cause").label}</span>}
            <span>
              {alert.last_seen_at ? (
                <>
                  Last heard <RelativeTime at={alert.last_seen_at} never={null} />
                </>
              ) : (
                "Never heard from"
              )}
            </span>
            {threshold && <span>Offline after {threshold}</span>}
          </p>
          <Collapsible>
            <Heading className="text-body font-medium">
              <CollapsibleTrigger asChild>
                <Button variant="link" size="sm" className="link-target group/offline h-auto gap-1 p-0">
                  Offline details
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="transition-transform group-data-[state=open]/offline:rotate-180"
                  />
                </Button>
              </CollapsibleTrigger>
            </Heading>
            <CollapsibleContent>
              <p className="pt-2 text-meta text-muted-foreground">
                Times are when the platform received data, unless they say observed.
              </p>
          <PropertyList
            items={[
              { label: "Cause", value: alert.cause ? statusOf(alert.cause, "offline_cause").label : "Not recorded" },
              { label: "Offline since", value: time(alert.offline_since, "Not recorded") },
              { label: "Last heard", value: time(alert.last_seen_at, "Never") },
              ...(alert.last_observed_at
                ? [{ label: "Last reading observed", value: time(alert.last_observed_at, "Unknown") }]
                : []),
              {
                label: "Offline after",
                value: threshold ? (
                  <>
                    {threshold}
                    <span className="block text-xs text-muted-foreground">{thresholdSource(alert)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not in effect yet (still learning how often it reports)</span>
                ),
              },
              ...(alert.reporting_interval_seconds !== null
                ? [{ label: "Reporting interval", value: `About ${formatDuration(alert.reporting_interval_seconds)}` }]
                : []),
              ...(alert.poll_interval_seconds !== null
                ? [{ label: "Poll interval", value: formatDuration(alert.poll_interval_seconds) }]
                : []),
              ...(alert.grace_seconds !== null
                ? [{ label: "Grace period", value: formatDuration(alert.grace_seconds) }]
                : []),
            ]}
          />
            </CollapsibleContent>
          </Collapsible>
        </PanelContent>
      </Panel>
      {alert.kind !== "device_offline" && (
        <section aria-labelledby="alert-affected" className="flex flex-col gap-3">
          <Heading id="alert-affected" className="text-sm font-semibold">
            Affected devices
          </Heading>
          <DataTable
            id="alert-affected-devices"
            label="Affected devices"
            noun={["device", "devices"]}
            rows={alert.devices}
            rowKey={(device) => device.uuid}
            rowHref={(device) => devicePath(org, device.uuid)}
            columns={columns}
            empty={<DeviceEmpty title="No devices listed" />}
            note={
              alert.devices_total > alert.devices.length
                ? `Showing ${alert.devices.length.toLocaleString()} of ${alert.devices_total.toLocaleString()} devices, by name.`
                : undefined
            }
          />
        </section>
      )}
    </>
  );
}

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

/** A fact of the alert: label over value, and on phones a label and value row. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 max-md:col-span-2 max-md:grid max-md:grid-cols-subgrid max-md:items-baseline max-md:border-b max-md:py-2.5 max-md:last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words max-md:mt-0">{children}</dd>
    </div>
  );
}

/**
 * Email and push deliveries (spec 033): a table from 768 px, phone cards below (recipient,
 * status, the rest as lines). On phones the diagnostic and Retry sit under the recipient.
 */
const deliveryColumns = (
  retry: (delivery: AlertDelivery) => void,
): DataColumn<AlertDelivery>[] => {
  const retryButton = (item: AlertDelivery) =>
    item.status === "failed" && (
      <Button variant="outline" size="sm" onClick={() => retry(item)}>
        {item.channel === "push" ? "Retry push" : "Retry email"}
      </Button>
    );
  return [
    {
      id: "recipient",
      header: "Recipient",
      mobile: "title",
      hideable: false,
      value: (item) => item.recipient_name,
      cell: (item) => (
        <>
          <span className="max-md:font-medium">{item.recipient_name}</span>
          {item.diagnostic && (
            <span className="block text-meta text-muted-foreground md:hidden">{item.diagnostic}</span>
          )}
          {item.status === "failed" && <div className="mt-2 md:hidden">{retryButton(item)}</div>}
        </>
      ),
    },
    {
      id: "channel",
      header: "Channel",
      mobile: "meta",
      hideable: false,
      cell: (item) => (item.channel === "push" ? "Push" : "Email"),
    },
    {
      id: "type",
      header: "Type",
      mobile: "meta",
      hideable: false,
      cell: (item) => (item.type === "activated" ? "Activation" : "Recovery"),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      hideable: false,
      className: "whitespace-normal",
      cell: (item) => (
        <>
          <Status value={item.status} domain="delivery" />
          {item.diagnostic && (
            <span className="block text-xs text-muted-foreground max-md:hidden">{item.diagnostic}</span>
          )}
        </>
      ),
    },
    {
      id: "devices",
      header: "Devices",
      align: "end",
      mobile: "meta",
      hideable: false,
      className: "tabular-nums",
      // Push only: the devices whose push service accepted the latest attempt.
      cell: (item) =>
        item.channel === "push" && item.devices_total !== null ? `${item.devices_reached ?? 0} of ${item.devices_total}` : "",
    },
    {
      id: "attempts",
      header: "Attempts",
      align: "end",
      mobile: "meta",
      hideable: false,
      className: "tabular-nums",
      cell: (item) => item.attempts,
    },
    {
      id: "last",
      header: "Last attempt",
      align: "end",
      mobile: "meta",
      hideable: false,
      className: "text-muted-foreground tabular-nums",
      cell: (item) => {
        const last = item.history.at(-1)?.created_at ?? null;
        return last ? <RelativeTime at={last} never={null} /> : "None";
      },
    },
    {
      id: "action",
      header: "Action",
      headerHidden: true,
      align: "end",
      mobile: "hidden",
      hideable: false,
      cell: retryButton,
    },
  ];
};

/** How a delivery attempt ended, as the timeline says it. */
function attemptOutcome(channel: AlertDelivery["channel"], status: string) {
  if (channel !== "push") return status === "accepted" ? "accepted by mail server" : "transport failed, outcome uncertain";
  return (
    {
      accepted: "accepted by the push service",
      gone: "device no longer subscribed, removed",
      rejected: "refused by the push service",
    } as Record<string, string>
  )[status] ?? "push service didn't answer";
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
  const phone = useIsMobile();
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const canViewDashboards = useDashboardCapabilities(org).view;
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
    enabled: capabilities.view && isAlertId(id),
    refetchInterval: (current) => (isNotFound(current.state.error) ? false : 5000),
  });
  const alert = query.data;
  const missing = !isAlertId(id) || isNotFound(query.error);
  // Opening an alert reads its notifications in your bell (spec 022), once per alert shown.
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (!alert || readFor.current === alert.uuid) return;
    readFor.current = alert.uuid;
    void api
      .markAlertNotificationsRead(org, { alert_uuid: alert.uuid })
      .then((summary) => cache.setQueryData(alertBellKeys.summary(org), summary))
      .catch(() => undefined)
      .finally(() => void cache.invalidateQueries({ queryKey: alertBellKeys.list(org) }));
  }, [org, alert?.uuid]);
  const comments = useQuery({
    queryKey: ["alert-comments", org, id, page],
    queryFn: () => api.alertComments(org, id, page),
    enabled: capabilities.view && !missing,
  });
  const deliveries = useQuery({
    queryKey: ["alert-deliveries", org, id],
    queryFn: () => api.alertDeliveries(org, id),
    enabled: capabilities.manage && !missing,
    refetchInterval: 5000,
  });
  const dashboards = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
    enabled: canViewDashboards && Boolean(alert),
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
        alert!.workflow_uuid!,
        memberSearch,
        memberPage,
      ),
    enabled: capabilities.manage && Boolean(alert?.workflow_uuid),
  });
  // Connectivity alerts have no workflow to list members from: they can be taken or released.
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: Infinity,
    enabled: capabilities.manage && alert?.kind !== undefined && alert.kind !== "workflow",
  });
  const assignees =
    alert && alert.kind !== "workflow"
      ? [
          ...(session.data ? [{ id: session.data.id, name: `${session.data.name} (me)` }] : []),
          ...(alert.assignee && alert.assignee.id !== session.data?.id ? [alert.assignee] : []),
        ]
      : (members.data?.data ?? []);
  const updated = (data: AlertItem) => {
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
  // A link to an alert that is gone or no longer yours names nothing about it.
  const title = alert ? alertTitle(alert) : "Alert";
  const occurrence = alert ? `Occurrence ${alert.episode}` : undefined;
  const headline = alert ? (alert.kind === "workflow" ? alert.workflow_name : kindLabel(alert.kind)) : "";
  // A failed delivery opens the table, since that is where Retry is; a choice made by hand wins.
  const [deliveryOpen, setDeliveryOpen] = useState<boolean>();
  const failedDelivery = (deliveries.data?.data ?? []).some((item) => item.status === "failed");
  // Sections sit under the page h1 when narrow and under the pane's h2 when wide.
  const Heading = back ? "h2" : "h3";
  const settings = alert?.workflow_uuid ? `${notificationsPath(org)}/${alert.workflow_uuid}` : "";
  const deviceUuids = alert
    ? alert.kind === "workflow"
      ? [alert.device_uuid]
      : alert.devices.map((device) => device.uuid)
    : [];
  const usedIn =
    alert && dashboards.data
      ? dashboards.data.filter((dashboard) =>
          deviceUuids.some((device) => usesDevice(dashboard, device)),
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
        text: `${delivery.type === "activated" ? "Activation" : "Recovery"} ${delivery.channel === "push" ? "push" : "email"} to ${delivery.recipient_name}${attempt.device_label ? ` · ${attempt.device_label}` : ""}`,
        detail: `Attempt ${attempt.attempt} · ${attemptOutcome(delivery.channel, attempt.status)}`,
      });
  for (const delivery of deliveries.data?.data ?? []) {
    const at = delivery.type === "activated" ? alert?.activated_at : alert?.cleared_at;
    if (delivery.history.length || !at) continue;
    const state = statusOf(delivery.status, "delivery");
    timeline.push({
      key: `${delivery.uuid}-unsent`,
      at,
      tone: state.tone,
      text: `${delivery.type === "activated" ? "Activation" : "Recovery"} ${delivery.channel === "push" ? "push" : "email"} to ${delivery.recipient_name}: ${state.label.toLowerCase()}`,
      detail: delivery.diagnostic ?? undefined,
    });
  }
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
      text: alert.stopped_reason ? "Stopped" : alert.kind === "workflow" ? "Cleared" : "Cleared, back online",
      detail: alert.stopped_reason ? statusOf(alert.stopped_reason, "offline_stop").label : undefined,
    });
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const body = (
    <div className="flex min-w-0 flex-col gap-6">
      {missing && capabilities.view ? (
        <DeviceEmpty
          title="This alert isn't available"
          description="It may have been removed, or you may no longer have access to it."
        />
      ) : (
        <LoadError
          error={organization.error ?? query.error}
          what="this alert"
          onRetry={() =>
            organization.error ? organization.refetch() : query.refetch()
          }
          busy={organization.isFetching || query.isFetching}
        />
      )}
      {query.isPending && capabilities.view && !missing ? (
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
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="mr-auto flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
                {conditionMark(alert)}
                <span className="text-muted-foreground tabular-nums">
                  {[alertSpan(alert), !back && occurrence].filter(Boolean).join(" · ")}
                </span>
              </p>
              {!back && <h2 className="min-w-0 text-title">{headline}</h2>}
              <p className="text-body text-muted-foreground">
                {alert.kind === "workflow" ? (
                  alert.device_name ? (
                    <Link
                      className="underline underline-offset-4 link-target"
                      to={devicePath(org, alert.device_uuid)}
                    >
                      {alert.device_name}
                    </Link>
                  ) : (
                    "Device not found"
                  )
                ) : (
                  <SubjectName org={org} subject={alert.subject} />
                )}
                {alert.site && ` · ${alert.site.name}`}
              </p>
            </div>
            {capabilities.manage && (
              <SearchableSelect
                label="Assignee"
                labelHidden
                className="w-full md:w-52"
                value={alert.assignee ? String(alert.assignee.id) : ""}
                selectedLabel={alert.assignee?.name ?? "Unassigned"}
                options={[
                  { value: "", label: "Unassigned" },
                  ...assignees.map((member) => ({
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
            {capabilities.manage && !alert.acknowledged_at && !phone && (
              <Button
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate()}
              >
                {acknowledge.isPending ? "Acknowledging…" : "Acknowledge alert"}
              </Button>
            )}
          </div>
          <RequestError error={acknowledge.error ?? assign.error} />
          {alert.stopped_reason ? (
            <Alert>
              <AlertTitle>Monitoring stopped</AlertTitle>
              <AlertDescription>
                {statusOf(alert.stopped_reason, "offline_stop").label}. The alert ended
                without the {alert.subject?.type === "adapter" ? "connection" : alert.subject?.type ?? "device"} coming back, so no recovery is recorded.
              </AlertDescription>
            </Alert>
          ) : null}
          {alert.execution_stopped_reason ? (
            <Alert>
              <AlertTitle>Execution stopped</AlertTitle>
              <AlertDescription>
                {sentence(alert.execution_stopped_reason)}. This alert keeps
                its last condition; stopping execution does not clear it.
              </AlertDescription>
            </Alert>
          ) : null}
          {alert.kind === "workflow" ? (
            <TriggerSummary org={org} alert={alert} />
          ) : (
            <OfflineDetails alert={alert} Heading={Heading} />
          )}
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-4 text-body max-md:grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] max-md:gap-x-4 max-md:gap-y-0">
            <Fact label="Activated">
              {alert.activated_at ? (
                <>
                  {formatDateTime(alert.activated_at)}
                  <span className="block text-meta text-muted-foreground">
                    <RelativeTime at={alert.activated_at} never={null} />
                  </span>
                </>
              ) : (
                "Not recorded"
              )}
            </Fact>
            {alert.cleared_at && (
              <Fact label={alert.stopped_reason ? "Stopped" : "Cleared"}>
                {formatDateTime(alert.cleared_at)}
              </Fact>
            )}
            <Fact label="Acknowledgement">
              {alert.acknowledged_at ? (
                <>
                  <StatusMark tone="good">Acknowledged</StatusMark>
                  <span className="block text-meta text-muted-foreground">
                    {alert.acknowledged_by_name ?? "A former member"} ·{" "}
                    <RelativeTime at={alert.acknowledged_at} never={null} />
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
            {alert.kind === "workflow" && (
              <Fact label="Workflow">
                {capabilities.manage ? (
                  <Link className="underline underline-offset-4 link-target" to={settings}>
                    {alert.workflow_name}
                  </Link>
                ) : (
                  alert.workflow_name
                )}
              </Fact>
            )}
            {usedIn.length > 0 && (
              <Fact label="Dashboards">
                {usedIn.map((dashboard, index) => (
                  <span key={dashboard.uuid}>
                    {index > 0 && ", "}
                    <Link
                      className="underline underline-offset-4 link-target"
                      to={`/organizations/${org}/dashboards/${dashboard.uuid}`}
                    >
                      {dashboard.name}
                    </Link>
                  </span>
                ))}
              </Fact>
            )}
          </dl>
          <SourceOccurrences alert={alert} search={search} Heading={Heading} />
          <section aria-labelledby="alert-timeline" className="flex flex-col gap-3">
            <Heading id="alert-timeline" className="text-heading">
              Activity
            </Heading>
            <RequestError error={comments.error ?? deliveries.error} />
            <ol className="flex flex-col gap-3 text-sm">
              {timeline.map((entry) => (
                <li
                  key={entry.key}
                  // Phones put the time above the entry, so large text still fits.
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 max-md:grid-cols-[minmax(0,1fr)]"
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
            {capabilities.manage && deliveries.data && !deliveries.data.data.length && (
              <p className="text-body text-muted-foreground">
                No email or push was requested for this alert.
              </p>
            )}
            <DevicePages
              meta={comments.data?.meta}
              label="Comments"
              onPage={setPage}
            />
          </section>
          {capabilities.manage && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                addComment.mutate();
              }}
            >
              <label htmlFor="alert-comment" className="sr-only">
                Add a comment
              </label>
              <Textarea
                id="alert-comment"
                required
                maxLength={5000}
                rows={2}
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
          )}
          {capabilities.manage && (deliveries.data?.data.length ?? 0) > 0 && (
            // Who was told is in Activity; the table adds devices reached, attempts and Retry.
            <Collapsible
              open={deliveryOpen ?? failedDelivery}
              onOpenChange={setDeliveryOpen}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Heading id="alert-email" className="text-heading">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="link"
                      className="link-target group/delivery h-auto gap-1 p-0 text-heading text-foreground"
                    >
                      Delivery details
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="transition-transform group-data-[state=open]/delivery:rotate-180"
                      />
                    </Button>
                  </CollapsibleTrigger>
                </Heading>
                {settings && (
                  <Link className="text-body underline underline-offset-4 link-target" to={settings}>
                    Notification settings
                  </Link>
                )}
              </div>
              <CollapsibleContent>
                <DataTable
                  id="alert-deliveries"
                  label="Deliveries"
                  noun={["delivery", "deliveries"]}
                  rows={deliveries.data!.data}
                  rowKey={(item) => item.uuid}
                  rowLabel={(item) => item.recipient_name}
                  columns={deliveryColumns(setRetry)}
                />
              </CollapsibleContent>
            </Collapsible>
          )}
          {/* Phones keep Acknowledge under the thumb: a bar stuck to the bottom of the screen. */}
          {capabilities.manage && !alert.acknowledged_at && phone && (
            <div
              ref={keepToastsAbove}
              data-sticky-bar=""
              className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t bg-background px-4 py-3"
            >
              <Button className="w-full" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
                {acknowledge.isPending ? "Acknowledging…" : "Acknowledge alert"}
              </Button>
            </div>
          )}
          <Confirm
            open={Boolean(retry)}
            title={retry?.channel === "push" ? "Retry failed push?" : "Retry failed email?"}
            description={
              retry?.channel === "push"
                ? `Push again to ${retry.recipient_name}'s devices. Current access and push settings are checked again.`
                : `Retry delivery to ${retry?.recipient_name ?? "this recipient"}. A previous attempt may have reached the mail server, so another email could be received. Current access and notification preferences are checked again.`
            }
            action={retry?.channel === "push" ? "Retry push" : "Retry email"}
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
