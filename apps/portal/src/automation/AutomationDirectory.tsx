import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, EllipsisIcon, OctagonXIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import type { ArchivedBy, ArchiveFilter } from "@iot-os/api-client";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@iot-os/ui/components/tooltip";
import { useUrlState } from "@iot-os/ui/hooks/use-url-state";
import { CollectionPage } from "@iot-os/ui/templates/collection-page";
import { api } from "../lib/api";
import { Confirm, errorMessage, RequestError } from "../components/forms";
import { deploymentState, lastActivity, triggerSummary, type DirectorySummary } from "./directory";

type Row = DirectorySummary & {
  uuid: string;
  name: string;
  draft_revision: number;
  archived_at?: string | null;
  archived_by?: ArchivedBy | null;
};
type Settings = { enabled: boolean; stopped: boolean; revision: number };
type Page<T> = {
  data: T[];
  /** archived_count: archived automations matching the search, listed or not. */
  meta: { current_page: number; last_page: number; total: number; archived_count?: number };
};
/** Choices after the default, "Not archived"; "All" includes archived automations. */
const archivedOptions: { value: ArchiveFilter; label: string }[] = [
  { value: "only", label: "Archived" },
  { value: "include", label: "All" },
];

const url = (org: string, id = "") => `/organizations/${org}/automation${id ? `/${id}` : ""}`;

/** Automations as a Collection; the organization-wide stop lives in the header menu. */
export function Directory() {
  const org = useParams().organizationUuid!;
  const cache = useQueryClient();
  const state = useUrlState();
  const search = state.get("search"),
    page = Number(state.get("page") || 1),
    archived = archivedOptions.find((o) => o.value === state.get("archived"))?.value;
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState<Row | null>(null);
  const session = useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60000 });
  // Older APIs send no automation capabilities; their editor shows the API's refusals instead.
  const can = session.data?.organizations.find((o) => o.uuid === org)?.capabilities?.automation;
  const settings = useQuery({
    queryKey: ["automation-settings", org],
    queryFn: () => api.automation<{ data: Settings }>(org, "/dag/settings"),
  });
  const list = useQuery({
    queryKey: ["automation-directory", org, search, page, archived],
    queryFn: () =>
      api.automation<Page<Row>>(
        org,
        `/dag?${new URLSearchParams({ search, page: String(page), ...(archived ? { archived } : {}) })}`,
      ),
    placeholderData: keepPreviousData,
  });
  // The default view says how many archived automations it leaves out.
  const hiddenArchived = archived ? 0 : (list.data?.meta.archived_count ?? 0);
  const showArchived = () => state.set({ archived: "include", page: null });
  async function restore(w: Row) {
    try {
      await api.restoreWorkflow(org, w.uuid);
      toast.success(`Restored ${w.name}. It stays off until you activate it.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await cache.invalidateQueries({ queryKey: ["automation-directory", org] });
  }
  async function change(values: Partial<Settings>) {
    if (!settings.data) return false;
    setBusy(true);
    setError(undefined);
    try {
      await api.automation(org, "/dag/settings", "PUT", { ...settings.data.data, ...values });
      await cache.invalidateQueries({ queryKey: ["automation-settings", org] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const enabled = settings.data?.data.enabled;
  const stopped = settings.data?.data.stopped;

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        id: "automation",
        header: "Automation",
        mobile: "title",
        className: "max-w-64",
        value: (w) => w.name,
        cell: (w) => {
          const live =
            w.last_deployment?.target === "active" && w.last_deployment.status === "succeeded"
              ? w.last_deployment.draft_revision
              : undefined;
          return (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <RowLink to={url(org, w.uuid)} className="block truncate">
                  {w.name}
                </RowLink>
                {w.archived_at && <Status value="archived" className="shrink-0 text-meta" />}
              </span>
              <p className="text-meta text-muted-foreground">
                Draft revision {w.draft_revision}
                {live !== undefined && live !== w.draft_revision && ` · live revision ${live}`}
              </p>
            </>
          );
        },
      },
      {
        id: "trigger",
        header: "Trigger",
        className: "max-w-72 whitespace-normal",
        value: (w) => triggerSummary(w.triggers),
        cell: (w) =>
          triggerSummary(w.triggers) || <span className="text-muted-foreground">No device inputs</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (w) => deploymentState(w.deployment_status).label,
        cell: (w) => {
          const { tone, label } = deploymentState(w.deployment_status);
          return <StatusMark tone={tone}>{label}</StatusMark>;
        },
      },
      {
        id: "activity",
        header: "Last activity",
        value: (w) => lastActivity(w)?.at,
        cell: (w) => {
          const activity = lastActivity(w);
          return activity ? (
            <>
              <p>{activity.label}</p>
              <RelativeTime at={activity.at} className="text-meta text-muted-foreground" />
            </>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          );
        },
      },
      {
        id: "issue",
        header: "Last issue",
        className: "max-w-72 whitespace-normal",
        value: (w) => w.last_issue?.message,
        cell: (w) =>
          w.last_issue ? (
            <>
              <p className="text-destructive">{w.last_issue.message}</p>
              {w.last_issue.at && (
                <span className="text-meta text-muted-foreground">
                  {w.last_issue.source === "action" ? "Action" : "Deployment"} ·{" "}
                  <RelativeTime at={w.last_issue.at} />
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
    ],
    [org],
  );

  return (
    <CollectionPage
      title="Automations"
      description={
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" tabIndex={0}>
              Preview
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Device automation is an opt-in preview for this organization. Behaviour and limits may
            change; test with simulator devices before controlling real equipment.
          </TooltipContent>
        </Tooltip>
      }
      actions={
        enabled && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Automation settings">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {stopped ? (
                  <DropdownMenuItem disabled={busy} onSelect={() => void change({ stopped: false })}>
                    Resume automations
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                    <OctagonXIcon />
                    Stop all automation actions…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" asChild>
              <Link to={url(org, "new")}>
                <PlusIcon data-icon="inline-start" />
                New automation
              </Link>
            </Button>
          </>
        )
      }
      notices={
        <>
          <RequestError error={error ?? settings.error} />
          {settings.data && !enabled && (
            <Panel>
              <PanelHeader>
                <PanelTitle>Device automations</PanelTitle>
                <PanelDescription>
                  Build rules from telemetry, correlate devices, and review actions before activation.
                </PanelDescription>
              </PanelHeader>
              <PanelContent>
                <Button disabled={busy} onClick={() => void change({ enabled: true })}>
                  Enable automation preview
                </Button>
              </PanelContent>
            </Panel>
          )}
          {stopped && (
            <Alert variant="destructive">
              <OctagonXIcon />
              <AlertTitle>Automation actions are stopped</AlertTitle>
              <AlertDescription>
                No automation in this organization can send alerts, events or device commands until
                you resume. Already dispatched commands may still reach devices.
              </AlertDescription>
              <AlertAction>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void change({ stopped: false })}>
                  Resume
                </Button>
              </AlertAction>
            </Alert>
          )}
        </>
      }
    >
      <DataTable
        id="automations"
        label="Automations"
        noun={["automation", "automations"]}
        rows={list.data?.data}
        rowKey={(w) => w.uuid}
        rowLabel={(w) => w.name}
        rowHref={(w) => url(org, w.uuid)}
        columns={columns}
        error={list.error ? <RequestError error={list.error} /> : undefined}
        search={{
          label: "Search automations",
          placeholder: "Search automations",
          value: search,
          onChange: (value) => state.set({ search: value }),
        }}
        filters={
          // Organizations that never archive keep the list as it was.
          (list.data?.meta.archived_count ?? 0) > 0 || archived
            ? [
                {
                  id: "archived",
                  label: "Archived",
                  anyLabel: "Not archived",
                  options: archivedOptions,
                  value: archived ? [archived] : [],
                  onChange: (value: string[]) => state.set({ archived: value[0] ?? null, page: null }),
                },
              ]
            : []
        }
        // "All" widens the default view, so its count reads as a total, not a match.
        filtered={Boolean(search || archived === "only")}
        onReset={() => state.clear(["search", "archived", "page"])}
        note={
          hiddenArchived > 0 && (
            <>
              {hiddenArchived.toLocaleString()} archived {hiddenArchived === 1 ? "automation" : "automations"} hidden{" "}
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-meta"
                aria-label="Show archived automations"
                onClick={showArchived}
              >
                Show
              </Button>
            </>
          )
        }
        rowActions={(w) =>
          w.archived_at ? (
            can?.manage ? (
              <DropdownMenuItem onSelect={() => void restore(w)}>Restore</DropdownMenuItem>
            ) : null
          ) : can?.manage && can.activate ? (
            <DropdownMenuItem onSelect={() => setArchiving(w)}>Archive…</DropdownMenuItem>
          ) : null
        }
        pagination={{
          page,
          pageSize: 25,
          total: list.data?.meta.total ?? 0,
          pageCount: list.data?.meta.last_page,
          onPageChange: (next) => state.set({ page: next > 1 ? String(next) : null }),
        }}
        empty={
          hiddenArchived ? (
            <EmptyState
              inset
              icon={<ArchiveIcon />}
              title="No current automations"
              description={`${hiddenArchived.toLocaleString()} archived ${hiddenArchived === 1 ? "automation is" : "automations are"} hidden from this list.`}
              action={
                <Button variant="outline" size="sm" onClick={showArchived}>
                  Show archived automations
                </Button>
              }
            />
          ) : (
            <EmptyState
              inset
              icon={<WorkflowIcon />}
              title={archived === "only" ? "No archived automations" : "No automations yet"}
              description={archived === "only" ? undefined : "Build a workflow from device inputs, conditions and actions."}
              action={
                enabled && !archived && (
                  <Button size="sm" asChild>
                    <Link to={url(org, "new")}>New automation</Link>
                  </Button>
                )
              }
            />
          )
        }
      />
      <Confirm
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? "automation"}?`}
        description="It is turned off now and hidden from this list. Restoring it brings it back off, so you choose when it runs again."
        action="Archive automation"
        destructive={false}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return;
          await api.archiveWorkflow(org, archiving.uuid);
          toast.success(`Archived ${archiving.name}`);
          await cache.invalidateQueries({ queryKey: ["automation-directory", org] });
        }}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop all automation actions?</AlertDialogTitle>
            <AlertDialogDescription>
              Every automation in this organization stops sending alerts, integration events and
              device commands. Queued actions are cancelled now, and new ones are cancelled until you
              resume. Workflows stay deployed and keep evaluating. Commands already dispatched may
              still reach devices.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await change({ stopped: true })) setConfirming(false);
              }}
            >
              Stop all actions
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CollectionPage>
  );
}
